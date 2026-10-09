// Book codes (see the shared_books migration): 'create' stores a copy of
// an imported book's word list under a fresh short code; 'get' returns the
// book for a code so a classmate can add it as their own imported book.
// The only reader/writer of shared_books (service role) — the table has no
// client policies, so books are reachable only by exact code.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Matches lib/storage.ts's MAX_WORDS_PER_BOOK.
const MAX_WORDS = 500;
const MAX_SHARES_PER_DAY = 20;
// No 0/O/1/I/L — codes get read aloud and copied off a whiteboard.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const TYPES = ['noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'phrase', 'other'];
// Every Word field a shared copy may carry (see lib/words.ts's Word) —
// anything else is dropped; id/level are reassigned by whoever joins.
const STRING_FIELDS = [
  'de', 'plural', 'thirdPerson', 'pastTense', 'perfectTense', 'en', 'zh', 'prepositionNote',
  'category', 'exercisePrompt', 'exercisePromptZh',
];

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// deno-lint-ignore no-explicit-any
function sanitizeWord(w: any): Record<string, unknown> | null {
  if (!w || typeof w !== 'object' || typeof w.de !== 'string' || !w.de.trim() || typeof w.en !== 'string') return null;
  if (!TYPES.includes(w.type)) return null;
  const out: Record<string, unknown> = { type: w.type };
  for (const f of STRING_FIELDS) {
    if (typeof w[f] === 'string' && w[f]) out[f] = w[f].slice(0, f.startsWith('exercisePrompt') ? 400 : 120);
  }
  if (['der', 'die', 'das'].includes(w.article)) out.article = w.article;
  if (w.copyModeOnly === true) out.copyModeOnly = true;
  if (typeof w.sourceId === 'string' && /^w\d{1,6}$/.test(w.sourceId)) out.sourceId = w.sourceId;
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();

    if (body?.action === 'get') {
      const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== CODE_LENGTH) return json({ found: false });
      const { data, error } = await supabase
        .from('shared_books')
        .select('code, name, source_pages, words, word_count, join_count')
        .eq('code', code)
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ found: false });
      if (body.join) {
        await supabase.from('shared_books').update({ join_count: data.join_count + 1 }).eq('code', code);
      }
      return json({
        found: true,
        book: { code: data.code, name: data.name, sourcePages: data.source_pages, words: data.words, wordCount: data.word_count },
      });
    }

    if (body?.action !== 'create') return json({ error: 'Unknown action' }, 400);

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
    if (!userId && !ip) return json({ error: 'Could not identify caller' }, 400);

    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    let countQuery = supabase.from('shared_books').select('code', { count: 'exact', head: true }).gte('created_at', dayAgo);
    countQuery = userId ? countQuery.eq('created_by', userId) : countQuery.eq('created_ip', ip);
    const { count } = await countQuery;
    if ((count ?? 0) >= MAX_SHARES_PER_DAY) return json({ limitReached: true });

    const name = String(body.name ?? '').trim().slice(0, 60) || 'Shared book';
    const sourcePages = String(body.sourcePages ?? '').slice(0, 120);
    const rawWords = Array.isArray(body.words) ? body.words.slice(0, MAX_WORDS) : [];
    const words = rawWords.map(sanitizeWord).filter(Boolean);
    if (words.length === 0) return json({ error: 'No words' }, 400);

    // A collision in 31^6 (~887M) codes is unlikely but cheap to retry.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const { error } = await supabase.from('shared_books').insert({
        code, name, source_pages: sourcePages, words, word_count: words.length,
        created_by: userId, created_ip: userId ? null : ip,
      });
      if (!error) return json({ code });
      if (error.code !== '23505') throw error; // unique_violation -> retry
    }
    return json({ error: 'Could not create a code' }, 500);
  } catch (err) {
    console.error('share-book error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
