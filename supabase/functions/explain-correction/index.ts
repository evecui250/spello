// On-demand ("Why?" button) explanation of a single sentence correction —
// separate from correct-sentence itself so the main check stays fast;
// this only ever runs if the learner actually taps to ask. Deliberately
// GRAMMAR-focused (article/case, adjective agreement, verb tense/
// conjugation, preposition choice, word-class mix-ups like a verb used
// where a noun was needed) rather than a vague "here's what went wrong"
// gloss — that's what's actually learnable from a mistake. Answers in the
// learner's own nativeLanguage (Settings), since a grammar explanation
// they can't read isn't useful. Shares ai_usage's daily cap with
// correct-sentence (same table, counted together) rather than a separate
// budget, so this can't be used to bypass the existing per-caller limit;
// tagged kind='explanation' so admin-stats can see how much this specific
// button actually gets used, separate from corrections.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-4o-mini';

// Same flat daily cap correct-sentence uses, and counted together with it
// (see the query below, which doesn't filter by kind) — this is a bonus
// action on top of a correction that already happened, not a separate
// allowance to budget for independently. (raised from 50/20 on 2026-08-20 —
// a real tester hit the old cap.)
const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  wordId: string;
  wordDe: string;
  level: string;
  originalAttempt: string;
  correctedSentence: string;
  nativeLanguage?: 'en' | 'zh';
  // How many words the correction actually changed (see DailySessionFlow's
  // correctionDiff) — caller-supplied ceiling on how many points make
  // sense at all; a correction that touched one word has one real point to
  // make, not three. Clamped to [1, 3] here regardless of what's sent.
  maxPoints?: number;
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
    const { wordId, wordDe, level, originalAttempt, correctedSentence, nativeLanguage, maxPoints } = body;
    if (!wordId || !correctedSentence) {
      return json({ error: 'Missing wordId or correctedSentence' }, 400);
    }
    if ((originalAttempt?.length ?? 0) > 300 || correctedSentence.length > 300) {
      return json({ error: 'Sentence too long' }, 400);
    }
    const lang = nativeLanguage === 'zh' ? 'Chinese' : 'English';
    const pointCap = Math.min(3, Math.max(1, Math.round(maxPoints ?? 3)));

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
              'You are a German tutor. A beginner learner (CEFR ' + (level || 'A1') + ') tried to ' +
              `translate a sentence, practicing the word "${wordDe}". Their attempt: "${originalAttempt || '(nothing — they left it blank)'}". ` +
              `The correct sentence is: "${correctedSentence}". ` +
              'FIRST, carefully go word by word through BOTH sentences and list every single word ' +
              'that differs at all between the attempt and the correction — do not skip any, ' +
              'including a subtle one- or two-letter difference that looks like a typo (e.g. ' +
              '"geziegt" vs "gezeigt"); missing one of these is a real failure. For EACH changed ' +
              'word, decide which of the two buckets below it belongs to — every changed word goes ' +
              'in exactly one bucket, never both, and never silently dropped: ' +
              '\n\n' +
              '1) SPELLING — the exact same word, just misspelled (letters added/dropped/swapped/' +
              'transposed), with NO actual difference in grammatical form or meaning (e.g. ' +
              '"Testergbnis"/"Testergebnis", "Dokter"/"Doktor", "geziegt"/"gezeigt"). If the word ' +
              'ALSO changed grammatical form on top of the misspelling — most commonly singular to ' +
              'plural, e.g. attempt "Ergenbnis" (a typo for "Ergebnis") but the correction needs ' +
              '"Ergebnisse" (plural) — that is NOT pure spelling: the number itself is a genuine ' +
              'grammar difference (bucket 2 below), so it needs its own grammar point (e.g. \'"für ' +
              'bessere Ergebnisse" needs the plural "Ergebnisse", not singular "Ergebnis"\') even ' +
              'though the base word also happens to be misspelled — do not let the typo cause the ' +
              'plural requirement to go unmentioned entirely. Put every one ' +
              'of these in the "spelling" array as {"wrong": "...", "correct": "..."} using the exact ' +
              'substrings verbatim as they appear in the attempt and correction respectively — do ' +
              'not paraphrase them, and do not also make a grammar point about them. Capitalization ' +
              '(German capitalizes every noun) and hyphenation differences belong here too, not as ' +
              'their own grammar point. There is no cap on how many spelling entries you list — a ' +
              'sentence with three typos needs all three, not just the first. Do NOT put two ' +
              'DIFFERENT WORDS here just because the correction swapped one for the other — a real, ' +
              'confirmed mistake: "aufwenden" (a real verb meaning "to expend/spend") was filed as a ' +
              '"spelling" fix for "verbringen" (an entirely different verb, "to spend time"). Two ' +
              'distinct dictionary words are a WORD-CHOICE issue (bucket 2 below), never spelling — ' +
              'if you cannot tell which bucket a pair belongs in, ask: would a native speaker call ' +
              'the wrong version a TYPO of the right one, or a DIFFERENT WORD? Only the former is ' +
              'spelling. ' +
              '\n\n' +
              '2) GRAMMAR — a genuine difference in form, agreement, tense, case, word choice, a ' +
              `word missing entirely, or word ORDER. Identify AT MOST ${pointCap} of these as ` +
              'concrete points the learner should take away — but fewer is better than more: only ' +
              'include a point for a mistake that is actually there. That said, do NOT under-report ' +
              'either — if there are genuinely 2-3 DISTINCT real grammar issues (e.g. a wrong ' +
              'article AND a wrong adjective ending AND a wrong possessive-pronoun case, all in the ' +
              'same sentence), give each its own point, up to the cap; "fewer is better" means never ' +
              'padding the list with a minor or borderline point just to fill it out, not skipping a ' +
              'second or third issue that is actually there to keep the list short. This applies even ' +
              'when both changed words sit right next to each other in the SAME noun phrase and share ' +
              'the same underlying cause — a real, confirmed miss: the attempt had "einen neue ' +
              'Projekt" and the correction was "ein neues Projekt" (Projekt is neuter), and only the ' +
              'article ("einen" -> "ein") was ever mentioned — the adjective ending ("neue" -> ' +
              '"neues", the SAME neuter agreement applied to a different word) needs its own point ' +
              'too, not just the article. If there is ' +
              'truly only one real grammar issue, return exactly one point. Covers: article/case ' +
              '(der/die/das, den/dem/der agreement), adjective endings, verb tense/conjugation, ' +
              'preposition choice, a word-class mix-up (e.g. using a verb form where a noun was ' +
              'needed, like "reisen" [to travel] instead of "Reisende" [traveler]); a WORD MISSING ' +
              'ENTIRELY from the attempt that the correction added (most commonly a dropped article ' +
              'before a noun, e.g. attempt has "mit Familie", correction has "mit der Familie") — ' +
              'this is not a "changed word" since nothing in the attempt corresponds to it, so ' +
              'checking for insertions specifically, not just substitutions, matters; a real, ' +
              'confirmed miss: a dropped "der" before a dative noun went completely unreported while ' +
              'a minor, defensible word-choice difference got explained instead — a genuinely missing ' +
              'required word always outranks a debatable vocabulary choice, prioritize it; a WORD ' +
              'CHOICE difference ONLY when the attempt\'s word is actually wrong given the sentence\'s ' +
              'meaning (e.g. a verb that does not fit the intended action at all) — if the attempt\'s ' +
              'word is a valid near-synonym of the correction (defensible, just less idiomatic, not ' +
              'objectively wrong), leave it out of the points entirely rather than lecture on a ' +
              'preference; AND word order — TWO DISTINCT rules, name which one actually applies, ' +
              'do not just describe the symptom: (a) MAIN clause verb-second (V2) — the finite verb ' +
              'is always the SECOND element of a main clause, right after the subject (or after ' +
              'whatever else opens the clause), never later; a real, confirmed miss of exactly this ' +
              'shape: the attempt wrote "Die Eltern oft hart arbeiten..." (verb pushed to the end, ' +
              'English word order) instead of "Die Eltern arbeiten oft hart..." — the point must ' +
              'name the RULE, not just the swap: \'The finite verb "arbeiten" must be the second ' +
              'element of the clause, right after the subject "Die Eltern" — not moved to the end.\' ' +
              'A point that only says \'"oft" should come after "arbeiten"\' describes the symptom ' +
              'without ever saying WHY (the verb belongs in second position), which is exactly the ' +
              'rule the learner actually needs; (b) SUBORDINATE clauses (e.g. after "dass", "weil", ' +
              '"obwohl") require the OPPOSITE — the finite verb moves to the very end of the clause. ' +
              'For either rule, if the learner\'s word is already the CORRECT word/form but just in ' +
              'the wrong position, that is a word-order mistake, not a form mistake — say so ' +
              'explicitly by naming where it belongs AND which rule requires it (e.g. \'After ' +
              '"dass", the finite verb "war" must move to the end of the clause.\'). NEVER phrase a ' +
              'point as \'"X" should be "X"\' ' +
              '(the same word on both sides) — if you catch yourself about to write that, it is ' +
              'almost always actually a word-order issue described wrong; fix the phrasing to ' +
              'describe the position, not a form change. A real, confirmed miss of a related shape: ' +
              'the attempt wrote BOTH "hat gefühlt" (a wrong, unrelated verb/tense) AND a badly-' +
              'misspelled "emfpinden" elsewhere, expressing the same idea twice — the correction ' +
              'simply drops the redundant "hat gefühlt" and keeps (the now-corrected) "empfinden". ' +
              'A point phrased as \'"empfinden" should be used instead of "hat gefühlt"\' is ' +
              'misleading here — the learner DID already write (a misspelled) "empfinden" elsewhere ' +
              'in the same sentence, so implying they never used it at all is wrong. When the ' +
              'attempt expresses one idea with two different words/phrases and the correction just ' +
              'removes the redundant one, that is a style/redundancy fix, not a clean grammar rule — ' +
              'omit it from points entirely rather than describe it in a way that misstates what the ' +
              'learner actually wrote. Before writing each point, re-read the ' +
              "attempt's actual word order carefully and confirm EXACTLY which word or phrase in " +
              'the attempt the point is about, and what that word was governing/modifying THERE ' +
              '(not what a similar-looking word would typically govern) — German word order means a ' +
              'preposition/article near one noun in the attempt can land near a different noun in ' +
              'the correction, or vice versa; do not assume based on position alone. If you are not ' +
              'sure which specific word changed or what it was attached to, leave that point out ' +
              'rather than risk mis-describing it. Before including ANY point, check the exact word/ ' +
              'phrase you are about to quote as "wrong" against what you are about to quote as ' +
              '"correct" — if they are character-for-character identical, that word did NOT actually ' +
              'change between the attempt and the correction (a real case: "Erwerb" appeared ' +
              'unchanged in both, yet a point was invented claiming it needed to agree with a nearby ' +
              'plural noun — it did not, nothing about it was wrong). Do not invent an agreement/case ' +
              'reason for a word just because a plural or other noun sits nearby; find whichever word ' +
              'ACTUALLY differs instead, or omit the point entirely if nothing nearby actually does. ' +
              'Only flag something as a mistake if the German ' +
              'grammar OBJECTIVELY requires a specific form given what the English sentence actually ' +
              'says. If the English sentence itself is silent or ambiguous on a detail — most ' +
              'commonly formal vs informal address ("Sie" vs "du/ihn/ihm/dich"), or a pronoun that ' +
              'does not pin down gender/number/formality — and the learner picked one valid reading ' +
              'of that ambiguity, do NOT treat it as wrong, even though the correction happens to use ' +
              'a different valid choice; leave it out of the points entirely rather than describe it ' +
              'as a mistake. Do not simply say a word "was wrong" — every point must explain the ' +
              'actual grammar rule behind the fix, briefly, so it is something the learner can apply ' +
              'next time. For an AGREEMENT fix specifically (adjective ending, article, or ' +
              'possessive pronoun matching a noun\'s gender/case), use this compact shape and ' +
              'nothing more verbose: \'"[word]" before "[noun]" should be "[corrected form]" ' +
              'because "[noun]" is [gender/case].\' State the answer directly in that shape — do not ' +
              'restate the rule abstractly first (e.g. "the adjective needs the correct ending") ' +
              'before finally giving the specific answer. The same directness applies to every other ' +
              'point too: lead with the concrete fact itself, not a restated category label. For ' +
              'example, in Chinese, prefer a compact phrasing like \'"Sozialarbeiter" 是阳性，所以' +
              '是der而不是die\' over a longer \'名词的性别和格需要正确匹配，例如"der ' +
              'Sozialarbeiter"而不是"die Sozialarbeiter"\' — same information, without the ' +
              'throat-clearing. Skip anything you are not confident is actually correct — accuracy ' +
              `matters more than reaching ${pointCap}; fewer solid points beats padding out to ` +
              `${pointCap} with a shaky one. If the attempt was blank, too garbled, or simply used ` +
              'different (not wrong) vocabulary with no real grammar issue to point out, return a ' +
              'single point that briefly says what the correct sentence means instead. Each point ' +
              `must be ONE short, plain sentence (no more than ~20 words), written in ${lang}, and ` +
              'must NOT repeat the full corrected sentence back — the learner can already see it. ' +
              '\n\n' +
              'Respond with exactly this JSON: {"points": ["...", ...], "spelling": [{"wrong": ' +
              '"...", "correct": "..."}, ...]}. Either array may be empty (e.g. spelling: [] if ' +
              'there were no pure spelling mistakes at all), but not both.',
          },
        ],
        temperature: 0.2,
        max_tokens: 350,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error (explain-correction):', errText);
      return json({ error: 'Explanation failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { points?: string[]; spelling?: { wrong?: string; correct?: string }[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed empty — caught by the check below
    }
    const usage = result.usage ?? {};
    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      word_id: wordId,
      level: level || 'unknown',
      model: MODEL,
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      kind: 'explanation',
    });

    // Hard backstop for the exact failure the prompt above tries to head
    // off ("Erwerb" should be "Erwerb" because it needs to match the
    // plural "Fähigkeiten" — a real, confirmed case where the model
    // invented an agreement reason for a word that hadn't actually
    // changed at all). Catches the same-quoted-substring-twice shape
    // regardless of phrasing, so a prompt-compliance slip still can't
    // reach the learner as a nonsensical point. Two real, confirmed gaps
    // fixed here: (1) this only ever matched double quotes, but the model
    // routinely uses single quotes instead (unsurprising inside a JSON
    // string value, where a literal ' needs no escaping but a literal "
    // does); (2) the gap between the repeated word excluded ANY quote
    // character at all, so a point mentioning a THIRD quoted word in
    // between ("'die' before 'Bedürfnisse' should be 'die' because
    // 'Bedürfnisse' is plural") couldn't match either — only a period
    // (keeping the check within one point/sentence) is excluded from the
    // gap now, not quotes generally.
    const SAME_WORD_POINT = /["']([^"']+)["'][^.]*\bshould be\b[^.]*["']\1["']/i;
    let points = Array.isArray(parsed.points)
      ? parsed.points.filter(p => typeof p === 'string' && p.trim() && !SAME_WORD_POINT.test(p))
      : [];
    let spelling = Array.isArray(parsed.spelling)
      ? parsed.spelling.filter((s): s is { wrong: string; correct: string } =>
          !!s && typeof s.wrong === 'string' && !!s.wrong.trim() && typeof s.correct === 'string' && !!s.correct.trim()
          // Same backstop as SAME_WORD_POINT above, for the structured
          // side: a "spelling mistake" that's actually identical on both
          // sides isn't one.
          && s.wrong.trim() !== s.correct.trim())
      : [];

    // Real, confirmed case: the model classified "aufwenden" -> "verbringen"
    // (two entirely different verbs) as "spelling", despite the prompt's own
    // explicit definition (same word, just misspelled) ruling that out --
    // instructions alone weren't reliable enough here, same reason
    // SAME_WORD_POINT exists as a hard backstop rather than just a prompt
    // request. A genuine typo has a small edit distance relative to word
    // length (confirmed against real corpus examples: "gefült"/"gefühlt" ~15%
    // different, "geziegt"/"gezeigt" ~28%); two different words don't
    // ("aufwenden"/"verbringen" ~70%). Anything over half the longer word's
    // length is dropped from spelling entirely, not reclassified as a
    // grammar point either -- if it's a defensible near-synonym rather than
    // an objective error, the prompt's own "only flag what's objectively
    // wrong" rule already means no point should exist for it anyway.
    spelling = spelling.filter(s => levenshtein(s.wrong.trim().toLowerCase(), s.correct.trim().toLowerCase()) / Math.max(s.wrong.length, s.correct.length) <= 0.5);

    // Second, distinct real case from the same underlying cause: "Familie"
    // -> "der Familie" (a missing article -- the exact grammar point
    // already correctly identified elsewhere in the SAME response) also
    // got filed as "spelling". A missing article passed the edit-distance
    // check above (inserting "der " is a small edit relative to length),
    // so it needs its own guard: a genuine spelling fix never changes how
    // many space-separated words are on each side (it corrects letters
    // WITHIN an existing word, like "hat gefült" -> "hat gefühlt", still
    // two words both sides) -- a word count mismatch means a whole word
    // was added or dropped, which is a grammar issue (usually a missing
    // article), never spelling.
    spelling = spelling.filter(s => s.wrong.trim().split(/\s+/).length === s.correct.trim().split(/\s+/).length);

    // Real, confirmed case: a spelling entry ("bissen" -> "bisschen") got a
    // SECOND, redundant point ALSO explaining "'bissen' should be
    // 'bisschen' for the correct spelling" -- directly contradicting the
    // prompt's own explicit "do not also make a grammar point about them"
    // instruction for spelling entries. A code-level filter closes this
    // the same way SAME_WORD_POINT does for a different compliance slip:
    // drop any point that explicitly says "spelling" (the exact tell in
    // the real case) or that quotes BOTH sides of an already-listed
    // spelling entry (a near-certain restatement regardless of phrasing).
    points = points.filter(p => {
      const lower = p.toLowerCase();
      if (lower.includes('spelling')) return false;
      return !spelling.some(s => lower.includes(s.wrong.trim().toLowerCase()) && lower.includes(s.correct.trim().toLowerCase()));
    });

    if (points.length === 0 && spelling.length === 0) {
      console.error('Malformed AI response (explain-correction):', raw);
      return json({ error: 'AI returned an empty explanation' }, 502);
    }
    return json({ points, spelling });
  } catch (err) {
    console.error('explain-correction error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Standard edit distance -- used above purely to tell "a genuine typo of
// the same word" from "a different word entirely" for a spelling entry's
// own sanity check, not for anything user-facing.
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}
