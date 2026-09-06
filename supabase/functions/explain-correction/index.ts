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
const MODEL = 'gpt-5.6-terra';

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
  // make, not four. Clamped to [1, 4] here regardless of what's sent.
  maxPoints?: number;
}

interface ExplanationPoint {
  type?: string;
  wrong?: string;
  correct?: string;
  explanation?: string;
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
    // "2-4" is the useful range for a typical correction, but a correction
    // that only touched one word has at most one real point to make —
    // asking for "up to 4" regardless used to pad out trivial corrections
    // with filler (the exact reason this cap, computed from how many words
    // actually changed, exists at all). Ceiling raised from 3 to 4 to match
    // the new prompt's own "2-4" guidance.
    const pointCap = Math.min(4, Math.max(1, Math.round(maxPoints ?? 4)));

    const EXPLANATION_SCHEMA = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        points: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['grammar', 'word_order', 'word_form', 'meaning'] },
              wrong: { type: 'string' },
              correct: { type: 'string' },
              explanation: { type: 'string' },
            },
            required: ['type', 'wrong', 'correct', 'explanation'],
            additionalProperties: false,
          },
        },
        spelling: {
          type: 'array',
          items: {
            type: 'object',
            properties: { wrong: { type: 'string' }, correct: { type: 'string' } },
            required: ['wrong', 'correct'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'points', 'spelling'],
      additionalProperties: false,
    };

    const systemPrompt =
      `You are a German tutor explaining a correction to a CEFR ${level || 'A1'} learner, ` +
      `practicing the target word "${wordDe}".\n\n` +
      `Learner wrote:\n${originalAttempt || '(nothing — they left it blank)'}\n\n` +
      `Corrected sentence:\n${correctedSentence}\n\n` +
      "Explain the meaningful differences between the learner's sentence and the corrected " +
      'sentence.\n\n' +
      'Rules:\n' +
      '- Compare both sentences carefully before explaining.\n' +
      '- Explain only things that actually changed.\n' +
      '- Do not invent a grammar reason for an unchanged word — before including ANY point, ' +
      'check the exact word/phrase you are about to call "wrong" against what you are about ' +
      'to call "correct": if they are character-for-character identical, that word did NOT ' +
      'actually change, and no point should exist for it (a real, confirmed miss: "Erwerb" ' +
      'appeared unchanged in both sentences, yet a point was invented claiming it needed to ' +
      'agree with a nearby plural noun — it did not).\n' +
      '- Do not criticize valid alternative wording — if the source sentence is silent or ' +
      'ambiguous on a detail (most commonly formal "Sie" vs. informal "du"), and the learner ' +
      'picked one valid reading, that is not a mistake even if the correction happens to use ' +
      'a different valid choice.\n' +
      '- Separate pure spelling mistakes (same word, just misspelled — no change in ' +
      'grammatical form or meaning) from grammar, word order, word form, or meaning errors. ' +
      'Put spelling in the "spelling" array using the exact substrings verbatim, and do not ' +
      'also make a point about the same pair.\n' +
      '- Two different words are never merely a spelling mistake (a real, confirmed miss: ' +
      '"aufwenden" — a real verb meaning "to expend effort/resources" — was filed as a ' +
      '"spelling" fix for "verbringen", an entirely different verb meaning "to spend time"; ' +
      'that is a word-choice/meaning point, never spelling). If a word ALSO changed ' +
      'grammatical form on top of a misspelling (most commonly singular to plural), the form ' +
      'change still needs its own point even though the base word is also misspelled — do not ' +
      'let the typo cause a real grammar requirement to go unmentioned.\n' +
      '- A WORD MISSING ENTIRELY from the attempt that the correction added (most commonly a ' +
      'dropped article before a noun, e.g. attempt has "mit Familie", correction has "mit der ' +
      'Familie") is a real point — check for insertions specifically, not just substitutions; ' +
      'a genuinely missing required word always outranks a more minor or debatable difference.\n' +
      '- Group related surface changes into one pedagogical point when they come from the ' +
      'same rule. Example: "mit die Freunde" -> "mit den Freunden" should normally be ' +
      'explained as one dative issue, not two unrelated mistakes.\n' +
      '- For word order, name the actual rule, not just the symptom — two distinct rules: ' +
      '(a) MAIN clause verb-second (V2): the finite verb is always the second element of a ' +
      'main clause; (b) SUBORDINATE clauses (after "dass", "weil", "obwohl", etc.) require the ' +
      'OPPOSITE — the finite verb moves to the very end. If a word is already the correct ' +
      'form but just in the wrong position, that is word_order, not word_form — never phrase ' +
      'a point as "X should be X" (identical on both sides); that almost always means it is ' +
      'actually a position issue described wrong.\n' +
      '- When the attempt expresses one idea with two different words/phrases (redundantly) ' +
      'and the correction just removes the redundant one, treat that as a style/redundancy ' +
      'fix — if the "wrong" side would misleadingly imply the learner never used the correct ' +
      'word at all when they actually did (elsewhere, even if misspelled), leave it out of the ' +
      'points entirely rather than describe it in a way that misstates what they wrote.\n' +
      `- Explain the most useful points only, up to a maximum of ${pointCap}. Fewer is better ` +
      'than more — accuracy matters more than reaching the cap; only include a point for a ' +
      'mistake that is actually there, but do not under-report either: if there are genuinely ' +
      'several distinct real issues in the same sentence, give each its own point, up to the ' +
      'cap.\n' +
      '- For each point:\n' +
      '  1. show what changed (in "wrong"/"correct", as exact verbatim substrings from the ' +
      'attempt/correction respectively);\n' +
      '  2. explain why in "explanation";\n' +
      '  3. give a very short rule or contrast when useful — lead with the concrete fact ' +
      'itself, not a restated category label (e.g. state directly which gender/case applies ' +
      'and why, rather than first saying "the adjective needs the correct ending").\n' +
      '- Keep explanations tied to this exact sentence.\n' +
      '- Adapt terminology to CEFR level: A1/A2 uses plain language first with minimal grammar ' +
      'jargon; B1+ may use grammar terms when helpful.\n' +
      '- Do not repeat the same issue in multiple points.\n' +
      '- If the attempt was blank, too garbled, or simply used different (not wrong) ' +
      'vocabulary with no real grammar issue to point out, return one point that briefly says ' +
      'what the corrected sentence means instead.\n' +
      `- Write "summary" and every point/explanation in ${lang}. "summary" is one short ` +
      'sentence and must NOT repeat the full corrected sentence back — the learner can already ' +
      'see it.\n' +
      '- When quoting a German word or phrase inside "explanation" or "summary", always use ' +
      'a plain straight double quote (") on both sides — never a curly/smart quote (" or "), ' +
      'a single quote, or German-style low-high quotes („ and "). Stay consistent within and ' +
      'across every field in this response.\n\n' +
      'Return only the structured output required by the schema. Either "points" or ' +
      '"spelling" may be empty, but not both.';

    // gpt-5.6-terra is a reasoning-tier model: no custom temperature
    // (rejected outright), max_completion_tokens instead of max_tokens, and
    // a reported (never observed here) risk that some non-default
    // reasoning_effort values get rejected on /chat/completions — falls
    // back one step (medium -> low) only if OpenAI's own error text
    // specifically names reasoning_effort. Also: reasoning tokens are
    // billed from (and can exhaust) this same max_completion_tokens budget,
    // confirmed live while fixing the corpus-audit scripts this session —
    // 1500 gives real headroom for a 2-4-point structured explanation, with
    // a one-time escalation to 3000 if a completion still comes back empty.
    async function callOpenAI(
      requestBody: Record<string, unknown>,
      reasoningEffort: 'medium' | 'low',
      maxTokens: number,
      escalated = false,
    ): Promise<{ result: Record<string, unknown>; raw: string }> {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ ...requestBody, reasoning_effort: reasoningEffort, max_completion_tokens: maxTokens }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        if (reasoningEffort === 'medium' && errText.toLowerCase().includes('reasoning_effort')) {
          console.warn('explain-correction: reasoning_effort "medium" rejected, retrying with "low"', errText);
          return callOpenAI(requestBody, 'low', maxTokens, escalated);
        }
        throw new Error(`OpenAI error: ${errText}`);
      }

      const result = await resp.json();
      const raw: string = result.choices?.[0]?.message?.content ?? '';
      if (!raw.trim() && !escalated) {
        return callOpenAI(requestBody, reasoningEffort, 3000, true);
      }
      return { result, raw };
    }

    let completionResult: { result: Record<string, unknown>; raw: string };
    try {
      completionResult = await callOpenAI(
        {
          model: MODEL,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'explanation', strict: true, schema: EXPLANATION_SCHEMA },
          },
          messages: [{ role: 'system', content: systemPrompt }],
        },
        'medium',
        1500,
      );
    } catch (err) {
      console.error('OpenAI error (explain-correction):', err);
      return json({ error: 'Explanation failed' }, 502);
    }
    const { result, raw } = completionResult;

    let parsed: { summary?: string; points?: ExplanationPoint[]; spelling?: { wrong?: string; correct?: string }[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed empty — caught by the check below
    }
    const usage = (result.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
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

    // Structured Outputs gives every point explicit "wrong"/"correct"
    // fields now, instead of prose a regex had to fish through — the
    // backstops below are the same guards this session already proved it
    // needs (each with its own real, confirmed miss in the comments), just
    // rewritten against structured fields, which makes them exact instead
    // of fuzzy.
    let spelling = Array.isArray(parsed.spelling)
      ? parsed.spelling.filter((s): s is { wrong: string; correct: string } =>
          !!s && typeof s.wrong === 'string' && !!s.wrong.trim() && typeof s.correct === 'string' && !!s.correct.trim()
          // A "spelling mistake" that's identical on both sides isn't one —
          // same intent as the old prose-based SAME_WORD_POINT check, now a
          // direct field comparison instead of a regex over free text.
          && s.wrong.trim() !== s.correct.trim())
      : [];

    // Real, confirmed case: the model classified "aufwenden" -> "verbringen"
    // (two entirely different verbs) as "spelling", despite the prompt's own
    // explicit definition (same word, just misspelled) ruling that out --
    // instructions alone weren't reliable enough here, same reason this
    // exists as a hard backstop rather than just a prompt request. A genuine
    // typo has a small edit distance relative to word length (confirmed
    // against real corpus examples: "gefült"/"gefühlt" ~15% different,
    // "geziegt"/"gezeigt" ~28%); two different words don't
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

    const spellingSet = new Set(spelling.map(s => `${s.wrong.trim().toLowerCase()}|${s.correct.trim().toLowerCase()}`));
    const validTypes = new Set(['grammar', 'word_order', 'word_form', 'meaning']);
    let points = Array.isArray(parsed.points)
      ? parsed.points.filter((p): p is Required<ExplanationPoint> =>
          !!p && typeof p.wrong === 'string' && !!p.wrong.trim()
          && typeof p.correct === 'string' && !!p.correct.trim()
          && typeof p.explanation === 'string' && !!p.explanation.trim()
          && typeof p.type === 'string' && validTypes.has(p.type)
          // Same backstop as the spelling filter above: a point claiming a
          // change where "wrong" and "correct" are identical is exactly the
          // invented-agreement-for-an-unchanged-word bug (the real "Erwerb"
          // case) — now caught as a trivial equality check instead of a
          // regex over prose, since the fields are structured.
          && p.wrong.trim() !== p.correct.trim()
          // Real, confirmed case: a spelling entry ("bissen" -> "bisschen")
          // got a SECOND, redundant point ALSO explaining the same fix --
          // directly contradicting the "do not also make a point about the
          // same pair" instruction. Drop any point that restates an
          // already-listed spelling entry's exact wrong/correct pair.
          && !spellingSet.has(`${p.wrong.trim().toLowerCase()}|${p.correct.trim().toLowerCase()}`))
      : [];

    if (points.length === 0 && spelling.length === 0) {
      console.error('Malformed AI response (explain-correction):', raw);
      return json({ error: 'AI returned an empty explanation' }, 502);
    }
    // Backstop for the prompt's own quotation-mark instruction — a real,
    // confirmed report ("the quotation marks are weird, sometimes „,
    // sometimes swapped") of the model inconsistently mixing plain ASCII
    // quotes, curly/smart quotes, and German-style low-high „..." quotes
    // across different calls and even within the same field. Normalized
    // to plain ASCII regardless of what actually came back, same
    // "instruction plus code enforcement" pattern as every other guard in
    // this file, rather than trusting compliance alone.
    const summary = normalizeQuotes(typeof parsed.summary === 'string' ? parsed.summary : '');
    points = points.map(p => ({ ...p, explanation: normalizeQuotes(p.explanation) }));

    return json({ summary, points, spelling });
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

// Curly/smart double quotes (U+201C/U+201D) and German-style low-high
// quotes (U+201E/U+201C) all normalize to a plain ASCII ", regardless of
// which the model happened to use — see the prompt's own instruction and
// this call site's comment for why this can't just be left to compliance.
// Single-quote variants (U+2018/U+2019) normalize to a plain apostrophe
// the same way, for the same reason.
function normalizeQuotes(s: string): string {
  return s.replace(/[“”„‟]/g, '"').replace(/[‘’]/g, "'");
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
