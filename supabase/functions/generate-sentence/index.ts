// Generates the English sentence for Spello's round-1 translation exercise:
// a natural sentence built ONLY from vocabulary the learner already knows
// (see lib/practice.ts's getKnownVocabulary) plus the new word being
// introduced. The learner translates this into German; a separate function
// (correct-sentence) then corrects their translation attempt. Same
// key-handling rationale as correct-sentence: the OpenAI key lives only
// here (a Supabase secret), never in client code, since Spello ships as a
// public static site with no server of its own. Every call is logged to
// ai_usage for spend tracking.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MODEL = 'gpt-4o-mini';

// Defensive cap only — corpus is ~4000 words total across every level, so
// this should never actually bind in practice.
const MAX_KNOWN_WORDS = 4000;

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
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }

    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: 'Not authenticated' }, 401);
    }
    const userId = userData.user.id;

    const body = (await req.json()) as RequestBody;
    const { wordId, wordDe, wordEn, level, knownVocabulary } = body;
    if (!wordId || !wordDe || !wordEn) {
      return json({ error: 'Missing wordId, wordDe, or wordEn' }, 400);
    }
    const vocab = (Array.isArray(knownVocabulary) ? knownVocabulary : []).slice(0, MAX_KNOWN_WORDS);

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
              'The sentence should be appropriately simple for this level — not a trivial ' +
              'isolated phrase, but not complex either — a real, meaningful sentence that ' +
              'makes sense on its own. Respond with exactly this JSON: {"sentence": "..."}.',
          },
          { role: 'user', content: `Write the sentence for the word "${wordEn}".` },
        ],
        temperature: 0.7,
        max_tokens: 120,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error:', errText);
      return json({ error: 'AI sentence generation failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { sentence?: string } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed empty — caught by the check below
    }
    const usage = result.usage ?? {};
    await supabase.from('ai_usage').insert({
      user_id: userId,
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

    return json({ sentence: parsed.sentence });
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
