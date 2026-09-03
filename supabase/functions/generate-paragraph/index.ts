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
    const { level, words, themeHint } = body;
    // 2-3 mirrors MIN_PARAGRAPH_WORDS/MAX_PARAGRAPH_WORDS in
    // lib/practice.ts -- enforced again here since this is a public
    // endpoint and the client-side batching is only a courtesy, not a
    // guarantee.
    if (!Array.isArray(words) || words.length < 2 || words.length > 3) {
      return json({ error: 'Expected 2-3 words' }, 400);
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
        if (w.type === 'noun') {
          return `${i}: "${w.de}" (${[w.article, `plural: ${w.plural || 'none'}`].filter(Boolean).join(', ')})`;
        }
        if (w.type === 'verb') {
          const participle = forcedParticiple[i];
          if (participle) {
            const aux = w.perfectTense!.split(' ')[0];
            return (
              `${i}: "${w.de}" -- this is a separable-prefix verb. You MUST use its perfect tense: ` +
              `write "${aux}" as normal text immediately before placeholder [[${i}]], and the answer ` +
              `for [[${i}]] must be exactly "${participle}" (nothing else, no prefix elsewhere).`
            );
          }
          return `${i}: "${w.de}" (infinitive; natural tense/person forms: ${[w.thirdPerson, w.pastTense, w.perfectTense].filter(Boolean).join(' / ')})`;
        }
        return `${i}: "${w.de}" (${w.type})`;
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

    let genResult = await generateOnce(wordList, words.length, level, range, themeHint);
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
      const retry = await generateOnce(wordList, words.length, level, range, themeHint);
      if (retry && hasValidPlaceholders(retry.paragraph, retry.answers, words.length)) genResult = retry;
    }
    if (!followsForcedForms(genResult.paragraph, genResult.answers)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint);
      if (retry) genResult = retry;
    }

    let { paragraph, answers, usage } = genResult;
    let flagged = await isFlagged(paragraph);
    if (flagged) {
      // One retry with a fresh generation -- a single odd completion isn't
      // worth failing the whole bonus exercise over. A second flag gives up
      // entirely (see the check below) rather than looping.
      const retry = await generateOnce(wordList, words.length, level, range, themeHint);
      if (retry) {
        ({ paragraph, answers, usage } = retry);
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

    return json({ paragraph, answers });
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
  themeHint?: string,
): Promise<{ paragraph: string; answers: string[]; usage: { prompt_tokens?: number; completion_tokens?: number } } | null> {
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
            ' must appear exactly once. Respond with exactly this JSON: ' +
            '{"paragraph": "... [[0]] ... [[1]] ...", "answers": ["form for word 0", "form for word 1", ...]} ' +
            '-- answers[i] is the exact inflected form you used at placeholder [[i]], in the same ' +
            'order as the numbered word list above (not the order they appear in the paragraph).',
        },
        { role: 'user', content: 'Write the paragraph now.' },
      ],
      temperature: 0.8,
      max_tokens: 500,
    }),
  });

  if (!completion.ok) {
    console.error('OpenAI error:', await completion.text());
    return null;
  }
  const result = await completion.json();
  const raw: string = result.choices?.[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(raw) as { paragraph?: string; answers?: string[] };
    if (!parsed.paragraph || !Array.isArray(parsed.answers)) return null;
    return { paragraph: parsed.paragraph, answers: parsed.answers, usage: result.usage ?? {} };
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
