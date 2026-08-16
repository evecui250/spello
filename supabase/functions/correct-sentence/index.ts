// Corrects a beginner's attempt at TRANSLATING an English sentence into
// German (the English sentence itself comes from generate-sentence — see
// Spello's round-1 translation exercise). Broken grammar / English words
// mixed in is expected. Corrects THEIR translation (grammar, spelling,
// word order) rather than substituting an independent translation of the
// English sentence — different learners can validly translate the same
// sentence differently (synonyms, word order), so the correction should
// track what they actually wrote. userTranslation is OPTIONAL — omitted
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
// than ~15-20 times, so this never binds a real learner. Free during the
// testing phase; swap this flat cap for a per-subscription-tier allowance
// (still counted the same way, from ai_usage) once there's billing.
const DAILY_AI_CALL_LIMIT = 50;
// Stricter for anonymous callers specifically — an IP is a coarser,
// easier-to-abuse identifier than a real account (no signup friction at
// all stands between a bad actor and this endpoint), so this errs tighter
// until there's more signal about real anonymous usage patterns.
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 20;

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
                  'any word whose MEANING does not actually match what the corresponding part of ' +
                  'the English sentence says — a genuine mistranslation, not just a stylistic ' +
                  'choice (e.g. if the English says "departure" and they wrote a word that means ' +
                  '"trip" or "outing" instead, that is wrong and must be corrected to the word ' +
                  'that actually means "departure" — do not just fix its grammar and leave the ' +
                  'wrong meaning in place; be equally strict about every other word choice in the ' +
                  'sentence, not only the target word). You MAY keep a word choice that is a ' +
                  'genuinely valid synonym correctly conveying the same meaning (different ' +
                  'learners can validly translate the same sentence differently — real synonyms, ' +
                  'word order) — but every word in your output must actually mean what the ' +
                  'corresponding part of the English sentence means; do not preserve their overall ' +
                  'sentence structure/approach at the expense of accuracy. If it does NOT attempt ' +
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
              'learner\'s attempt omitted it. Additionally, include a "lemmas" field: a JSON ' +
              'object mapping EVERY distinct word in your sentence (as it literally ' +
              'appears there, preserving capitalization) to its dictionary/base form — the ' +
              'infinitive for verbs (e.g. "abgesagt" -> "absagen", "ruft" -> "rufen"), the ' +
              'singular nominative for nouns (e.g. "Häuser" -> "Haus", "Kindern" -> "Kind"), and ' +
              'the uninflected positive form for adjectives/adverbs (e.g. "schönen" -> "schön"). ' +
              'This lets the learner tap any word in the sentence to look it up, including ' +
              'separable-prefix verbs split apart by German word order (e.g. a sentence with ' +
              '"sagt ... ab" for "absagen" should map BOTH "sagt" and "ab" to "absagen"). Skip ' +
              'bare articles (der/die/das/ein/eine/einen/etc.) and punctuation. Respond with ' +
              'exactly this JSON: {"sentence": "...", ' +
              '"wordForm": the exact inflected form of the word as it literally appears, ' +
              'verbatim, inside "sentence" — this must be an exact substring match so it can be ' +
              'highlighted, "lemmas": {"word1": "lemma1", ...}}.',
          },
          { role: 'user', content: hasUserInput ? userTranslation! : 'Please translate the sentence.' },
        ],
        temperature: 0.3,
        max_tokens: 350,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error:', errText);
      return json({ error: 'AI correction failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { sentence?: string; wordForm?: string; lemmas?: Record<string, string> } = {};
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
    });

    if (!parsed.sentence || !parsed.wordForm) {
      console.error('Malformed AI response:', raw);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }

    // lemmas is a best-effort enhancement (lets the client resolve tricky
    // forms — irregular plurals, past participles, separable-prefix verbs
    // split across the sentence — that its own client-side heuristic in
    // lib/words.ts's findWordByGermanForm can't reliably handle on its
    // own) — never worth failing the whole correction over if the model
    // omits or malforms it.
    const lemmas = parsed.lemmas && typeof parsed.lemmas === 'object' ? parsed.lemmas : {};
    return json({ sentence: parsed.sentence, wordForm: parsed.wordForm, lemmas });
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
