// Generates a real, cached pronunciation clip for a learner-added custom
// word (see lib/storage.ts's custom-words section and app/words/page.tsx's
// "look up & add" flow) — the same OpenAI TTS settings the static corpus's
// own /public/audio files were batch-generated with (see the audio-pipeline
// memory: tts-1-hd, voice nova, 0.85-0.9 speed), so a custom word sounds
// consistent with every curated one instead of falling back to whatever
// the learner's own browser's speechSynthesis happens to offer on every
// single play (see lib/speech.ts's speakWordOnce/reportTtsError — that
// fallback still exists and still works, this just gives a custom word the
// same "reliable, pre-generated" experience a corpus word already has,
// rather than replacing the fallback).
//
// Called once, right when a word is added (see lib/ai.ts's
// generateWordAudio) — fire-and-forget from the caller's side, never
// blocking the add itself: the word is fully usable via the browser-TTS
// fallback in the few seconds before this finishes, and forever after if
// it fails outright (network hiccup, rate limit) or never gets called at
// all. Uploads to the custom-word-audio Storage bucket at `${id}.mp3` —
// lib/speech.ts's audioUrlForWord already points a custom word's audio URL
// at that exact path, so once this succeeds, the very next play (an
// ordinary <audio> element, no client-side change needed) picks up the
// real generated clip automatically.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'tts-1-hd';
const VOICE = 'nova';
const BUCKET = 'custom-word-audio';

// Same combined per-caller cap as every other AI Edge Function here.
const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  id: string;
  spokenForm: string;
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
    const { id, spokenForm } = body;
    // Only ever generates into the custom-word path -- a stray/forged id
    // without this prefix has no business writing into this bucket at all.
    if (!id || !id.startsWith('custom-') || !spokenForm || !spokenForm.trim()) {
      return json({ error: 'Missing or invalid id/spokenForm' }, 400);
    }
    if (spokenForm.length > 100) {
      return json({ error: 'spokenForm too long' }, 400);
    }

    const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input: spokenForm.trim(),
        speed: 0.9,
        response_format: 'mp3',
      }),
    });

    if (!ttsResponse.ok) {
      console.error('OpenAI TTS error:', await ttsResponse.text());
      return json({ error: 'AI audio generation failed' }, 502);
    }
    const audioBuffer = await ttsResponse.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(`${id}.mp3`, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

    // Character count logged in input_tokens as the closest available
    // approximation -- TTS is billed per character, not per token, so this
    // is purely a rough usage signal for /admin, not an exact cost figure.
    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      word_id: id,
      level: 'unknown',
      model: MODEL,
      input_tokens: spokenForm.trim().length,
      output_tokens: 0,
    });

    if (uploadError) {
      console.error('Storage upload error:', uploadError.message);
      return json({ error: 'Could not save generated audio' }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error('generate-word-audio error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
