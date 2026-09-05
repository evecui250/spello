// Generates the bonus end-of-introduction "Words in Context" exercise: a
// short German paragraph (or, for a group of just 1-2 words that don't
// cluster naturally with anything else, a single short standalone
// sentence -- same call, same shape, just a smaller target) using a small
// group of today's new words -- see lib/practice.ts's
// buildWordsInContextBatches for how the client decides group boundaries.
// Each target word is blanked out as a `[[i]]` placeholder (i = that
// word's index in the `words` array this request sent) so the client can
// splice the learner's drag-and-drop answer back into the exact spot --
// see lib/practice.ts's parseParagraphResponse for how the response is
// consumed. Same key-handling/rate-limiting/ai_usage rationale as
// generate-sentence: the OpenAI key lives only here, and every call
// counts against the same combined per-caller daily cap.
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
// gpt-5.6-luna (released July 2026, the fast/cheap "nano" tier of the
// GPT-5.6 family) -- owner's own pick for this specific task: a short,
// high-volume, cost-sensitive generation, unlike generate-sentence's own
// separate model choice. It's a reasoning-tier model with real API
// differences from gpt-4o's plain chat-completion shape -- see
// callOpenAI's own comment for the two that matter here (no custom
// temperature at all, and max_completion_tokens instead of max_tokens).
const MODEL = 'gpt-5.6-luna';

// Same combined per-caller cap as generate-sentence/correct-sentence --
// every AI Edge Function shares one ai_usage-backed daily ceiling.
const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

// Deliberately tighter and shorter than generate-sentence's WORD_RANGE --
// this is a whole paragraph a beginner has to read and hold in their head
// at once, not one sentence. Mirrors lib/practice.ts's
// WORDS_IN_CONTEXT_RANGE (kept in sync by hand -- no shared module exists
// between client and Edge Function in this codebase, same convention as
// GAME_PLAY_DAILY_POINT_CAP elsewhere). These are targets the prompt asks
// for and isReasonableLength checks "reasonably close to," not hard
// walls -- naturalness/correctness wins over hitting an exact count.
// C1/C2 mirror B2 (no corpus there yet, kept for completeness).
interface WordsInContextRange {
  minTargets: number; maxTargets: number;
  minSentences: number; maxSentences: number;
  minWords: number; maxWords: number;
}
const WORDS_IN_CONTEXT_RANGE: Record<string, WordsInContextRange> = {
  A1: { minTargets: 2, maxTargets: 3, minSentences: 2, maxSentences: 3, minWords: 20, maxWords: 35 },
  A2: { minTargets: 3, maxTargets: 4, minSentences: 3, maxSentences: 4, minWords: 30, maxWords: 50 },
  B1: { minTargets: 3, maxTargets: 5, minSentences: 4, maxSentences: 5, minWords: 45, maxWords: 70 },
  B2: { minTargets: 4, maxTargets: 5, minSentences: 4, maxSentences: 6, minWords: 60, maxWords: 85 },
  C1: { minTargets: 4, maxTargets: 5, minSentences: 5, maxSentences: 6, minWords: 70, maxWords: 95 },
  C2: { minTargets: 4, maxTargets: 5, minSentences: 5, maxSentences: 6, minWords: 70, maxWords: 100 },
};

