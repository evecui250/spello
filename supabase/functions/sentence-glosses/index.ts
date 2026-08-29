// Per-word lemma + short translation for every content word in an
// AI-corrected sentence — split out from correct-sentence itself (which
// used to generate this same map inline) specifically so the main
// correction can render fast: fetching this separately, AFTER the
// correction is already on screen, means the learner never waits on it —
// words simply become clickable a moment later. Mirrors correct-sentence's
// old "lemmas" instruction (dictionary form, separable-prefix verbs split
// across the sentence both mapping to the same lemma) but also asks for a
// short gloss in the learner's OWN native language, so every word in the
// sentence can show a translation on tap — not just words that happen to
// already be in Spello's corpus (see resolveClickedWord's corpus-only
// fallback in lib/words.ts, which this complements rather than replaces:
// a real corpus match still wins, for its richer word-detail panel).
// Shares ai_usage's daily cap with correct-sentence/explain-correction
// (same table, counted together) — a bonus lookup on top of a correction
// that already happened, not a separate allowance.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-4o-mini';

// (raised from 50/20 on 2026-08-20 — a real tester hit the old cap.)
const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  wordId: string;
  sentence: string;
  level: string;
  nativeLanguage?: 'en' | 'zh';
  // 'de-to-native' (default): `sentence` is German (the AI correction) --
  // each gloss is {lemma: German dictionary form, gloss: translation in
  // nativeLanguage}. 'native-to-de': `sentence` is the round-1 PROMPT,
  // written in nativeLanguage, before the learner has translated it --
  // each gloss is {lemma: a German hint word/phrase for it, gloss: that
  // same word's own dictionary form in nativeLanguage}, i.e. the exact
  // same {lemma: German, gloss: nativeLanguage} shape either way, just
  // built from whichever sentence hasn't been translated yet. Lets a
  // learner tap ANY prompt word for a German hint, not just ones that
  // happen to already be Spello corpus entries (see
  // DailySessionFlow/findWordByEnglishForm's corpus-only fallback, which
  // this complements the same way it already complements the corpus-only
  // chain on the correction side).
  direction?: 'de-to-native' | 'native-to-de';
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
    const { wordId, sentence, level, nativeLanguage, direction } = body;
    if (!wordId || !sentence) {
      return json({ error: 'Missing wordId or sentence' }, 400);
    }
    // Raised from 300 -- the bonus paragraph exercise (ParagraphExerciseCard)
    // now also calls this, for a whole ~B2-length paragraph (up to ~100
    // words) rather than one correction/prompt sentence, which stayed well
    // under 300 anyway (bounded by generate-sentence's own WORD_RANGE).
    if (sentence.length > 1200) {
      return json({ error: 'Sentence too long' }, 400);
    }
    const lang = nativeLanguage === 'zh' ? 'Chinese' : 'English';
    const promptText = direction === 'native-to-de'
      ? `For this ${lang} sentence (a CEFR ${level || 'A1'} learner is about to translate it ` +
        `INTO German): "${sentence}", produce a JSON object mapping EVERY distinct content word ` +
        '(as it literally appears there, preserving capitalization) to a German dictionary-form ' +
        'word or short phrase a learner could use for it when translating this sentence into ' +
        'German, as "lemma" (the exact uninflected dictionary form: infinitive for verbs, ' +
        'singular nominative for nouns, positive form for adjectives/adverbs), plus that same ' +
        `word's own dictionary/base form in ${lang} as "gloss" (e.g. "packed" -> gloss "pack"). ` +
        'Skip only pure grammar words that carry no independent translatable meaning of their ' +
        "own — articles (a/the), personal/demonstrative pronouns (it/this/that), prepositions, " +
        'conjunctions, and punctuation. Quantifiers and determiners such as "all", "every", ' +
        '"some", "many", "each", "several", and "both" DO carry real translatable meaning and ' +
        'must be included, not skipped (e.g. "all" -> lemma "alle"). Respond with exactly this ' +
        'JSON: {"words": {"word1": {"lemma": "...", "gloss": "..."}, ...}}.'
      : `For this German sentence (a CEFR ${level || 'A1'} learner's exercise): ` +
        `"${sentence}", produce a JSON object mapping EVERY distinct word (as it ` +
        'literally appears there, preserving capitalization) to its dictionary/base ' +
        'form — the infinitive for verbs (e.g. "abgesagt" -> "absagen", "ruft" -> ' +
        '"rufen"), the singular nominative for nouns (e.g. "Häuser" -> "Haus", ' +
        '"Kindern" -> "Kind"), and the uninflected positive form for adjectives/adverbs ' +
        '(e.g. "schönen" -> "schön") — plus a short (1-4 word) translation of that base ' +
        `form into ${lang}. Include separable-prefix verbs split apart by German word ` +
        'order, each part mapping to the SAME full lemma (e.g. a sentence with "sagt ... ' +
        'ab" for "absagen" should map BOTH "sagt" and "ab" to lemma "absagen", both with ' +
        'the same translation). Skip bare articles (der/die/das/ein/eine/einen/etc.) and ' +
        'punctuation. Respond with exactly this JSON: {"words": {"word1": {"lemma": ' +
        `"...", "gloss": "..."}, ...}}, each gloss in ${lang}.`;

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: promptText }],
        temperature: 0.2,
        // Raised alongside the length cap above -- a full paragraph's worth
        // of distinct content words needs more room than one sentence ever
        // did.
        max_tokens: 1500,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error (sentence-glosses):', errText);
      return json({ error: 'Gloss lookup failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { words?: Record<string, { lemma?: string; gloss?: string }> } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed empty — caught below
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
      kind: 'gloss',
    });

    const words = parsed.words && typeof parsed.words === 'object' ? parsed.words : {};
    return json({ words });
  } catch (err) {
    console.error('sentence-glosses error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
