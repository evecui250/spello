// Generates the English sentence for Spello's round-1 translation exercise:
// a natural sentence built ONLY from vocabulary the learner already knows
// (see lib/practice.ts's getKnownVocabulary) plus the new word being
// introduced. The learner translates this into German; a separate function
// (correct-sentence) then corrects their translation attempt. Same
// key-handling rationale as correct-sentence: the OpenAI key lives only
// here (a Supabase secret), never in client code, since Spello ships as a
// public static site with no server of its own. Every call is logged to
// ai_usage for spend tracking.
//
// Works whether signed in or not (this testing phase — see the sign-in-
// optional comment in DailySessionFlow.tsx) — see correct-sentence's own
// comment for the full rationale of the anonymous-caller rate-limiting
// this mirrors exactly.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-4o-mini';

// Defensive cap only — corpus is ~4000 words total across every level, so
// this should never actually bind in practice.
const MAX_KNOWN_WORDS = 4000;

// Shared with correct-sentence's own copy of this constant — both functions
// count against the same ai_usage table, so a user can't dodge the cap by
// alternating between the two endpoints. See that file for the rationale.
const DAILY_AI_CALL_LIMIT = 50;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 20;

// Word-count range per level, by difficulty — kept in sync with the
// standalone copy in scripts/generate-exercise-prompts.py (which
// pre-generates the vast majority of exercisePrompt values baked into
// lib/words.ts), so this live fallback stays consistent with the
// pre-generated majority.
const WORD_RANGE: Record<string, { min: number; max: number }> = {
  A1: { min: 3, max: 6 },
  A2: { min: 4, max: 8 },
  B1: { min: 6, max: 12 },
  B2: { min: 8, max: 14 },
  C1: { min: 10, max: 16 },
  C2: { min: 12, max: 18 },
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  wordId: string;
  wordDe: string;
  wordEn: string;
  level: string;
  knownVocabulary: string[];
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
    const { wordId, wordDe, wordEn, level, knownVocabulary, nativeLanguage } = body;
    if (!wordId || !wordDe || !wordEn) {
      return json({ error: 'Missing wordId, wordDe, or wordEn' }, 400);
    }
    const vocab = (Array.isArray(knownVocabulary) ? knownVocabulary : []).slice(0, MAX_KNOWN_WORDS);
    const { min: minWords, max: maxWords } = WORD_RANGE[level] ?? { min: 6, max: 14 };
    const wantsZh = nativeLanguage === 'zh';

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
              `You are writing a translation exercise for a CEFR ${level || 'A1'} German ` +
              'learner. Write ONE natural English sentence that: (1) uses the word ' +
              `"${wordEn}" (or a close natural inflection, e.g. its plural or a verb form) — ` +
              'this is the new word being introduced, and the sentence MUST include it; ' +
              '(2) otherwise ONLY uses vocabulary from this list of words the learner already ' +
              `knows: ${vocab.join(', ')}. You may always use ordinary English function words ` +
              'and grammar (a, the, is, was, to, in, and, of, etc.) even if not in that list. ' +
              `(3) The sentence MUST be between ${minWords} and ${maxWords} words long ` +
              '(inclusive) — count every word, this is a hard requirement, not a suggestion. ' +
              'The sentence should be meaningful and make sense on its own, not a trivial or ' +
              'random-sounding string of words. ' +
              (wantsZh
                ? 'Additionally, include a "sentenceZh" field: a natural, fluent Simplified ' +
                  'Chinese translation of that exact English sentence (meaning-for-meaning, ' +
                  'not word-for-word) — this is shown to a Chinese-speaking learner instead of ' +
                  'the English, so it must convey the same thing the English sentence does. ' +
                  "Chinese verbs don't inflect for tense the way English does, so keep the " +
                  'tense unambiguous: if the English sentence is PAST tense, include a clear ' +
                  'signal (the completed-action particle 了 on the main verb, or an explicit ' +
                  'time word like 之前/曾经/上个星期) rather than a bare verb a reader could ' +
                  'just as easily take as present tense; if the English is PRESENT tense, keep ' +
                  "the Chinese reading as present/habitual (don't add 了). "
                : '') +
              'Respond with exactly this JSON: ' +
              (wantsZh ? '{"sentence": "...", "sentenceZh": "..."}.' : '{"sentence": "..."}.'),
          },
          { role: 'user', content: `Write the sentence for the word "${wordEn}".` },
        ],
        temperature: 0.7,
        max_tokens: wantsZh ? 300 : 120,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error:', errText);
      return json({ error: 'AI sentence generation failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { sentence?: string; sentenceZh?: string } = {};
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

    if (!parsed.sentence) {
      console.error('Malformed AI response:', raw);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }

    // sentenceZh is a best-effort display-layer addition — never worth
    // failing the whole generation over if the model omits it.
    return json({ sentence: parsed.sentence, sentenceZh: parsed.sentenceZh || undefined });
  } catch (err) {
    console.error('generate-sentence error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