// A group smaller than this level's own minTargets is the "standalone
// sentence" case (1-2 leftover words that didn't cluster with anything
// else -- see buildWordsInContextBatches) -- scales the level's normal
// target range down proportionally rather than needing a second
// hardcoded table just for the small-group case. Floors keep a 1-word
// exercise from being asked for an unreasonably tiny (or zero-word)
// target.
function effectiveRange(range: WordsInContextRange, count: number): { minSentences: number; maxSentences: number; minWords: number; maxWords: number } {
  if (count >= range.minTargets) {
    return { minSentences: range.minSentences, maxSentences: range.maxSentences, minWords: range.minWords, maxWords: range.maxWords };
  }
  const ratio = count / range.minTargets;
  return {
    minSentences: 1,
    maxSentences: Math.max(1, Math.round(range.minSentences * ratio)),
    minWords: Math.max(6, Math.round(range.minWords * ratio)),
    maxWords: Math.max(12, Math.round(range.maxWords * ratio)),
  };
}

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
    // Floor of 1 (not 2) -- a standalone-sentence batch of exactly one
    // word is an explicit, intentional case now (see
    // buildWordsInContextBatches), not just the runtime split-on-failure
    // fallback's smallest possible half.
    if (!Array.isArray(words) || words.length < 1 || words.length > 5) {
      return json({ error: 'Expected 1-5 words' }, 400);
    }
    const levelRange = WORDS_IN_CONTEXT_RANGE[level] ?? WORDS_IN_CONTEXT_RANGE.B1;
    const range = effectiveRange(levelRange, words.length);

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

    // Compact -- de, meaning, part of speech, and (for a noun) its
    // article/plural. Conjugated forms are only spelled out for the
    // forced separable-verb case, which genuinely needs the auxiliary +
    // participle pinned down (see the comment above); an ordinary verb no
    // longer gets its thirdPerson/pastTense/perfectTense listed at all --
    // free tense/person choice was already what the prompt asked for.
    const wordList = words
      .map((w, i) => {
        const participle = forcedParticiple[i];
        if (participle) {
          const aux = w.perfectTense!.split(' ')[0];
          return (
            `${i}. ${w.de} — ${w.en} — verb, separable-prefix. You MUST use its perfect tense, and keep the ` +
            'clause containing it very short: just a subject, then the auxiliary, then the placeholder, with ' +
            'nothing else in that same clause (mention any other people/places/things in a separate sentence ' +
            `instead). Write "${aux}" as normal text immediately before placeholder [[${i}]] -- no other word ` +
            `between them -- and the answer for [[${i}]] must be exactly "${participle}" (nothing else, no ` +
            'prefix elsewhere).'
          );
        }
        if (w.type === 'noun') {
          return `${i}. ${w.de} — ${w.en} — noun${w.article ? `, ${w.article}` : ''}${w.plural ? `; plural: ${w.plural}` : ''}`;
        }
        return `${i}. ${w.de} — ${w.en} — ${w.type}`;
      })
      .join('\n');

    const auxByIndex: (string | null)[] = words.map((w, i) => (forcedParticiple[i] ? w.perfectTense!.split(' ')[0] : null));

    // A forced separable-verb slot only actually works if BOTH halves are
    // right: the answer string must be the bare participle (checked
    // before), AND the auxiliary must genuinely appear immediately before
    // that placeholder in the paragraph text -- checking the answer alone
    // isn't enough. Confirmed real (live test, this rewrite, twice): a
    // more "natural word order" version of this check/prompt (letting the
    // aux sit anywhere earlier in the clause, participle at the clause's
    // own end) sounded right in theory but measurably made gpt-5.6-luna's
    // actual output WORSE, not better -- it started duplicating the
    // participle as literal text AND misplacing the placeholder in an
    // unrelated (often noun-shaped) slot, a much more confusing failure
    // than this stricter version's own imperfect-but-comprehensible word
    // order ("hat abgeholt meine Schwester ihr Kind" reads awkwardly but
    // parses fine; the "natural order" attempt produced outright
    // nonsense). Reverted to strict adjacency, paired with a prompt
    // instruction (see the wordList comment above) to keep that specific
    // clause minimal so the adjacency is actually grammatical rather than
    // just tolerated.
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

    // New: every answer must actually say something -- Structured Outputs
    // guarantees the answers array exists and is the right JSON shape, but
    // not that every entry is non-blank content.
    function hasNoEmptyAnswers(answers: string[]): boolean {
      return answers.every(a => typeof a === 'string' && a.trim().length > 0);
    }

    // New, confirmed real via live testing this rewrite (a 5-word B2
    // batch): the model can scramble WHICH target word each answers[i]
    // actually belongs to -- e.g. a verb's inflected form landing at a
    // noun's index, with a noun's own answer landing somewhere else
    // entirely. hasValidPlaceholders alone can't catch this (every index
    // 0..count-1 still appears exactly once as a placeholder; the wrong
    // WORD is just attached to it), and it's a much more serious failure
    // than the others here -- the learner would be shown the wrong German
    // word as "correct" for that blank, not just an awkward sentence.
    // Heuristic (exact grammatical-inflection matching isn't practical
    // here): the answer and the target's own dictionary form must share
    // a long-enough common prefix to be plausibly the same word inflected
    // (a plural/case/tense ending), which a totally different word landing
    // at the wrong index will not. forcedParticiple entries are skipped --
    // followsForcedForms already checks those exactly.
    function answersMatchWords(answers: string[]): boolean {
      return words.every((w, i) => {
        if (forcedParticiple[i]) return true;
        const a = (answers[i] ?? '').toLowerCase();
        const stem = w.de.toLowerCase();
        if (!a) return false;
        let common = 0;
        while (common < a.length && common < stem.length && a[common] === stem[common]) common++;
        return common >= Math.min(4, stem.length);
      });
    }

    // New, confirmed real via live testing this rewrite: a noun blank can
    // land with literally nothing in front of it ("sitzt [[i]]" ->
    // "sitzt Katze" once resolved -- missing its article entirely).
    // Heuristic, not exhaustive -- checks the few words immediately
    // before a noun's placeholder for a recognizable German determiner or
    // a fixed preposition contraction that already covers it (an
    // adjective can sit between the two, e.g. "die kleine [[i]]", hence
    // checking a short window rather than just the one adjacent word).
    // A false negative here just costs one extra retry, not a wrong
    // answer -- same low-stakes budget as the other quality checks below.
    const GERMAN_DETERMINERS = new Set([
      'der', 'die', 'das', 'den', 'dem', 'des',
      'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
      'kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines',
      'mein', 'meine', 'meinen', 'meinem', 'meiner', 'meines',
      'dein', 'deine', 'deinen', 'deinem', 'deiner', 'deines',
      'sein', 'seine', 'seinen', 'seinem', 'seiner', 'seines',
      'ihr', 'ihre', 'ihren', 'ihrem', 'ihrer', 'ihres',
      'unser', 'unsere', 'unseren', 'unserem', 'unserer', 'unseres',
      'dieser', 'diese', 'dieses', 'diesen', 'diesem',
      'jeder', 'jede', 'jedes', 'jeden', 'jedem',
      'zum', 'zur', 'im', 'ins', 'am', 'beim', 'vom', 'ans',
    ]);
    function nounsHaveArticles(paragraph: string): boolean {
      return words.every((w, i) => {
        if (w.type !== 'noun') return true;
        const m = new RegExp(`\\[\\[${i}\\]\\]`).exec(paragraph);
        if (!m) return true; // hasValidPlaceholders already covers a missing placeholder
        const before = paragraph.slice(0, m.index).trim().split(/\s+/).slice(-3)
          .map(t => t.toLowerCase().replace(/[.,!?]/g, ''));
        return before.some(t => GERMAN_DETERMINERS.has(t));
      });
    }

    // New: the resolved German text should land reasonably close to this
    // batch's target word-count band -- not exact (naturalness wins over
    // hitting a count, per the owner's own framing), just not wildly off
    // in either direction. +/-30% keeps this a sanity check, not a hard
    // wall the model has to hit precisely.
    function isReasonableLength(paragraph: string, answers: string[]): boolean {
      const words = resolvePlaceholders(paragraph, answers).trim().split(/\s+/).filter(Boolean).length;
      return words >= range.minWords * 0.7 && words <= range.maxWords * 1.3;
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
    // "couldn't put today's exercise together" for what's usually just one
    // mechanical slip (the model is generally fine on the actual German/
    // naturalness side of this prompt -- see its own comment -- but a
    // stray duplicate or dropped placeholder token is a real, observed
    // failure mode). One retry, same budget-conscious pattern as the
    // checks below.
    if (!hasValidPlaceholders(genResult.paragraph, genResult.answers, words.length)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry && hasValidPlaceholders(retry.paragraph, retry.answers, words.length)) genResult = retry;
    }
    // Same severity tier as hasValidPlaceholders above -- a scrambled
    // answer-to-word mapping is as unusable as a malformed placeholder
    // set, just a subtler way to get there.
    if (!answersMatchWords(genResult.answers)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry && answersMatchWords(retry.answers)) genResult = retry;
    }
    if (!followsForcedForms(genResult.paragraph, genResult.answers)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry) genResult = retry;
    }
    if (!hasNoEmptyAnswers(genResult.answers)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry && hasNoEmptyAnswers(retry.answers)) genResult = retry;
    }
    if (!nounsHaveArticles(genResult.paragraph)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry && nounsHaveArticles(retry.paragraph)) genResult = retry;
    }
    if (!isReasonableLength(genResult.paragraph, genResult.answers)) {
      const retry = await generateOnce(wordList, words.length, level, range, themeHint, wantsZh);
      if (retry && isReasonableLength(retry.paragraph, retry.answers)) genResult = retry;
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
    if (!answersMatchWords(answers)) {
      console.error('generate-paragraph: answer/word mapping scrambled after retry', { words: words.map(w => w.de), answers });
      return json({ error: 'AI mismatched an answer to the wrong word' }, 502);
    }
    if (!followsForcedForms(paragraph, answers)) {
      // Logged, not failed -- after two attempts this is a quality
      // shortfall (the paragraph is still structurally usable, see
      // parseParagraphResponse), not worth burning a third AI call over for
      // a skippable bonus exercise.
      console.warn('generate-paragraph: separable-verb form not followed after retry', { answers, forcedParticiple });
    }
    if (!hasNoEmptyAnswers(answers)) {
      console.error('generate-paragraph: empty answer after retry', { answers });
      return json({ error: 'AI returned an incomplete answer' }, 502);
    }
    if (!nounsHaveArticles(paragraph)) {
      // Hard fail, per the owner's own explicit call -- a noun blank
      // missing its article is confirmed real (live-tested this rewrite)
      // and reads as broken German to a learner ("sitzt Katze"), not
      // just an awkward stylistic choice.
      console.error('generate-paragraph: missing article before a noun blank after retry', { paragraph });
      return json({ error: 'AI dropped an article before a noun blank' }, 502);
    }
    if (!isReasonableLength(paragraph, answers)) {
      // Logged, not failed -- same "quality shortfall, not fatal" call as
      // followsForcedForms above; the exercise is still fully usable.
      console.warn('generate-paragraph: paragraph length outside target range after retry', { range, paragraph });
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

// Structured Outputs schema -- guarantees the response is valid JSON
// shaped exactly like this (right keys, right types), which removes the
// need for the old try/catch-around-JSON.parse fallback. It does NOT
// guarantee the *content* rules (placeholder correctness, non-empty
// answers, translation alignment, length) -- every content-level check
// above still runs regardless.
//
// `answers` is an array of {index, answer} objects, NOT a plain
// positional string array. Confirmed real via live testing: with a plain
// array, the model would occasionally scramble which answer landed at
// which array position on larger (5-word) batches -- e.g. a verb's
// inflected form ending up at a noun's position -- silently teaching the
// wrong word for a blank, roughly 80% of the time at 5 words even after
// an internal retry. Tagging every answer with its own target index
// removes the need for the model to track "position N in this array
// means target N" as a SEPARATE mental model from "[[N]] in the text
// means target N" -- it only has to get the second part right, and say
// so explicitly, rather than silently implying the first. toPositionalAnswers
// below converts this back into the plain string[] every other function
// in this file already works with, so only parsing changes.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    paragraph: { type: 'string' },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          answer: { type: 'string' },
        },
        required: ['index', 'answer'],
        additionalProperties: false,
      },
    },
    translations: { type: 'array', items: { type: 'string' } },
  },
  required: ['paragraph', 'answers', 'translations'],
  additionalProperties: false,
};

