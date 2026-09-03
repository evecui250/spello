// Powers the Settings-page mascot/shop picker (see components/
// MascotShopModal.tsx) — a signed-in-only read of the caller's own
// nickname/avatar/equipped accessory/owned accessories and their real
// points balance. Kept as a real server function (not computed
// client-side, even though nothing technically blocks that once
// game_plays gets a select policy) specifically so the DISPLAYED balance
// here and the GATING balance in buy-accessory can never subtly disagree
// — a uniquely confusing bug class for a currency feature. The balance
// formula below is deliberately duplicated (not shared) from
// buy-accessory's own copy — no _shared/ module exists anywhere in this
// codebase's Edge Functions, so every function here duplicates whatever
// small constants it needs instead (see e.g. generate-sentence's own
// WORD_RANGE comment).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Kept in sync with lib/shop.ts's own copy and get-leaderboard/
// buy-accessory's — see lib/shop.ts's comment for why this cap exists.
const GAME_PLAY_DAILY_POINT_CAP = 5;

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Not authenticated' }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const [{ data: profileRow }, { data: activityRows }, { data: gameRows }, { data: ownedRows }] = await Promise.all([
      admin.from('profiles').select('nickname, avatar_id, equipped_accessory_id, leaderboard_opt_out').eq('user_id', userId).maybeSingle(),
      admin.from('daily_activity').select('words_studied').eq('user_id', userId),
      admin.from('game_plays').select('created_at').eq('user_id', userId),
      admin.from('owned_accessories').select('accessory_id, cost_paid').eq('user_id', userId),
    ]);

    const earnedFromWords = (activityRows ?? []).reduce((s, r) => s + (r.words_studied ?? 0), 0);

    const gamesByDay = new Map<string, number>();
    for (const row of gameRows ?? []) {
      const day = dateStr(new Date(row.created_at));
      gamesByDay.set(day, (gamesByDay.get(day) ?? 0) + 1);
    }
    let earnedFromGames = 0;
    for (const count of gamesByDay.values()) earnedFromGames += Math.min(count, GAME_PLAY_DAILY_POINT_CAP);

    const spent = (ownedRows ?? []).reduce((s, r) => s + (r.cost_paid ?? 0), 0);
    const balance = earnedFromWords + earnedFromGames - spent;

    return json({
      nickname: profileRow?.nickname ?? null,
      avatarId: profileRow?.avatar_id ?? 'dachshund',
      equippedAccessoryId: profileRow?.equipped_accessory_id ?? null,
      leaderboardOptOut: profileRow?.leaderboard_opt_out ?? false,
      ownedAccessoryIds: (ownedRows ?? []).map(r => r.accessory_id),
      balance,
    });
  } catch (err) {
    console.error('get-my-profile error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
