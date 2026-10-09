// Backs PDF book import (see components/ImportBookModal.tsx and
// lib/ai.ts's extractHeadwords/defineHeadwords). The PDF itself never
// leaves the learner's device — the client parses it and sends plain page
// text here. Two modes, so the client can corpus-match in between and
// only pay for defining words the built-in corpus doesn't already have:
//   - 'extract': one chunk of page text -> the German headwords in it
//     (dictionary form, strings only — cheap output).
//   - 'define': a batch of unmatched headwords -> full Word-shaped entries
//     (same fields/prompt as lookup-word, batched like
//     scripts/translate-to-chinese.py rather than one term per call).
// Same auth / daily-cap / ai_usage skeleton as lookup-word; every row is
// tagged kind 'pdf_import' so /admin's per-kind breakdown shows it.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-4o-mini';

const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

// Defensive caps — the client chunks well under these; anything larger is
// a bug or abuse either way.
const MAX_TEXT_CHARS = 12000;
const MAX_TERMS = 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Mode = 'extract' | 'define';
interface RequestBody {
  mode: Mode;
  text?: string;
  terms?: { de: string; en?: string }[];
}

const TYPES = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'phrase', 'other'];

// Same list as lookup-word's CATEGORIES (see its comment for why matching
// a real corpus category matters for MCQ distractors).
const CATEGORIES = [
  'Alltag', 'Arbeit', 'Behörde', 'Bildung', 'Einkaufen', 'Essen', 'Familie', 'Finanzen', 'Freizeit',
  'Gefühle', 'Gesellschaft', 'Gesundheit', 'Kommunikation', 'Kultur', 'Länder', 'Medien', 'Natur',
  'Person', 'Politik', 'Reisen', 'Soziales', 'Sprache', 'Technik', 'Umwelt', 'Verkehr', 'Wohnen',
  'Zahlen', 'Zeit',
];

// Both prompts must contain the literal word "JSON": OpenAI rejects a
// response_format json_object request whose messages never mention it.
const EXTRACT_PROMPT =
  'You are given raw text extracted from some pages of a German-learning book (a vocabulary list, ' +
  'a textbook chapter, or a reader). Line breaks and columns may be scrambled by the PDF extraction. ' +
  'List the German vocabulary a learner would study from these pages, each in its dictionary form: ' +
  'nouns in nominative singular WITHOUT the article, verbs in the infinitive, adjectives uninflected; ' +
  'fixed multi-word expressions (e.g. "Bescheid sagen") as one entry. If the text is itself a ' +
  'vocabulary list, return EVERY entry in it, in order — be exhaustive, never summarize or skip ' +
  'adjectives/adverbs — and also return each synonym or regional variant given alongside an entry ' +
  '(after "=", "/", or in brackets like "(CH auch: der Anlass)") as its own separate entry. ' +
  'Ignore grammar notes such as plural endings, "(Sg.)", "+ Akk.", the conjugated forms printed ' +
  'under a verb (e.g. "ruht sich aus, hat sich ausgeruht" belongs to "sich ausruhen"), and example ' +
  'sentences. Keep each noun\'s article ("die Stadt") so nouns are recognizable. ' +
  'Otherwise (not a vocabulary list) pick the content words worth ' +
  'learning (skip names of people, page headers, exercise instructions, and trivial function words ' +
  'like "der", "und", "ist"). No duplicates. If the text gives a translation/meaning for a word ' +
  '(vocabulary lists usually do), copy it as "en" (English only, a few words); otherwise omit "en". ' +
  'Respond with exactly this JSON: {"words": [{"de": "...", "en": "..."}, ...]}.';

