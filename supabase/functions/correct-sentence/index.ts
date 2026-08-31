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
const MODEL = 'gpt-4o-mini';

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
// enough that a strict substring check alone would false-positive on
// legitimate answers, so this allows loose matching: either form contains
// the other, they share a long-enough prefix, or their edit distance is
// small relative to length. Loose by design — an occasional unnecessary
// (unnecessary) retry costs one extra AI call, which is far cheaper than
// either silently shipping a wrong word, or being so strict it retries
// every legitimate irregular verb.
function formMatchesTarget(wordDe: string, wordForm: string): boolean {
  const a = wordDe.toLowerCase();
  const b = wordForm.toLowerCase();
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const prefixLen = Math.min(3, a.length);
  if (a.slice(0, prefixLen) === b.slice(0, prefixLen)) return true;
  const dist = editDistance(a, b);
  return dist <= Math.ceil(Math.max(a.length, b.length) / 2);
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
    const { wordId, wordDe, level, englishPrompt, userTranslation } = body;
    if (!wordId || !wordDe || !englishPrompt) {
      return json({ error: 'Missing wordId, wordDe, or englishPrompt' }, 400);
    }
    if (userTranslation && userTranslation.length > 300) {
      return json({ error: 'Translation too long' }, 400);
    }
    const hasUserInput = !!userTranslation && userTranslation.trim().length > 0;

    const systemPrompt =
              'You are a German tutor helping a learner practice new vocabulary. The ' +
              `exercise sentence, to be translated into German, is: "${englishPrompt}" — ` +
              `specifically testing the word "${wordDe}" (CEFR ${level || 'A1'}). ` +
              (hasUserInput
                ? 'The learner attempted a translation (given in the next message). First, ' +
                  'decide whether their attempt tries to render the target word in German at ' +
                  'all — in ANY form (any conjugation, declension, case ending, or plural). If ' +
                  'it is a noun, do NOT require the article (der/die/das) to be present or ' +
                  'correct — only the core word matters for this check. If it DOES, correct ' +
                  'THEIR OWN translation attempt: fix grammar, spelling, and word order, AND fix ' +
                  'any OTHER word (i.e. not the target word itself — see the exception below) ' +
                  'whose MEANING does not actually match what the corresponding part of ' +
                  'the English sentence says — a genuine mistranslation, not just a stylistic ' +
                  'choice (e.g. if the English says "departure" and they wrote a word that means ' +
                  '"trip" or "outing" instead, that is wrong and must be corrected to the word ' +
                  'that actually means "departure" — do not just fix its grammar and leave the ' +
                  'wrong meaning in place; be equally strict about every other word choice in the ' +
                  'sentence). This includes content the learner OMITTED entirely, not just words ' +
                  'they got wrong — check every part of the English sentence (including ' +
                  'adverbs/adjectives modifying another word, e.g. "carefully" in "packed ' +
                  'carefully") against their attempt, and if some part of the English meaning is ' +
                  'simply missing from what they wrote (not mistranslated, just never attempted ' +
                  'at all), ADD it into your corrected sentence so the output conveys the FULL ' +
                  'meaning of the English sentence — never silently drop a concept just because ' +
                  'the learner did. This applies just as much to a MAIN VERB the English sentence ' +
                  'has TWO of (not just a modifier) — a sentence like "The company DECIDED to ' +
                  'commission a new project" expresses two distinct actions (deciding, then ' +
                  'commissioning), and the corrected sentence must convey BOTH, even if the ' +
                  "learner's attempt at the first one (e.g. a garbled attempt at \"entschieden\") " +
                  'was too broken to fix cleanly — a real, confirmed miss: an attempt garbled both ' +
                  'verbs of exactly this sentence, and the correction kept only "beauftragt" ' +
                  '(commissioned), silently dropping "decided" entirely instead of producing ' +
                  'something like "Das Unternehmen hat sich entschieden, ein neues Projekt zu ' +
                  'beauftragen" or "...hat entschieden, ... zu beauftragen". Before finalizing your ' +
                  'output, count how many distinct verbs/actions the English sentence actually has ' +
                  'and confirm your German sentence expresses every one of them, not just whichever ' +
                  'one contains the target word. You MAY keep a word choice that is a ' +
                  'genuinely valid synonym correctly conveying the same meaning (different ' +
                  'learners can validly translate the same sentence differently — real synonyms, ' +
                  'word order) — but every word in your output must actually mean what the ' +
                  'corresponding part of the English sentence means; do not preserve their overall ' +
                  'sentence structure/approach at the expense of accuracy. This applies especially ' +
                  'to PREPOSITIONS: German often has more than one preposition that correctly ' +
                  'expresses the same English one in a given context (e.g. "während" and "in" can ' +
                  'both correctly translate "during" before a noun phrase; "an" can govern several ' +
                  'different relationships) — only replace the learner\'s preposition if it is ' +
                  'actually grammatically wrong or changes the meaning for THAT context, never ' +
                  'just because a different preposition you\'d have picked also works. Relatedly, ' +
                  'German preposition+article contractions (im/in dem, am/an dem, zum/zu dem, ' +
                  'zur/zu der, beim/bei dem, vom/von dem, ins/in das, ans/an das, aufs/auf das) ' +
                  'are both EQUALLY CORRECT forms of the same phrase, not an error in either ' +
                  'direction (a real case: a learner wrote "in dem" and it was wrongly changed ' +
                  'to "im") — leave whichever one the learner used exactly as they wrote it. ' +
                  `EXCEPTION, and this overrides everything above: never replace the target word ` +
                  `"${wordDe}" itself with a different German word, even if you think a different ` +
                  'word fits the English sentence better — the whole point of this exercise is ' +
                  `practicing "${wordDe}" specifically, and the English sentence was written to ` +
                  'fit it, so treat their use of it as correct by construction. If they used it, ' +
                  'keep it and only fix its inflected FORM if that form is wrong (conjugation, ' +
                  'case, agreement) — never swap in a synonym instead. If it does NOT attempt ' +
                  'the target word at all, or their attempt is too garbled or unrelated to the ' +
                  'English sentence to fix, IGNORE their attempt entirely and produce a fresh, ' +
                  'natural German translation of the English sentence instead. Either way, you ' +
                  'must always return a complete, correct German sentence that uses the target ' +
                  'word — never refuse or report failure. '
                : 'Produce a natural, fluent German translation of that English sentence. ') +
              `Make sure "${wordDe}" is correctly conjugated for its subject and tense in your ` +
              'output (in its correct inflected form, which may differ from the dictionary ' +
              'form). This applies even to modern loanword verbs borrowed from English, which ' +
              'conjugate exactly like any regular German weak verb: "chatten" -> "ich chatte", ' +
              '"du chattest"; "googeln" -> "er googelt"; "liken" -> "ich like", "sie liked". ' +
              `Before answering, double-check that "${wordDe}" is not left as a bare, ` +
              'unconjugated infinitive in your output where German grammar requires a ' +
              'conjugated form — that is a common mistake to avoid. Always end your ' +
              'sentence with correct terminal punctuation matching the English sentence\'s own ' +
              'punctuation (a period, question mark, or exclamation mark) — add it even if the ' +
              'learner\'s attempt omitted it. Final check before you answer: read your own output ' +
              `sentence back and confirm it actually contains a real inflected form of "${wordDe}" ` +
              '— if it does not, that is wrong, fix it before responding. Respond with exactly ' +
              'this JSON: {"sentence": "...", ' +
              '"wordForm": the exact inflected form of the word as it literally appears, ' +
              'verbatim, inside "sentence" — this must be an exact substring match so it can be ' +
              'highlighted}.';

    type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
    type ModelResult = { parsed: { sentence?: string; wordForm?: string }; raw: string; usage: { prompt_tokens?: number; completion_tokens?: number } };

    // One real OpenAI call + parse, logged to ai_usage on its own — pulled
    // out into its own function so the "target word went missing" retry
    // below (see formMatchesTarget) can call this exact same path a second
    // time with an extended message list, rather than duplicating the
    // fetch/parse/log logic.
    async function callModel(messages: ChatMessage[]): Promise<ModelResult> {
      const completion = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          response_format: { type: 'json_object' },
          messages,
          temperature: 0.3,
          // Trimmed down from 350 — this response used to also carry a
          // per-word lemma map for tap-to-look-up, which was by far the
          // biggest chunk of output and made this call noticeably slow
          // (output tokens are generated sequentially, so cutting them
          // cuts wall-clock time almost linearly). That lookup now comes
          // from a separate sentence-glosses call fired after the
          // correction already renders (see DailySessionFlow) instead of
          // blocking the correction itself on it.
          max_tokens: 120,
        }),
      });

      if (!completion.ok) {
        const errText = await completion.text();
        console.error('OpenAI error:', errText);
        throw new Error('AI correction failed');
      }

      const result = await completion.json();
      const raw: string = result.choices?.[0]?.message?.content ?? '{}';
      let parsed: { sentence?: string; wordForm?: string } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        // leave parsed empty — caught by the caller
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
          content: `That sentence does not actually use "${wordDe}" — you must rewrite it so a real ` +
            `inflected form of "${wordDe}" genuinely appears in the sentence, never a different word. ` +
            'Respond again with the same JSON format.',
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

    return json({ sentence: parsed.sentence, wordForm: parsed.wordForm });
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
