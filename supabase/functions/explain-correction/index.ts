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
              'transposed), with no actual difference in grammatical form or meaning (e.g. ' +
              '"Testergbnis"/"Testergebnis", "Dokter"/"Doktor", "geziegt"/"gezeigt"). Put every one ' +
              'of these in the "spelling" array as {"wrong": "...", "correct": "..."} using the exact ' +
              'substrings verbatim as they appear in the attempt and correction respectively — do ' +
              'not paraphrase them, and do not also make a grammar point about them. Capitalization ' +
              '(German capitalizes every noun) and hyphenation differences belong here too, not as ' +
              'their own grammar point. There is no cap on how many spelling entries you list — a ' +
              'sentence with three typos needs all three, not just the first. ' +
              '\n\n' +
              '2) GRAMMAR — a genuine difference in form, agreement, tense, case, word choice, or ' +
              `word ORDER. Identify AT MOST ${pointCap} of these as concrete points the learner ` +
              'should take away — but fewer is better than more: only include a point for a mistake ' +
              'that is actually there. That said, do NOT under-report either — if there are ' +
              'genuinely 2-3 DISTINCT real grammar issues (e.g. a wrong article AND a wrong ' +
              'adjective ending AND a wrong possessive-pronoun case, all in the same sentence), give ' +
              'each its own point, up to the cap; "fewer is better" means never padding the list with ' +
              'a minor or borderline point just to fill it out, not skipping a second or third issue ' +
              'that is actually there to keep the list short. If there is truly only one real grammar ' +
              'issue, return exactly one point. Covers: article/case (der/die/das, den/dem/der ' +
              'agreement), adjective endings, verb tense/conjugation, preposition choice, a ' +
              'word-class mix-up (e.g. using a verb form where a noun was needed, like "reisen" [to ' +
              'travel] instead of "Reisende" [traveler]), AND word order — German subordinate ' +
              'clauses (e.g. after "dass", "weil", "obwohl") require the finite verb to move to the ' +
              'very end of the clause; if the learner\'s word is already the CORRECT word/form but ' +
              'just in the wrong position, that is a word-order mistake, not a form mistake — say so ' +
              'explicitly by naming where it belongs (e.g. \'After "dass", the finite verb "war" ' +
              'must move to the end of the clause.\'). NEVER phrase a point as \'"X" should be "X"\' ' +
              '(the same word on both sides) — if you catch yourself about to write that, it is ' +
              'almost always actually a word-order issue described wrong; fix the phrasing to ' +
              'describe the position, not a form change. Before writing each point, re-read the ' +
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
    // reach the learner as a nonsensical point.
    const SAME_WORD_POINT = /"([^"]+)"[^".]*\bshould be\b[^".]*"\1"/i;
    const points = Array.isArray(parsed.points)
      ? parsed.points.filter(p => typeof p === 'string' && p.trim() && !SAME_WORD_POINT.test(p))
      : [];
    const spelling = Array.isArray(parsed.spelling)
      ? parsed.spelling.filter((s): s is { wrong: string; correct: string } =>
          !!s && typeof s.wrong === 'string' && !!s.wrong.trim() && typeof s.correct === 'string' && !!s.correct.trim()
          // Same backstop as SAME_WORD_POINT above, for the structured
          // side: a "spelling mistake" that's actually identical on both
          // sides isn't one.
          && s.wrong.trim() !== s.correct.trim())
      : [];
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