// Converts the tagged {index, answer}[] shape above into the plain
// positional string[] every validation/rendering function in this file
// works with. Rejects (returns null, treated as a malformed generation --
// same recovery path as any other parse failure) unless every index
// 0..count-1 has EXACTLY one answer: no duplicates, none out of range,
// none missing. This is "every target index has exactly one answer" and
// "no unknown indices" from the hard-validation list, enforced at the
// earliest possible point.
function toPositionalAnswers(raw: unknown, count: number): string[] | null {
  if (!Array.isArray(raw)) return null;
  const result: (string | undefined)[] = new Array(count).fill(undefined);
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const { index, answer } = entry as { index?: unknown; answer?: unknown };
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count) return null;
    if (typeof answer !== 'string' || result[index] !== undefined) return null;
    result[index] = answer;
  }
  return result.every((a): a is string => a !== undefined) ? result : null;
}

// gpt-5.6-luna is a reasoning-tier model with two real API differences
// from gpt-4o's plain chat-completion call: it rejects any custom
// `temperature` outright (400 error, confirmed via research -- omitted
// entirely below, not just left at a "safe" value), and Chat Completions
// requires `max_completion_tokens` instead of `max_tokens` for reasoning
// models. `reasoning_effort` is the actual lever used here in place of
// temperature -- not a literal substitute (it controls how much the model
// "thinks," not sampling randomness), but the closest thing this model
// exposes for fast, direct, low-variance output on a short high-volume
// task, and matches the owner's own explicit choice of 'none'.
//
// One more wrinkle found during research (not something an API key was
// available here to verify firsthand): a reported case of gpt-5.6-luna/
// sol/terra rejecting reasoning_effort: 'none' specifically on
// /chat/completions, unlike other GPT-5-series models where 'none' is a
// normal valid value. Rather than silently using a different value than
// requested, or leaving the whole feature broken if that report is
// accurate, this tries 'none' first and falls back to 'low' exactly once
// if OpenAI's own error text calls out reasoning_effort as the problem.
async function callOpenAI(body: Record<string, unknown>, reasoningEffort: 'none' | 'low'): Promise<Response> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ ...body, reasoning_effort: reasoningEffort }),
  });
  if (!res.ok && reasoningEffort === 'none') {
    const errText = await res.clone().text();
    if (errText.toLowerCase().includes('reasoning_effort')) {
      console.warn('generate-paragraph: reasoning_effort "none" rejected, retrying with "low"', errText);
      return callOpenAI(body, 'low');
    }
  }
  return res;
}

