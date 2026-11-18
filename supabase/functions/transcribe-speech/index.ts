// Voice entry for the optional "Build a sentence" step (see
// components/VoiceInputButton.tsx): a short recording of the learner
// saying their German sentence -> text, which lands in the sentence box
// for them to check/edit before correct-sentence sees it. The audio is
// passed straight through to OpenAI and never stored.
// Same auth / daily-cap / ai_usage skeleton as the other AI functions.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-4o-mini-transcribe';

const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

// The client stops recording at 30 s; ~1 MB of base64 is far beyond that
// for compressed audio, so anything larger is a bug or abuse.
const MAX_AUDIO_BASE64 = 1_400_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  audio: string; // base64
  mimeType: string;
  wordId?: string;
  // The learner's own language (Settings.nativeLanguage) — what they
  // fall back on for words they don't know in German yet.
  nativeLanguage?: 'en' | 'zh';
}

// Speech-to-text models tidy up what they hear — exactly what a learner's
// mistakes must survive, or the correction would praise a sentence they
// never said. No `language` is set: the sentence is German with the
// learner's own language mixed in for words they don't know yet.
function promptFor(nativeLanguage: 'en' | 'zh'): string {
  const mixed = nativeLanguage === 'zh'
    ? 'manchmal mit chinesischen Wörtern gemischt (diese in chinesischen Schriftzeichen schreiben, nicht übersetzen)'
    : 'manchmal mit englischen Wörtern gemischt (diese auf Englisch schreiben, nicht übersetzen)';
  return `Ein Deutschlerner spricht einen einzelnen deutschen Satz, ${mixed}. ` +
    'Transkribiere genau, was gesagt wird, mit allen Grammatikfehlern, falschen Artikeln und Endungen. ' +
    'Korrigiere nichts.';
}

function extensionFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
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
    if (typeof body.audio !== 'string' || !body.audio) return json({ error: 'Missing audio' }, 400);
    if (body.audio.length > MAX_AUDIO_BASE64) return json({ error: 'Audio too long' }, 400);
    const mime = typeof body.mimeType === 'string' ? body.mimeType.split(';')[0] : 'audio/webm';

    const bytes = Uint8Array.from(atob(body.audio), c => c.charCodeAt(0));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), `speech.${extensionFor(mime)}`);
    form.append('model', MODEL);
    form.append('prompt', promptFor(body.nativeLanguage === 'zh' ? 'zh' : 'en'));
    form.append('response_format', 'json');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!res.ok) {
      console.error('OpenAI transcription error:', await res.text());
      return json({ error: 'Transcription failed' }, 502);
    }
    const result = await res.json();
    const text = typeof result.text === 'string' ? result.text.trim() : '';

    const usage = result.usage ?? {};
    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      word_id: typeof body.wordId === 'string' && body.wordId ? body.wordId.slice(0, 64) : 'speech',
      kind: 'speech_to_text',
      level: 'unknown',
      model: MODEL,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    });

    return json({ text: text.slice(0, 500) });
  } catch (err) {
    console.error('transcribe-speech error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
