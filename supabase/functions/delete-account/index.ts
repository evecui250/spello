// "Delete my account" (Profile → Account): permanently deletes the signed-in
// learner's account and their data. Apple requires apps with sign-up to
// offer this in the app itself.
//
// Deleting the auth user cascades to everything tied to it (progress,
// daily activity, profile, owned accessories, AI usage rows — see their
// ON DELETE CASCADE foreign keys). Tables that only SET NULL on delete are
// handled here first: anything personal (bug reports with their email and
// message, pet chats and memories) is deleted; anonymous counters
// (game_plays, usage_pings) just lose the link to the account. Shared book
// codes stay usable by classmates, without the creator link.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const caller = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await caller.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return json({ error: 'Not signed in' }, 401);

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    for (const table of ['bug_reports', 'pet_memories', 'pet_chat_sessions']) {
      const { error } = await db.from(table).delete().eq('user_id', userId);
      if (error) { console.error(`delete-account: ${table}`, error.message); return json({ error: 'Could not delete your data' }, 500); }
    }
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) { console.error('delete-account: auth', error.message); return json({ error: 'Could not delete your account' }, 500); }
    return json({ ok: true });
  } catch (err) {
    console.error('delete-account error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
