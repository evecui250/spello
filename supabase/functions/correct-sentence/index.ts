// Takes a beginner's rough attempt at a German sentence using a given word
// (broken grammar / English mixed in is expected — see Spello's round-1
// "invent a sentence" exercise) and returns a natural, corrected German
// sentence using that word. The OpenAI key lives only here (a Supabase
// secret), never in client code, since Spello ships as a public static site
// with no server of its own. Every call is logged to ai_usage for spend
// tracking.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MODEL = 'gpt-4o-mini';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  wordId: string;
  wordDe: string;
  level: string;
  userSentence: string;
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
    const { wordId, wordDe, level, userSentence } = body;
    if (!wordId || !wordDe || !userSentence || userSentence.trim().length === 0) {
      return json({ error: 'Missing wordId, wordDe, or userSentence' }, 400);
    }
    if (userSentence.length > 300) {
      return json({ error: 'Sentence too long' }, 400);
    }

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
              'You are a German tutor for a beginner practicing a specific target word: ' +
              `"${wordDe}" (CEFR ${level || 'A1'}). ` +
              'First, decide whether their attempt actually tries to use this word — in ANY ' +
              'form (any conjugation, declension, case ending, or plural). If it is a noun, ' +
              'do NOT require the article (der/die/das) to be present or correct — only the ' +
              'core word matters for this check. If they did not attempt the word at all, ' +
              'respond with exactly this JSON: {"used": false}. ' +
              'Otherwise (even with wrong grammar, wrong form, or English words mixed in), ' +
              'rewrite their attempt as ONE natural sentence a native German speaker would ' +
              'actually say — prefer the most common, idiomatic everyday phrasing over a ' +
              'stiff or overly literal one — that still uses the word ' +
              `"${wordDe}" (in its correct inflected form, which may differ from the ` +
              'dictionary form). Keep it simple and beginner-appropriate. Respond with ' +
              'exactly this JSON: {"used": true, "sentence": the corrected German sentence, ' +
              '"wordForm": the exact inflected form of the word as it literally appears, ' +
              'verbatim, inside "sentence" — this must be an exact substring match so it can ' +
              'be highlighted}.',
          },
          { role: 'user', content: userSentence },
        ],
        temperature: 0.3,
        max_tokens: 150,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error:', errText);
      return json({ error: 'AI correction failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { used?: boolean; sentence?: string; wordForm?: string } = {};
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

    if (parsed.used === false) {
      return json({ used: false });
    }
    if (!parsed.sentence || !parsed.wordForm) {
      console.error('Malformed AI response:', raw);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }

    return json({ used: true, sentence: parsed.sentence, wordForm: parsed.wordForm });
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
