// Corrects a beginner's attempt at TRANSLATING an English sentence into
// German (the English sentence itself comes from generate-sentence — see
// Spello's round-1 translation exercise). Broken grammar / English words
// mixed in is expected. Corrects THEIR translation (grammar, spelling,
// word order) rather than substituting an independent translation of the
// English sentence — different learners can validly translate the same
// sentence differently (synonyms, word order), so the correction should
// track what they actually wrote. The OpenAI key lives only here (a
// Supabase secret), never in client code, since Spello ships as a public
// static site with no server of its own. Every call is logged to ai_usage
// for spend tracking.

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
  englishPrompt: string;
  userTranslation: string;
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
    const { wordId, wordDe, level, englishPrompt, userTranslation } = body;
    if (!wordId || !wordDe || !englishPrompt || !userTranslation || userTranslation.trim().length === 0) {
      return json({ error: 'Missing wordId, wordDe, englishPrompt, or userTranslation' }, 400);
    }
    if (userTranslation.length > 300) {
      return json({ error: 'Translation too long' }, 400);
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
              'You are a German tutor. The learner was asked to translate this English ' +
              `sentence into German: "${englishPrompt}". They attempted a translation ` +
              '(given in the next message). This exercise specifically tests the word ' +
              `"${wordDe}" (CEFR ${level || 'A1'}). First, decide whether their attempt tries ` +
              'to render this word in German at all — in ANY form (any conjugation, ' +
              'declension, case ending, or plural). If it is a noun, do NOT require the ' +
              'article (der/die/das) to be present or correct — only the core word matters ' +
              'for this check. If they did not attempt it at all, respond with exactly this ' +
              'JSON: {"used": false}. ' +
              'Otherwise (even with wrong grammar, wrong word order, wrong form, or English ' +
              'words mixed in), correct THEIR OWN translation attempt — fix grammar, spelling, ' +
              'and word order — while keeping their own word choices and sentence structure as ' +
              'much as possible. Different learners can validly translate the same sentence ' +
              'differently (synonyms, word order); do NOT discard their approach and produce ' +
              'your own independent translation of the English sentence — only fall back to a ' +
              'fresh natural translation if their attempt is too garbled or unrelated to fix. ' +
              `Make sure "${wordDe}" is correctly conjugated for its subject and tense in your ` +
              'output (in its correct inflected form, which may differ from the dictionary ' +
              'form). This applies even to modern loanword verbs borrowed from English, which ' +
              'conjugate exactly like any regular German weak verb: "chatten" -> "ich chatte", ' +
              '"du chattest"; "googeln" -> "er googelt"; "liken" -> "ich like", "sie liked". ' +
              `Before answering, double-check that "${wordDe}" is not left as a bare, ` +
              'unconjugated infinitive in your output where German grammar requires a ' +
              'conjugated form — that is a common mistake to avoid. Respond with exactly this ' +
              'JSON: {"used": true, "sentence": their corrected translation, "wordForm": the ' +
              'exact inflected form of the word as it literally appears, verbatim, inside ' +
              '"sentence" — this must be an exact substring match so it can be highlighted}.',
          },
          { role: 'user', content: userTranslation },
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
