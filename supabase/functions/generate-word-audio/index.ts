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
// Must sound exactly like the built-in recordings in /public/audio, made by
// scripts/generate-audio.py: same model, voice, accent instructions and
// speed, silence trimmed at -40 dB, and loudness levelled to the corpus's
// own mean volume. (This used to be tts-1-hd at speed 0.9 with no
// levelling — a real report: imported words sounded like a different,
// louder speaker.) There's no ffmpeg here, so the clip is requested as raw
// PCM, trimmed and levelled in code, and stored as a WAV.
const MODEL = 'gpt-4o-mini-tts';
const VOICE = 'nova';
const SPEED = 1.0;
const ACCENT_INSTRUCTIONS = (
  "Speak in clear, authentic Standard High German (Hochdeutsch), as a native " +
  "German speaker would. Use genuine German vowel sounds, consonants, and " +
  "word stress throughout -- never American- or English-influenced " +
  "pronunciation, even for words whose spelling happens to resemble an " +
  "English word (e.g. pronounce them fully as German words, not as their " +
  "English look-alikes). In particular: a German 'v' is pronounced like an " +
  "English 'f' in native German words and prefixes (e.g. 'verbittern', " +
  "'vergessen', 'Vater' all start with an f-sound) -- never voice it like " +
  "an English 'v', except in obvious foreign loanwords that keep the " +
  "/v/ sound (e.g. 'Vase', 'Video'). And a German 'w' is pronounced like " +
  "an English 'v' (e.g. 'Wasser', 'wichtig', 'wollen' all start with a " +
  "v-sound) -- never like an English 'w'. Speak at a normal, brisk " +
  "conversational pace, as a short standalone dictionary-style " +
  "pronunciation clip -- do not pause or add any silence before or " +
  "after the word."
);
// Median ffmpeg mean_volume of the corpus clips (measured 2026-10-10).
const TARGET_MEAN_DB = -18.5;
const SILENCE_DB = -40;
const SAMPLE_RATE = 24000; // OpenAI's raw PCM: 24 kHz, 16-bit signed LE, mono

// Trim leading/trailing silence (any 50 ms window quieter than -40 dBFS,
// same idea as the script's ffmpeg silenceremove), then scale to the
// target mean volume — without letting the peak clip.
function trimAndLevel(pcm: Int16Array): Int16Array {
  const win = Math.round(SAMPLE_RATE * 0.05);
  const threshold = 32768 * Math.pow(10, SILENCE_DB / 20);
  const loud = (start: number) => {
    let sum = 0;
    const end = Math.min(pcm.length, start + win);
    for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
    return Math.sqrt(sum / Math.max(1, end - start)) > threshold;
  };
  let a = 0;
  while (a < pcm.length - win && !loud(a)) a += Math.round(win / 2);
  let b = pcm.length - win;
  while (b > a && !loud(b)) b -= Math.round(win / 2);
  const trimmed = pcm.subarray(a, Math.min(pcm.length, b + win));
  let sumSq = 0, peak = 1;
  for (const v of trimmed) { sumSq += v * v; peak = Math.max(peak, Math.abs(v)); }
  const rms = Math.sqrt(sumSq / Math.max(1, trimmed.length));
  const currentDb = 20 * Math.log10(Math.max(1e-9, rms / 32768));
  let gain = Math.pow(10, (TARGET_MEAN_DB - currentDb) / 20);
  gain = Math.min(gain, (32767 * 0.98) / peak);
  const out = new Int16Array(trimmed.length);
  for (let i = 0; i < trimmed.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(trimmed[i] * gain)));
  return out;
}

function wavFile(pcm: Int16Array): Uint8Array {
  const data = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const buf = new ArrayBuffer(44 + data.length);
  const v = new DataView(buf);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SAMPLE_RATE, true); v.setUint32(28, SAMPLE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data.length, true);
  new Uint8Array(buf, 44).set(data);
  return new Uint8Array(buf);
}
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
        instructions: ACCENT_INSTRUCTIONS,
        speed: SPEED,
        response_format: 'pcm',
      }),
    });

    if (!ttsResponse.ok) {
      console.error('OpenAI TTS error:', await ttsResponse.text());
      return json({ error: 'AI audio generation failed' }, 502);
    }
    const raw = new Uint8Array(await ttsResponse.arrayBuffer());
    const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
    const wav = wavFile(trimAndLevel(pcm));

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(`${id}.wav`, wav, { contentType: 'audio/wav', upsert: true });

    // Character count logged in input_tokens as the closest available
    // approximation -- TTS is billed per character, not per token, so this
    // is purely a rough usage signal for /admin, not an exact cost figure.
    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      word_id: id,
      kind: 'word_audio',
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
