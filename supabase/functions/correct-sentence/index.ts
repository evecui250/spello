// Corrects a beginner's attempt at TRANSLATING an English sentence into
// German (the English sentence itself comes from generate-sentence — see
// Spello's round-1 translation exercise). Broken grammar / English words
// mixed in is expected. Corrects THEIR translation (grammar, spelling,
// word order) rather than substituting an independent translation of the
// English sentence — different learners can validly translate the same
// sentence differently (synonyms, word order), so the correction should
// track what they actually wrote. This also covers content the learner
// left out entirely, not just words they got wrong (a real reported
// case: a learner's attempt simply never rendered "carefully" from
// "packed carefully", and the old prompt only checked for MISTRANSLATED
// words, not MISSING ones, so the correction quietly stayed incomplete
// too) — the corrected sentence must always convey the FULL English
// meaning. This is deliberately never surfaced as its own callout in
// explain-correction — the corrected sentence itself already shows the
// added word (underlined, same as any other change), which is enough.
// userTranslation is OPTIONAL — omitted
// entirely for "sentence writing mode" off (see Settings), where the
// learner skips writing anything and just gets a correct example sentence
// directly. Also always succeeds now, even with an unusable attempt (too
// garbled, unrelated, or not attempting the target word at all) — falls
// back to a fresh natural translation instead of refusing, so the learner
// always gets a real correction to move on with (no more retry loop). The
// OpenAI key lives only here (a Supabase secret), never in client code,
// since Spello ships as a public static site with no server of its own.
// Every call is logged to ai_usage for spend tracking.
//
// Works whether signed in or not (this testing phase — see the sign-in-
// optional comment in DailySessionFlow.tsx): a real Authorization header
// resolves a userId and rate-limits by that; without one (or an anon-key-
// only header, which resolves no real user), falls back to rate-limiting
// by the request's own IP address instead. Reads/writes ai_usage with the
// service-role key in both cases, since an anonymous caller has no user
// JWT for RLS to key off of.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-5.6-terra';

// A safety net against a bug or scripted abuse burning through spend, not a
// ration on legitimate studying — a full day's batch rarely calls this more
// than ~15-20 times, so this never binds a real learner. During this testing
// phase testers should never see a quota message at all (raised from 50 on
// 2026-08-20 after a real tester got cut off mid-session on their real daily
// account limit); swap this flat cap for a per-subscription-tier allowance
// (still counted the same way, from ai_usage) once there's billing.
const DAILY_AI_CALL_LIMIT = 1000;
// Stricter for anonymous callers specifically — an IP is a coarser,
// easier-to-abuse identifier than a real account (no signup friction at
// all stands between a bad actor and this endpoint), so this errs tighter
// until there's more signal about real anonymous usage patterns. Still
// raised well past any real single-IP testing session (see above).
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
  englishPrompt: string;
  userTranslation?: string;
  // Forward-compat only — no corpus field feeds this yet. If lib/words.ts
  // ever gains a canonical reference translation per word, this lets it
  // flow through as CONTEXT for the model, never as the one correct
  // answer (see the prompt's own "Reference (context only...)" framing).
  canonicalGerman?: string;
}

// Plain Levenshtein edit distance — used below to check that the model's
// own reported wordForm is a plausible inflection of the actual target
// word, not a hallucinated or substituted one. Short strings only (single
// German words), so the classic O(n*m) table is plenty fast.
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
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

