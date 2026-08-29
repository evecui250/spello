// Backs the Word List page's "look up & add" flow (see
// app/words/page.tsx and lib/storage.ts's custom-words section): a
// learner searches for a German/English/Chinese term that isn't in the
// current book, and this defines it well enough to become a full,
// ordinary Word entry (see lib/words.ts) they can add to their own list —
// dictionary form, article/plural or verb tenses, and a gloss in BOTH
// languages (not just the caller's own nativeLanguage) so the resulting
// entry works the same as any hand-curated corpus word regardless of a
// later language switch. Same key-handling/rate-limiting/ai_usage
// rationale as every other Edge Function here: the OpenAI key lives only
// here, and every call counts against the same combined per-caller daily
// cap.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-4o-mini';

const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  term: string;
  level: string;
}

interface LookupResult {
  de: string;
  article?: 'der' | 'die' | 'das';
  plural?: string;
  type: 'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition' | 'conjunction' | 'phrase' | 'other';
  thirdPerson?: string;
  pastTense?: string;
  perfectTense?: string;
  en: string;
  zh: string;
  category?: string;
}

// The corpus's own real category values (see lib/words.ts) — asking the
// AI to pick one of these EXACT strings (rather than inventing its own)
// matters for more than cosmetics: buildMcqChoices/buildReverseMcqChoices
// (see lib/practice.ts) draw a word's MCQ distractors from same-category
// words FIRST, only falling back to same-type/same-level if that pool
// doesn't fill all 3 choices — confirmed real: a same-category corpus
// pool is almost always big enough on its own, so a custom word left
// categoryless would end up invisible as a distractor for every
// well-categorized corpus word it's tested alongside, even though it
// still works fine as the word BEING tested. Matching a real category
// closes that gap entirely instead of leaving it as a silent asymmetry.
const CATEGORIES = [
  'Alltag', 'Arbeit', 'Behörde', 'Bildung', 'Einkaufen', 'Essen', 'Familie', 'Finanzen', 'Freizeit',
  'Gefühle', 'Gesellschaft', 'Gesundheit', 'Kommunikation', 'Kultur', 'Länder', 'Medien', 'Natur',
  'Person', 'Politik', 'Reisen', 'Soziales', 'Sprache', 'Technik', 'Umwelt', 'Verkehr', 'Wohnen',
  'Zahlen', 'Zeit',
];

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
    const { term, level } = body;
    if (!term || !term.trim()) {
      return json({ error: 'Missing term' }, 400);
    }
    // Defensive cap — this is a single word/short phrase lookup, never a
    // sentence; a much longer input is either abuse or a mistake either way.
    if (term.length > 60) {
      return json({ error: 'Term too long' }, 400);
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
              'A German learner typed this into a dictionary search box: it may be a German word ' +
              '(in any form — inflected, a typo, missing capitalization), or an English or Chinese ' +
              'word/short phrase they want the German translation of. Figure out which, and resolve ' +
              'it to ONE specific German dictionary entry. If it genuinely is not a recognizable ' +
              'word or short phrase in German, English, or Chinese (gibberish, a whole sentence, ' +
              'random characters), respond with exactly {"found": false}. Otherwise respond with ' +
              'exactly this JSON: {"found": true, "de": "dictionary form", "article": "der/die/das ' +
              'or omit for non-nouns", "plural": "plural form, nouns only, omit if none", "type": ' +
              '"noun|verb|adjective|adverb|preposition|conjunction|phrase|other", "thirdPerson": "er/sie/es ' +
              'present form, verbs only, with separable prefix split off e.g. \\"steht auf\\"", ' +
              '"pastTense": "simple past er/sie/es form, verbs only, same split-prefix style", ' +
              '"perfectTense": "hat/ist + past participle, verbs only, e.g. \\"hat gekauft\\"", ' +
              '"en": "short English gloss, a few words at most", "zh": "short Simplified Chinese ' +
              `gloss", "category": one of exactly these strings if one genuinely fits (omit entirely ` +
              `if none do, don't force a poor fit): ${CATEGORIES.join(', ')}}. Omit any field that ` +
              'does not apply (a noun has no verb fields; only nouns get article/plural). Pick the ' +
              'single most common everyday sense if the word has several. The target learner is ' +
              `roughly CEFR ${level || 'A1'} level, so prefer the most standard, neutral register ` +
              'over slang/technical/archaic senses.',
          },
          { role: 'user', content: term.trim() },
        ],
        temperature: 0.2,
        max_tokens: 300,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error:', errText);
      return json({ error: 'AI lookup failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { found?: boolean } & Partial<LookupResult> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed empty — caught by the check below
    }
    const usage = result.usage ?? {};
    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      word_id: null,
      level: level || 'unknown',
      model: MODEL,
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    });

    if (!parsed.found) {
      return json({ found: false });
    }
    if (!parsed.de || !parsed.type || !parsed.en || !parsed.zh) {
      console.error('Malformed AI response:', raw);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }

    return json({
      found: true,
      word: {
        de: parsed.de,
        article: parsed.article,
        plural: parsed.plural,
        type: parsed.type,
        thirdPerson: parsed.thirdPerson,
        pastTense: parsed.pastTense,
        perfectTense: parsed.perfectTense,
        // Only trusted if it's actually one of the real category strings —
        // a model that ignores the instruction and invents its own would
        // otherwise silently create a category no corpus word ever
        // matches, which is worse than having none (see CATEGORIES' own
        // comment on why this field exists at all).
        category: parsed.category && CATEGORIES.includes(parsed.category) ? parsed.category : undefined,
        en: parsed.en,
        zh: parsed.zh,
      },
    });
  } catch (err) {
    console.error('lookup-word error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
