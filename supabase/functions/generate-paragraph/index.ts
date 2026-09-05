// Generates the bonus end-of-introduction cloze paragraph: a short German
// paragraph using every word in today's batch (3-5 words -- see
// lib/practice.ts's buildParagraphBatches) exactly once, each one blanked
// out as a `[[i]]` placeholder (i = that word's index in the `words` array
// this request sent) so the client can splice the learner's drag-and-drop
// answer back into the exact spot -- see lib/practice.ts's
// parseParagraphResponse for how the response is consumed. Same
// key-handling/rate-limiting/ai_usage rationale as generate-sentence: the
// OpenAI key lives only here, and every call counts against the same
// combined per-caller daily cap.
//
// Two things generate-sentence doesn't need to worry about, both handled
// here: (1) each word may need a non-dictionary inflected form to read
// naturally (a noun's plural, a verb's conjugated form) -- the prompt hands
// over whatever grammar the corpus already has for each word so the model
// isn't guessing; (2) this is free-form creative writing strung across a
// whole paragraph rather than one constrained sentence, so it gets an
// actual moderation pass (OpenAI's moderation endpoint, free -- no reason
// not to) rather than just trusting the system prompt's tone instructions,
// since the owner explicitly wants this "healthy" content, not merely
// "the model was told to be nice."

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Upgraded from gpt-4o-mini (generate-sentence's model) after a real test
// batch showed a wrong-gender article ("Der Anrede" for a die-word) --
// worth the extra cost specifically here since this fires far less often
// than generate-sentence (once per DAY at most, when a learner opts into
// the bonus, vs. once per NEW WORD), so the aggregate spend stays small
// while directly addressing "make sure it makes sense" grammatically.
const MODEL = 'gpt-4o';

// Same combined per-caller cap as generate-sentence/correct-sentence --
// every AI Edge Function shares one ai_usage-backed daily ceiling.
const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

// Deliberately tighter and shorter than generate-sentence's WORD_RANGE --
// this is a whole paragraph a beginner has to read and hold in their head
// at once, not one sentence, so A1/A2 stay well under what a full leveled
// reading passage would allow. C1/C2 mirror B2 (no corpus there yet, kept
// for completeness the same way WORD_RANGE does).
const PARAGRAPH_RANGE: Record<string, { minSentences: number; maxSentences: number; minWords: number; maxWords: number }> = {
  A1: { minSentences: 2, maxSentences: 3, minWords: 20, maxWords: 35 },
  A2: { minSentences: 3, maxSentences: 4, minWords: 35, maxWords: 50 },
  B1: { minSentences: 4, maxSentences: 5, minWords: 50, maxWords: 75 },
  B2: { minSentences: 5, maxSentences: 6, minWords: 70, maxWords: 100 },
  C1: { minSentences: 5, maxSentences: 6, minWords: 70, maxWords: 100 },
  C2: { minSentences: 5, maxSentences: 6, minWords: 70, maxWords: 100 },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestWord {
  de: string;
  // The word's English meaning -- without this the model has nothing but
  // bare spelling to go on, which is exactly how a near-homograph pair
  // like "leben" (to live) / "lieben" (to love) gets silently swapped
  // (confirmed real). Included in every wordList entry below regardless
  // of the learner's own native language -- it's the one gloss field
  // guaranteed present for every word (unlike `zh`, backfilled later and
  // still missing for some), so it's the reliable disambiguator to hand
  // the model even for a Chinese-native-language request.
  en: string;
  article?: string;
  plural?: string;
  type: string;
  thirdPerson?: string;
  pastTense?: string;
  perfectTense?: string;
}

interface RequestBody {
  level: string;
  words: RequestWord[];
  themeHint?: string;
  nativeLanguage?: 'en' | 'zh';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await callerClient.auth.getUser();
      userId = userData.user?.id ?? null;
    }
    const forwardedFor = req.headers.get('x-forwarded-for');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : null;
    if (!userId && !ip) {
      return json({ error: 'Could not identify caller' }, 400);
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let usageQuery = supabase
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());
    usageQuery = userId ? usageQuery.eq('user_id', userId) : usageQuery.eq('ip_address', ip);
    const limit = userId ? DAILY_AI_CALL_LIMIT : DAILY_AI_CALL_LIMIT_ANONYMOUS;
    const { count: callsToday, error: countError } = await usageQuery;
    if (!countError && (callsToday ?? 0) >= limit) {
      return json({ limitReached: true });
    }

    const body = (await req.json()) as RequestBody;
    const { level, words, themeHint, nativeLanguage } = body;
    const wantsZh = nativeLanguage === 'zh';
    // 2-5 mirrors MIN_PARAGRAPH_WORDS/MAX_PARAGRAPH_WORDS in
    // lib/practice.ts -- enforced again here since this is a public
    // endpoint and the client-side batching is only a courtesy, not a
    // guarantee. The client's own runtime fallback (see
    // combineParagraphExercises) also calls this with as few as 2 words
    // when splitting a failed larger batch in half, so the floor stays
    // at 2 even though a normal request is usually 3-5.
    if (!Array.isArray(words) || words.length < 2 || words.length > 5) {
      return json({ error: 'Expected 2-5 words' }, 400);
    }
    const range = PARAGRAPH_RANGE[level] ?? PARAGRAPH_RANGE.B1;

    // Separable-prefix verbs (thirdPerson/pastTense with a space in them,
    // e.g. "holt ab") turned out unreliable to hand the model as free
    // choice -- across a real test batch it sometimes duplicated the
    // prefix (answer "holt ab" PLUS a literal trailing "ab" the model also
    // wrote), and sometimes dropped it entirely (answer "holt" with no "ab"
    // anywhere, silently testing "holen" instead of the actual word
    // "abholen"). Both are real correctness bugs, not just style. Fixed by
    // not leaving it to chance at all: perfectTense's participle (e.g.
    // "abgeholt" in "hat abgeholt") is a SINGLE glued word with no internal
    // split to get wrong, so separable verbs are forced into perfect tense
    // with the auxiliary written as plain text and only the participle as
    // the blank's answer -- structurally impossible to duplicate or drop
    // the prefix on.
    // Parallel to `words` -- the exact participle a separable verb's answer
    // is FORCED to equal (see the wordList comment above), or null for
    // every other word. Computed once, reused both to build the per-word
    // prompt instructions and to actually verify the model followed them.
    const forcedParticiple: (string | null)[] = words.map(w => {
      if (w.type !== 'verb' || !w.thirdPerson?.includes(' ') || !w.perfectTense?.includes(' ')) return null;
      const [, ...rest] = w.perfectTense.split(' ');
      return rest.join(' ');
    });

    const wordList = words
      .map((w, i) => {
        const meaning = `meaning "${w.en}"`;
        if (w.type === 'noun') {
          return `${i}: "${w.de}" (${meaning}; ${[w.article, `plural: ${w.plural || 'none'}`].filter(Boolean).join(', ')})`;
        }
        if (w.type === 'verb') {
          const participle = forcedParticiple[i];
          if (participle) {
            const aux = w.perfectTense!.split(' ')[0];
            return (
              `${i}: "${w.de}" (${meaning}) -- this is a separable-prefix verb. You MUST use its perfect tense: ` +
              `write "${aux}" as normal text immediately before placeholder [[${i}]], and the answer ` +
              `for [[${i}]] must be exactly "${participle}" (nothing else, no prefix elsewhere).`
            );
          }
          return `${i}: "${w.de}" (${meaning}; infinitive; natural tense/person forms: ${[w.thirdPerson, w.pastTense, w.perfectTense].filter(Boolean).join(' / ')})`;
        }
        return `${i}: "${w.de}" (${meaning}; ${w.type})`;
      })
      .join('\n');

    const auxByIndex: (string | null)[] = words.map((w, i) => (forcedParticiple[i] ? w.perfectTense!.split(' ')[0] : null));

    // A forced separable-verb slot only actually works if BOTH halves are
    // right: the answer string must be the bare participle (checked
    // before), AND the auxiliary must genuinely appear immediately before
    // that placeholder in the paragraph text -- checking the answer alone
    // isn't enough. Confirmed real: a generation returned answer
    // "abgeholt" (passing the answer-only check) but the paragraph never
    // wrote "hat"/"ist" anywhere near [[i]] at all (used it inside a
    // "um...zu" purpose clause, which needs the infinitive, not a bare
    // participle) -- structurally fine per parseParagraphResponse, but bad
    // German. This walks the same `[[i]]` placeholders parseParagraphResponse
    // parses and checks the last word right before each forced one.
    function followsForcedForms(paragraph: string, a: string[]): boolean {
      if (!forcedParticiple.some(p => p !== null)) return true;
      const positions = new Map<number, number>(); // placeholder index -> its start offset
      const re = /\[\[(\d+)\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(paragraph))) positions.set(Number(m[1]), m.index);
      return forcedParticiple.every((participle, i) => {
        if (participle === null) return true;
        if (a[i] !== participle) return false;
        const pos = positions.get(i);
        if (pos === undefined) return false;
        const before = paragraph.slice(0, pos).trim();
        const lastWord = before.split(/\s+/).pop() ?? '';
        return lastWord.toLowerCase() === auxByIndex[i]?.toLowerCase();
      });
    }

    // Mirrors parseParagraphResponse's own validation (lib/practice.ts) --
    // every placeholder index must be in range 0..count-1, none repeated,
    // and every index must actually appear once. Checked here too (not
    // just trusted to the client) so a malformed generation can actually
    // be retried instead of always reaching the client as a dead end.
    function hasValidPlaceholders(paragraph: string, answers: string[], count: number): boolean {
      if (!paragraph || !Array.isArray(answers) || answers.length !== count) return false;
      const seen = new Set<number>();
      const re = /\[\[(\d+)\]\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(paragraph))) {
        const idx = Number(m[1]);
        if (idx < 0 || idx >= count || seen.has(idx)) return false;
        seen.add(idx);
      }
      return seen.size === count;
    }

    // Splits a fully-resolved (no [[i]] placeholders left) German
    // paragraph into individual sentences -- good enough for these short,
    // controlled, AI-generated everyday scenes (no abbreviations/decimals
    // expected), used both to validate the model actually returned one
    // translation per sentence and to hand the client pre-aligned
    // sentence pairs for the post-check translation panel (see
    // ParagraphExerciseCard) instead of making it re-derive boundaries
    // itself.
    function splitSentences(text: string): string[] {
      const matches = text.match(/[^.!?]+[.!?]+(\s+|$)/g);
      if (matches) return matches.map(s => s.trim()).filter(Boolean);
      const trimmed = text.trim();
      return trimmed ? [trimmed] : [];
    }

    function resolvePlaceholders(paragraph: string, answers: string[]): string {
      return paragraph.replace(/\[\[(\d+)\]\]/g, (_, i) => answers[Number(i)] ?? '');
    }

    function hasValidTranslations(paragraph: string, answers: string[], translations: string[]): boolean {
      return Array.isArray(translations) && translations.length > 0
        && translations.length === splitSentences(resolvePlaceholders(paragraph, answers)).length;
    }

    let genResult = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
    if (!genResult) return json({ error: 'AI paragraph generation failed' }, 502);
    // Structural check FIRST -- a malformed [[i]] placeholder set (a
    // duplicate index, one out of range, or a missing index) makes the
    // whole response unusable regardless of anything else below, and this
    // was previously never checked server-side at all: the client's own
    // parseParagraphResponse (lib/practice.ts) performs exactly this check
    // and silently gives up with NO way to recover, surfacing as
    // "couldn't put today's story together" for what's usually just one
    // mechanical slip (the model is generally fine on the actual German/
    // naturalness side of this prompt -- see its own comment -- but a
    // stray duplicate or dropped placeholder token is a real, observed
    // failure mode). One retry, same budget-conscious pattern as the
    // checks below.
    if (!hasValidPlaceholders(genResult.paragraph, genResult.answers, words.length)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry && hasValidPlaceholders(retry.paragraph, retry.answers, words.length)) genResult = retry;
    }
    if (!followsForcedForms(genResult.paragraph, genResult.answers)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry) genResult = retry;
    }
    // Same idea, for the translations array specifically -- the model can
    // get the placeholders/forced-forms right and still miscount
    // sentences on the translation side (merge two into one, or split one
    // into two), which would misalign every sentence pair after that
    // point in the post-check translation panel.
    if (!hasValidTranslations(genResult.paragraph, genResult.answers, genResult.translations)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry && hasValidTranslations(retry.paragraph, retry.answers, retry.translations)) genResult = retry;
    }

    let { paragraph, answers, translations, usage } = genResult;
    let flagged = await isFlagged(paragraph);
    if (flagged) {
      // One retry with a fresh generation -- a single odd completion isn't
      // worth failing the whole bonus exercise over. A second flag gives up
      // entirely (see the check below) rather than looping.
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry) {
        ({ paragraph, answers, translations, usage } = retry);
        flagged = await isFlagged(paragraph);
      }
    }

    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      word_id: words[0]?.de ?? null,
      level: level || 'unknown',
      model: MODEL,
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    });

    if (flagged) {
      console.error('generate-paragraph: moderation flagged content twice, giving up');
      return json({ error: 'Could not generate suitable content' }, 502);
    }
    if (!paragraph || !Array.isArray(answers) || answers.length !== words.length) {
      console.error('Malformed AI response:', paragraph, answers);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }
    // Final safety net -- the moderation-retry branch above can overwrite
    // `paragraph`/`answers` with a fresh generation that was never itself
    // checked against hasValidPlaceholders, so this re-checks whatever's
    // actually about to be returned rather than trusting the earlier
    // check to still apply. Usage is still logged above either way (a
    // real OpenAI call happened, cost was incurred) -- only the response
    // itself is withheld from the client, same as the other failure
    // branches here.
    if (!hasValidPlaceholders(paragraph, answers, words.length)) {
      console.error('generate-paragraph: invalid placeholder structure after retry', { paragraph, answers });
      return json({ error: 'AI returned an unusable paragraph structure' }, 502);
    }
    if (!followsForcedForms(paragraph, answers)) {
      // Logged, not failed -- after two attempts this is a quality
      // shortfall (the paragraph is still structurally usable, see
      // parseParagraphResponse), not worth burning a third AI call over for
      // a skippable bonus exercise.
      console.warn('generate-paragraph: separable-verb form not followed after retry', { answers, forcedParticiple });
    }
    const resolved = resolvePlaceholders(paragraph, answers);
    const sentences = splitSentences(resolved);
    // A translation-count mismatch even after its own retry is a quality
    // shortfall, not a fatal one -- the fill-in exercise itself is still
    // fully valid (that's all hasValidPlaceholders/followsForcedForms
    // above already guarantee), so this degrades to "no translation
    // panel today" (empty array, see ParagraphExerciseCard's own gating)
    // rather than failing the whole bonus exercise over a bonus-on-top-
    // of-a-bonus feature.
    const alignedTranslations = translations.length === sentences.length ? translations : [];
    if (alignedTranslations.length === 0) {
      console.warn('generate-paragraph: translation/sentence count mismatch after retry', { sentences, translations });
    }

    return json({ paragraph, answers, sentences, translations: alignedTranslations });
  } catch (err) {
    console.error('generate-paragraph error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

async function generateOnce(
  wordList: string,
  count: number,
  level: string,
  range: { minSentences: number; maxSentences: number; minWords: number; maxWords: number },
  themeHint: string | undefined,
  wantsZh: boolean,
): Promise<{ paragraph: string; answers: string[]; translations: string[]; usage: { prompt_tokens?: number; completion_tokens?: number } } | null> {
  const completion = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `You are writing a short German reading exercise for a CEFR ${level || 'A1'} learner. ` +
            `Write ONE short German paragraph, ${range.minSentences}-${range.maxSentences} sentences, ` +
            `${range.minWords}-${range.maxWords} words total (count every word -- this is a hard ` +
            'requirement). It must be a coherent, natural, meaningful everyday scene -- never a ' +
            'string of sentences stitched together just to fit the words in. Keep the tone warm, ' +
            'wholesome and appropriate for all ages: no violence, death, danger, illness, conflict, ' +
            'or anything upsetting or controversial. Make it a plain, made-up, generic everyday ' +
            'scene (a family, friends, a normal day, a hobby, a trip) -- NOT tied to any real event. ' +
            'Never mention politics, religion, or any other sensitive/divisive topic. Never name a ' +
            'real person, company, brand, or organization -- use invented or generic names only ' +
            '(e.g. "Anna", "Herr Schmidt", "das Café", never a real celebrity, politician, or ' +
            'company). Never state or imply any historical fact, date, or claim -- nothing depends ' +
            'on getting real-world facts right, so simply don\'t reference real history at all. ' +
            (themeHint ? `If it fits naturally, build the scene around the theme "${themeHint}". ` : '') +
            `The paragraph must use EVERY ONE of these ${count} words exactly once, each in its ` +
            'most natural inflected/conjugated form for its place in the sentence (nouns may need ' +
            'their plural or a different case ending via the given article; verbs may use any ' +
            'natural tense/person, not just the infinitive):\n' +
            wordList +
            '\n\nFor each of these words, put a placeholder token `[[i]]` (i = the number before ' +
            'that word above) exactly where its inflected form belongs in the paragraph text -- the ' +
            'placeholder REPLACES that word. Never write that German word (in any form) anywhere ' +
            'else in the paragraph too -- each of the given words must appear EXACTLY ONCE in the ' +
            'whole text, at its placeholder, and nowhere else. Follow each word\'s own instructions ' +
            'above exactly, especially any separable-prefix verb\'s forced perfect-tense wording. ' +
            'Every index from 0 to ' +
            (count - 1) +
            ' must appear exactly once. ' +
            `Also translate the paragraph into ${wantsZh ? 'natural, fluent Simplified Chinese' : 'natural, fluent English'} ` +
            '(meaning-for-meaning, not word-for-word), split into a "translations" array with EXACTLY ' +
            'one entry per sentence of the German paragraph, in the SAME order they appear -- ' +
            'translations.length must equal the number of sentences you actually wrote. Each ' +
            'translations[i] must correspond to exactly one German sentence, so a reader can match ' +
            'them up one-to-one -- before writing the translations array, re-read the German ' +
            'paragraph you just wrote and number its sentences by their sentence-ending punctuation ' +
            '(. ! ?) in left-to-right order; translations[i] must translate exactly the sentence you ' +
            'numbered i, not a paraphrase pieced together from a different one. ' +
            (wantsZh
              ? "Chinese verbs don't inflect for tense the way German does, so keep each sentence's " +
                'tense unambiguous: use the completed-action particle 了 or an explicit time word ' +
                "where the German is a completed/past action, and don't add 了 where it's present/" +
                'habitual. '
              : '') +
            'Respond with exactly this JSON: ' +
            '{"paragraph": "... [[0]] ... [[1]] ...", "answers": ["form for word 0", "form for word 1", ...], ' +
            '"translations": ["translation of sentence 1", "translation of sentence 2", ...]} ' +
            '-- answers[i] is the exact inflected form you used at placeholder [[i]], in the same ' +
            'order as the numbered word list above (not the order they appear in the paragraph).',
        },
        { role: 'user', content: 'Write the paragraph now.' },
      ],
      temperature: 0.8,
      max_tokens: 700,
    }),
  });

  if (!completion.ok) {
    console.error('OpenAI error:', await completion.text());
    return null;
  }
  const result = await completion.json();
  const raw: string = result.choices?.[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(raw) as { paragraph?: string; answers?: string[]; translations?: string[] };
    if (!parsed.paragraph || !Array.isArray(parsed.answers) || !Array.isArray(parsed.translations)) return null;
    return { paragraph: parsed.paragraph, answers: parsed.answers, translations: parsed.translations, usage: result.usage ?? {} };
  } catch {
    return null;
  }
}

// OpenAI's moderation endpoint -- free, so there's no cost reason to skip
// it for content this open-ended. Fails OPEN (treats a moderation-call
// error as "not flagged") rather than blocking the whole exercise on a
// second, unrelated API being briefly down -- the system prompt's own tone
// instructions are still the first line of defense either way.
async function isFlagged(text: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.results?.[0]?.flagged;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
