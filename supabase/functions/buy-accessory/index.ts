// Spends points on a cosmetic accessory — see components/
// MascotShopModal.tsx. Signed-in only. The balance formula below is
// deliberately duplicated (not shared) from get-my-profile's own copy —
// see that function's header comment for why (no _shared/ module exists
// in this codebase's Edge Functions). The accessory catalog is likewise
// duplicated from lib/shop.ts's own copy, kept in sync by hand.
//
// Not a DB transaction/row-lock — an accepted, documented limitation at
// this app's current scale, not a silent gap: after inserting, the
// balance is re-verified, and if a concurrent purchase raced this one
// into overdraft, the just-inserted row is deleted and an error
// returned, rather than leaving the account negative.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Kept in sync with lib/shop.ts's own copy.
const GAME_PLAY_DAILY_POINT_CAP = 5;
// Emptied for now -- see lib/shop.ts's own copy for why. Every purchase
// attempt correctly falls through to "Unknown accessory" below until
// items are re-added here.
const ACCESSORY_CATALOG: Record<string, number> = {};

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface RequestBody {
  accessoryId: string;
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

    const body = (await req.json()) as RequestBody;
    const accessoryId = body.accessoryId;
    const cost = ACCESSORY_CATALOG[accessoryId];
    if (!accessoryId || cost === undefined) {
      return json({ ok: false, error: 'Unknown accessory' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: existing } = await admin
      .from('owned_accessories')
      .select('accessory_id')
      .eq('user_id', userId)
      .eq('accessory_id', accessoryId)
      .maybeSingle();
    if (existing) return json({ ok: false, error: 'Already owned' }, 400);

    async function computeBalance(): Promise<number> {
      const [{ data: activityRows }, { data: gameRows }, { data: ownedRows }] = await Promise.all([
        admin.from('daily_activity').select('words_studied').eq('user_id', userId),
        admin.from('game_plays').select('created_at').eq('user_id', userId),
        admin.from('owned_accessories').select('cost_paid').eq('user_id', userId),
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
      return earnedFromWords + earnedFromGames - spent;
    }

    const balanceBefore = await computeBalance();
    if (balanceBefore < cost) {
      return json({ ok: false, error: 'Not enough points', balance: balanceBefore }, 400);
    }

    const { error: insertError } = await admin
      .from('owned_accessories')
      .insert({ user_id: userId, accessory_id: accessoryId, cost_paid: cost });
    if (insertError) {
      console.error('buy-accessory insert failed:', insertError.message);
      return json({ ok: false, error: 'Purchase failed' }, 500);
    }

    // Compensating check against a concurrent-purchase race: if another
    // request spent points between balanceBefore and now, this could have
    // gone negative -- verify and roll back rather than leave an overdraft.
    const balanceAfter = await computeBalance();
    if (balanceAfter < 0) {
      await admin.from('owned_accessories').delete().eq('user_id', userId).eq('accessory_id', accessoryId);
      return json({ ok: false, error: 'Not enough points', balance: balanceBefore }, 400);
    }

    return json({ ok: true, balance: balanceAfter });
  } catch (err) {
    console.error('buy-accessory error:', err);
    return json({ ok: false, error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