// The actual bug this guards against: the model quietly swaps the target
// word for a different one (a close synonym, or — in the "learner's
// attempt doesn't touch the target word at all" fallback path — a fresh
// translation that just never happens to need it) while still returning
// SOME wordForm/sentence pair, so the malformed-response check above
// never catches it. Real German inflection (plurals, cases, and
// especially strong-verb ablaut like gehen -> ging) can change a word
// enough that a strict check alone would false-positive on legitimate
// answers, so this allows loose matching — but not unconditionally: a
// real, confirmed miss slipped through the original version of this
// function, which treated ANY substring containment as a match — "rate"
// (a real inflection of the unrelated verb "raten") is coincidentally a
// literal substring of "beraten" ("be-RATE-n"), so the model silently
// swapping "beraten" for "raten" went undetected. Substring containment
// now only counts when the shorter string is a substantial fraction of
// the longer one (a short, unrelated word is far more likely to
// coincidentally appear inside a longer, unrelated target than a real
// inflection is to be that much shorter than its own lemma); the edit-
// distance fallback is scaled off the SHORTER word's length rather than
// the longer one, for the same reason — a fixed few edits should mean
// much more on a short word than a long one. This is deliberately still
// not perfect (a genuinely irregular short verb like gehen/ging can still
// trip it) — an occasional unnecessary retry costs one extra AI call,
// which is far cheaper than silently shipping a wrong word.
function formMatchesTarget(wordDe: string, wordForm: string): boolean {
  const a = wordDe.toLowerCase();
  const b = wordForm.toLowerCase();
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.6) return true;
  const prefixLen = Math.min(3, a.length, b.length);
  if (a.slice(0, prefixLen) === b.slice(0, prefixLen)) return true;
  const dist = editDistance(a, b);
  return dist <= Math.ceil(Math.min(a.length, b.length) / 2);
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
    // Supabase Edge Functions sit behind a proxy that sets this to the
    // real client IP as the first entry (a comma-separated chain if the
    // request passed through further proxies upstream of that) — same
    // pattern already used by record-usage-ping/admin-stats.
    const forwardedFor = req.headers.get('x-forwarded-for');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : null;
    // No way to identify the caller at all — reject rather than risk the
    // rate-limit query below silently matching nothing (a bare .eq() with
    // a null value isn't a reliable "no identifier" check across every
    // PostgREST version) and letting an unlimited stream of calls through.
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
    const { wordId, wordDe, level, englishPrompt, userTranslation, canonicalGerman } = body;
    if (!wordId || !wordDe || !englishPrompt) {
      return json({ error: 'Missing wordId, wordDe, or englishPrompt' }, 400);
    }
    if (userTranslation && userTranslation.length > 300) {
      return json({ error: 'Translation too long' }, 400);
    }
    const hasUserInput = !!userTranslation && userTranslation.trim().length > 0;

    // Only sent as CONTEXT, never as the required answer — see
    // RequestBody's own comment on canonicalGerman (no corpus field feeds
    // this today; this is forward-compat plumbing).
    const referenceLine = canonicalGerman
      ? `\n\nReference (context only — a valid example, NOT the required answer):\n${canonicalGerman}`
      : '';

    const systemPrompt = hasUserInput
      ? "You are a German tutor correcting a learner's translation.\n\n" +
        `CEFR level:\n${level || 'A1'}\n\n` +
        `Source sentence:\n${englishPrompt}\n\n` +
        `Target German word:\n${wordDe}\n\n` +
        `Learner's German:\n${userTranslation}` +
        referenceLine +
        '\n\nYour task is to return a correct German sentence while preserving the ' +
        "learner's own valid choices as much as possible.\n\n" +
        'Rules:\n' +
        '- Accept any natural German translation that preserves the source meaning.\n' +
        '- Fix only genuine errors in grammar, spelling, word order, word form, omitted ' +
        'meaning, or mistranslation.\n' +
        '- Do not rewrite a correct sentence just to match your preferred style.\n' +
        '- Preserve valid synonyms, contractions, sentence structures, person/register, ' +
        'tense, and phrasing.\n' +
        '- If the learner attempted the target word, do not replace it with another German word.\n' +
        "- Correct the target word's conjugation, declension, case, or form if necessary.\n" +
        '- If the learner did not attempt the target word, or the attempt is too ' +
        'incomplete/unrelated to repair, provide a fresh natural German translation that ' +
        'correctly uses the target word.\n' +
        '- This includes content the learner OMITTED entirely, not just words they got ' +
        'wrong — if the English sentence has two distinct actions/verbs (e.g. "The company ' +
        'DECIDED to commission a new project"), the corrected sentence must convey BOTH, even ' +
        "if the learner's attempt at one of them was too broken to fix cleanly — never " +
        'silently drop a concept just because the learner did.\n' +
        '- Do not reorder words unless word order is itself the error being fixed — a valid ' +
        'alternative word order is not a mistake.\n' +
        '- German preposition+article contractions (im/in dem, am/an dem, zum/zu dem, ' +
        'zur/zu der, beim/bei dem, vom/von dem, ins/in das, ans/an das, aufs/auf das) are ' +
        'equally correct forms of the same phrase — never change one to the other, in either ' +
        "direction, if the learner's form was already valid.\n" +
        '- Return one complete German sentence with correct punctuation.\n\n' +
        'Before responding, silently verify:\n' +
        '1. the German is grammatical and idiomatic;\n' +
        '2. the source meaning is preserved;\n' +
        '3. valid learner choices were not unnecessarily changed;\n' +
        '4. the target word is used correctly;\n' +
        '5. no stylistic preference was treated as an error.\n\n' +
        'Return only the structured output required by the schema. "status" must be ' +
        '"correct" if no substantive correction was needed, "corrected" if you repaired the ' +
        "learner's sentence, or \"replaced\" if you had to discard their attempt and provide " +
        'a fresh translation. "wordForm" must be the exact inflected form of the target word ' +
        'EXACTLY as it appears verbatim inside "sentence" (a real substring match, so it can ' +
        'be highlighted) — for a separable verb, use just the single conjugated/finite word ' +
        'that appears (e.g. "rufe"), never a span like "rufe ... an" that is not a literal ' +
        'contiguous substring. This applies even to modern loanword verbs borrowed from ' +
        'English, which conjugate like any regular German weak verb: "chatten" -> "ich ' +
        'chatte"; "googeln" -> "er googelt"; "liken" -> "sie liked".'
      : 'You are a German tutor providing an example translation for a learner to study.\n\n' +
        `CEFR level:\n${level || 'A1'}\n\n` +
        `Source sentence:\n${englishPrompt}\n\n` +
        `Target German word:\n${wordDe}` +
        referenceLine +
        '\n\nProduce a natural, fluent, idiomatic German translation of the source sentence ' +
        `that correctly uses "${wordDe}" (in its correct inflected form). Return one complete ` +
        'German sentence with correct punctuation. Return only the structured output required ' +
        'by the schema, with "status" set to "replaced" and "wordForm" the exact inflected ' +
        'form of the target word EXACTLY as it appears verbatim inside "sentence".';

    type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
    type ParsedCorrection = { sentence?: string; wordForm?: string; status?: 'correct' | 'corrected' | 'replaced' };
    type ModelResult = { parsed: ParsedCorrection; raw: string; usage: { prompt_tokens?: number; completion_tokens?: number } };

    const CORRECTION_SCHEMA = {
      type: 'object',
      properties: {
        sentence: { type: 'string' },
        wordForm: { type: 'string' },
        status: { type: 'string', enum: ['correct', 'corrected', 'replaced'] },
      },
      required: ['sentence', 'wordForm', 'status'],
      additionalProperties: false,
    };

    // gpt-5.6-terra is a reasoning-tier model: no custom temperature
    // (rejected outright), max_completion_tokens instead of max_tokens, and
    // a reported (never observed here) risk that some non-default
    // reasoning_effort values get rejected on /chat/completions — falls
    // back one step (medium -> low) only if OpenAI's own error text
    // specifically names reasoning_effort. Also: reasoning tokens are
    // billed from (and can exhaust) this same max_completion_tokens budget,
    // confirmed live while fixing the corpus-audit scripts this session —
    // 700 gives real headroom over the old 120-token cap for that reason,
    // with a one-time escalation to 1500 if a completion still comes back
    // empty.
    async function callOpenAI(
      requestBody: Record<string, unknown>,
      reasoningEffort: 'medium' | 'low',
      maxTokens: number,
      escalated = false,
    ): Promise<{ result: Record<string, unknown>; raw: string }> {
      const completion = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ ...requestBody, reasoning_effort: reasoningEffort, max_completion_tokens: maxTokens }),
      });

      if (!completion.ok) {
        const errText = await completion.text();
        if (reasoningEffort === 'medium' && errText.toLowerCase().includes('reasoning_effort')) {
          console.warn('correct-sentence: reasoning_effort "medium" rejected, retrying with "low"', errText);
          return callOpenAI(requestBody, 'low', maxTokens, escalated);
        }
        console.error('OpenAI error:', errText);
        throw new Error('AI correction failed');
      }

      const result = await completion.json();
      const raw: string = result.choices?.[0]?.message?.content ?? '';
      if (!raw.trim() && !escalated) {
        return callOpenAI(requestBody, reasoningEffort, 1500, true);
      }
      return { result, raw };
    }

    // One real OpenAI call + parse, logged to ai_usage on its own — pulled
    // out into its own function so the "target word went missing" retry
    // below (see formMatchesTarget) can call this exact same path a second
    // time with an extended message list, rather than duplicating the
    // fetch/parse/log logic.
    async function callModel(messages: ChatMessage[]): Promise<ModelResult> {
      const { result, raw } = await callOpenAI(
        {
          model: MODEL,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'correction', strict: true, schema: CORRECTION_SCHEMA },
          },
          messages,
        },
        'medium',
        700,
      );

      let parsed: ParsedCorrection = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        // leave parsed empty — caught by the caller
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
      });
      return { parsed, raw, usage };
    }

    const firstMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: hasUserInput ? userTranslation! : 'Please translate the sentence.' },
    ];

    let { parsed, raw } = await callModel(firstMessages);

    if (!parsed.sentence || !parsed.wordForm) {
      console.error('Malformed AI response:', raw);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }

    // The actual bug this session is fixing: the model can return a
    // well-formed {sentence, wordForm} pair that simply doesn't use the
    // target word at all (swapped for a synonym, or a "fresh translation"
    // that never needed it) — the prompt already says this must never
    // happen, in three places now, but that's still just an instruction, not
    // a guarantee. One bounded retry (never more than one, so a
    // persistently-noncompliant response still degrades to "ship whatever
    // came back" rather than looping) with the model's own bad answer fed
    // back to it tends to self-correct far more reliably than the original
    // prompt alone.
    const wordMissing = !parsed.sentence.toLowerCase().includes(parsed.wordForm.toLowerCase())
      || !formMatchesTarget(wordDe, parsed.wordForm);

    if (wordMissing) {
      console.error(`Target word "${wordDe}" missing from correction, retrying once:`, raw);
      const retryMessages: ChatMessage[] = [
        ...firstMessages,
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content: `Double-check: does that sentence genuinely contain a real inflected form of ` +
            `"${wordDe}" specifically (not a different, even closely-related word)? If it already ` +
            `does — including an irregular/strong-verb form that looks quite different from the ` +
            `infinitive (e.g. "ging" for "gehen") — you may respond with the exact same answer again. ` +
            `If it does not, rewrite it so a real form of "${wordDe}" genuinely appears. Respond again ` +
            'with the same JSON format either way.',
        },
      ];
      // Best-effort: a network/HTTP failure on this SECOND call shouldn't
      // fail the whole request when the first call already produced a
      // usable (if imperfect) answer — same "always succeeds" contract
      // this endpoint already has for a garbled user attempt.
      try {
        const retry = await callModel(retryMessages);
        if (retry.parsed.sentence && retry.parsed.wordForm) {
          parsed = retry.parsed;
        }
        // If the retry itself came back malformed, parsed still holds the
        // first (word-missing) response — shipping that beats failing the
        // exercise outright.
      } catch (retryErr) {
        console.error('Retry call failed, falling back to first response:', retryErr);
      }
    }

    return json({ sentence: parsed.sentence, wordForm: parsed.wordForm, status: parsed.status });
  } catch (err) {
    console.error('correct-sentence error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