async function generateOnce(
  wordList: string,
  count: number,
  level: string,
  range: { minSentences: number; maxSentences: number; minWords: number; maxWords: number },
  themeHint: string | undefined,
  wantsZh: boolean,
): Promise<{ paragraph: string; answers: string[]; translations: string[]; usage: { prompt_tokens?: number; completion_tokens?: number } } | null> {
  const completion = await callOpenAI({
    model: MODEL,
    max_completion_tokens: 500,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'words_in_context_exercise', strict: true, schema: RESPONSE_SCHEMA },
    },
    messages: [
      {
        role: 'system',
        content:
          `You create high-quality German fill-in-the-blank exercises for CEFR ${level || 'A1'} learners.\n\n` +
          'Write one natural, coherent everyday scene using the target words below.\n\n' +
          'Target:\n' +
          `- ${range.minSentences}-${range.maxSentences} sentences\n` +
          `- approximately ${range.minWords}-${range.maxWords} words\n\n` +
          (themeHint ? `If it fits naturally, build the scene around the theme "${themeHint}".\n\n` : '') +
          'TARGET WORDS:\n' +
          wordList +
          '\n\n' +
          'Requirements:\n' +
          '- First silently choose a simple scene where all target words fit naturally.\n' +
          '- The text must sound like natural German, not unrelated sentences joined together to include vocabulary.\n' +
          `- Use grammar and vocabulary appropriate for CEFR ${level || 'A1'}.\n` +
          '- Use every target word with exactly the supplied meaning.\n' +
          '- Use each target exactly once, in the grammatically correct inflected or conjugated form.\n' +
          '- Replace that form with its corresponding [[i]] placeholder (i = the number before that word above) -- ' +
          'the placeholder REPLACES the word. Placeholders may appear in the text in ANY order that reads ' +
          "naturally -- they do NOT need to go [[0]], [[1]], [[2]]... in sequence; write whatever order the " +
          'scene actually calls for, as long as each index 0 through ' + (count - 1) +
          ' appears exactly once, wherever it belongs.\n' +
          '- In the "answers" array, tag every answer with the SAME index i as its placeholder -- ' +
          '{"index": i, "answer": "the exact form you wrote at [[i]]"} -- one entry per target, in any order. ' +
          'Do not rely on array position to convey which target an answer belongs to; the index field is what ' +
          'matters.\n' +
          '- For a noun target, the placeholder replaces ONLY the noun itself -- write whatever article, ' +
          'possessive, or quantifier the sentence grammatically needs (e.g. "die", "meine", "ein") as normal ' +
          'text immediately before the placeholder, unless a fixed preposition contraction (e.g. "zum", "im") ' +
          'already covers it. A bare noun placeholder with nothing in front of it (e.g. "sitzt [[i]]") is wrong ' +
          'unless that is genuinely how German omits the article there.\n' +
          '- Do not use another form of that target elsewhere in the text -- each target appears exactly once, at ' +
          'its placeholder, and nowhere else.\n' +
          '- Follow each word\'s own instructions above exactly, especially any separable-prefix verb\'s forced ' +
          'perfect-tense wording.\n' +
          '- Every blank must have enough context that the intended answer is clearly correct.\n' +
          '- Prefer simple, idiomatic German over creative or complicated writing.\n' +
          '- Use only fictional, ordinary, all-ages everyday situations -- a family, friends, a normal day, a ' +
          'hobby, a trip -- never tied to a real event.\n' +
          '- Avoid sensitive topics (politics, religion, violence, danger, illness), real people, brands, ' +
          'organizations, historical events, and factual claims -- nothing here depends on getting a real-world ' +
          'fact right, so simply don\'t reference any.\n' +
          `- Translate each German sentence naturally into ${wantsZh ? 'Simplified Chinese' : 'English'} ` +
          '(meaning-for-meaning, not word-for-word) -- one translations[i] entry per German sentence, in the ' +
          'same left-to-right order, so translations.length equals the number of sentences you actually wrote. ' +
          'Before writing the translations array, re-read the German paragraph you just wrote and number its ' +
          'sentences by their sentence-ending punctuation (. ! ?); translations[i] must translate exactly the ' +
          'sentence you numbered i, not a paraphrase pieced together from a different one.' +
          (wantsZh
            ? "\n- Chinese verbs don't inflect for tense the way German does, so keep each sentence's tense " +
              'unambiguous: use the completed-action particle 了 or an explicit time word where the German is a ' +
              "completed/past action, and don't add 了 where it's present/habitual."
            : '') +
          '\n\nBefore responding, silently verify:\n' +
          '1. the German is grammatical and idiomatic;\n' +
          '2. the scene is coherent and meaningful;\n' +
          '3. every target keeps its supplied meaning;\n' +
          '4. every answer fits its blank grammatically and semantically;\n' +
          '5. every [[i]] appears exactly once, in whatever order the scene naturally calls for;\n' +
          '6. every answer entry\'s "index" field correctly matches the [[i]] it belongs to -- this is the one ' +
          'most worth double-checking, since a mismatched index teaches the learner the wrong word entirely;\n' +
          '7. translations match the German sentences 1:1.\n\n' +
          'Return only the structured output required by the API schema.',
      },
      { role: 'user', content: 'Write the exercise now.' },
    ],
  }, 'none');

  if (!completion.ok) {
    console.error('OpenAI error:', await completion.text());
    return null;
  }
  const result = await completion.json();
  const raw: string = result.choices?.[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(raw) as { paragraph?: string; answers?: unknown; translations?: string[] };
    if (!parsed.paragraph || !Array.isArray(parsed.translations)) return null;
    const answers = toPositionalAnswers(parsed.answers, count);
    if (!answers) return null;
    return { paragraph: parsed.paragraph, answers, translations: parsed.translations, usage: result.usage ?? {} };
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