const DEFINE_PROMPT =
  'For each German headword below, write one dictionary entry. Respond with exactly this JSON: ' +
  '{"entries": [ ... ]}, one object per headword in the same order, each: {"de": "dictionary form", ' +
  '"article": "der/die/das, nouns only", "plural": "plural form, nouns only, omit if none", "type": ' +
  `"${TYPES.join('|')}", "thirdPerson": "er/sie/es present form, verbs only, with separable prefix ` +
  'split off e.g. \\"steht auf\\"", "pastTense": "simple past er/sie/es form, verbs only, same ' +
  'split-prefix style", "perfectTense": "hat/ist + past participle, verbs only, e.g. \\"hat ' +
  'gekauft\\"", "en": "short English gloss, a few words at most", "zh": "short Simplified Chinese ' +
  'gloss", "category": the closest of exactly these strings (omit only if truly none is related — ' +
  `it groups words for quiz choices): ${CATEGORIES.join(', ')}}. Omit any field that does not apply. Pick the single most common ` +
  'everyday sense — unless a headword comes with "(book: ...)", the meaning the learner\'s own book ' +
  'gives: then define exactly that sense and use that meaning as "en". If a headword is not a real ' +
  'German word (PDF noise), return {"skip": true} in its place.';

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
    let userContent: string;
    let systemPrompt: string;
    let maxTokens: number;
    if (body.mode === 'extract') {
      const text = (body.text ?? '').trim();
      if (!text) return json({ error: 'Missing text' }, 400);
      if (text.length > MAX_TEXT_CHARS) return json({ error: 'Text too long' }, 400);
      systemPrompt = EXTRACT_PROMPT;
      userContent = text;
      maxTokens = 3000;
    } else if (body.mode === 'define') {
      const terms = (body.terms ?? [])
        .filter(t => t && typeof t.de === 'string' && t.de.trim())
        .map(t => ({ de: t.de.trim().slice(0, 60), en: typeof t.en === 'string' ? t.en.trim().slice(0, 80) : '' }));
      if (terms.length === 0) return json({ error: 'Missing terms' }, 400);
      if (terms.length > MAX_TERMS) return json({ error: 'Too many terms' }, 400);
      systemPrompt = DEFINE_PROMPT;
      userContent = terms.map((t, i) => `${i + 1}. ${t.de}${t.en ? ` (book: ${t.en})` : ''}`).join('\n');
      maxTokens = 120 * terms.length + 200;
    } else {
      return json({ error: 'Unknown mode' }, 400);
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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error:', errText);
      return json({ error: 'AI extraction failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { words?: unknown; entries?: unknown } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed empty — caught below
    }
    const usage = result.usage ?? {};
    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      // NOT NULL column — a fixed tag, same as pet-chat-turn's 'pet_chat'.
      word_id: 'pdf_import',
      level: 'import',
      kind: 'pdf_import',
      model: MODEL,
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    });

    if (body.mode === 'extract') {
      if (!Array.isArray(parsed.words)) {
        console.error('Malformed AI response:', raw);
        return json({ error: 'AI returned an unexpected format' }, 502);
      }
      const seen = new Set<string>();
      const words: { de: string; en?: string }[] = [];
      for (const w of parsed.words) {
        // Tolerates a bare string too, in case the model drops the object shape.
        const de = (typeof w === 'string' ? w : (w as { de?: unknown })?.de);
        const en = typeof w === 'object' && w ? (w as { en?: unknown }).en : undefined;
        if (typeof de !== 'string') continue;
        const t = de.trim();
        if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        words.push({ de: t, ...(typeof en === 'string' && en.trim() ? { en: en.trim().slice(0, 80) } : {}) });
      }
      return json({ words });
    }

    if (!Array.isArray(parsed.entries)) {
      console.error('Malformed AI response:', raw);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }
    // deno-lint-ignore no-explicit-any
    const words = (parsed.entries as any[])
      .filter(e => e && !e.skip && typeof e.de === 'string' && TYPES.includes(e.type) && e.en && e.zh)
      .map(e => {
        // The model sometimes writes the article into "de" itself ("die
        // Stadt") — the app keeps it separate, or it would show and be
        // spelled as part of the word.
        const m = String(e.de).trim().match(/^(der|die|das)\s+(.+)$/i);
        return { ...e, de: m ? m[2] : String(e.de).trim(), article: e.article || (m ? m[1].toLowerCase() : undefined) };
      })
      .map(e => ({
        de: e.de,
        article: ['der', 'die', 'das'].includes(e.article) ? e.article : undefined,
        plural: e.plural || undefined,
        type: e.type,
        thirdPerson: e.thirdPerson || undefined,
        pastTense: e.pastTense || undefined,
        perfectTense: e.perfectTense || undefined,
        category: e.category && CATEGORIES.includes(e.category) ? e.category : undefined,
        en: e.en,
        zh: e.zh,
      }));
    return json({ words });
  } catch (err) {
    console.error('extract-vocabulary error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
