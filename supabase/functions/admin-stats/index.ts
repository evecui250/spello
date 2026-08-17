// Aggregate stats for the /admin page — the app-owner-only alternative to
// digging through the Supabase dashboard by hand. Deployed --no-verify-jwt
// since it does its OWN authorization check below (comparing the caller's
// real signed-in email against ADMIN_EMAIL) rather than accepting any
// authenticated user; a stricter check than Supabase's default "any valid
// JWT" verification would give us. Reads with the service-role key
// (bypasses RLS) since this deliberately needs to see everyone's data in
// aggregate, not just the caller's own.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'evecui250@gmail.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

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
    if (userData.user.email !== ADMIN_EMAIL) return json({ error: 'Not authorized' }, 403);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Total signed-up accounts — the GoTrue admin API, not a public-schema
    // table, so this goes through auth.admin rather than .from(...).
    // Reused below for the last-24h signup count too, rather than a
    // second call — listUsers() already returns each user's created_at.
    let totalUsers = 0;
    let newSignedUpUsers24h = 0;
    {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!error) {
        totalUsers = data.users.length;
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        newSignedUpUsers24h = data.users.filter(u => new Date(u.created_at).getTime() > dayAgo).length;
      }
    }

    // usage_pings: bounded to the last 90 days (plenty for a small app,
    // keeps this from growing unbounded forever) — distinct-device counts
    // computed here rather than via a raw SQL aggregate, since that's
    // simplest through the JS client at this scale.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: pings } = await admin
      .from('usage_pings')
      .select('device_id, signed_in, ping_date')
      .gte('ping_date', ninetyDaysAgo);
    const pingRows = pings ?? [];
    const distinctDevices = (rows: typeof pingRows) => new Set(rows.map(r => r.device_id)).size;
    const usage = {
      todayDevices: distinctDevices(pingRows.filter(r => r.ping_date === today)),
      last7DaysDevices: distinctDevices(pingRows.filter(r => r.ping_date >= sevenDaysAgo)),
      last90DaysDevices: distinctDevices(pingRows),
      signedInDevices90d: distinctDevices(pingRows.filter(r => r.signed_in)),
    };

    // "New devices in the last 24h" needs each device's TRUE first-ever
    // ping, not just whether it pinged in the last 24h -- a device that's
    // been around for months but happens to ping today isn't new. That
    // means this can't reuse the 90-day-bounded `pingRows` above (a device
    // whose real first ping was over 90 days ago would be miscounted as
    // new here); it needs its own unbounded query over device_id +
    // created_at only. Fine at this scale — see the same tradeoff already
    // accepted for the 90-day aggregates above.
    let newDevices24h = 0;
    {
      const { data: allPings } = await admin.from('usage_pings').select('device_id, created_at');
      const firstSeenByDevice = new Map<string, number>();
      for (const r of allPings ?? []) {
        const t = new Date(r.created_at).getTime();
        const prev = firstSeenByDevice.get(r.device_id);
        if (prev === undefined || t < prev) firstSeenByDevice.set(r.device_id, t);
      }
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      newDevices24h = [...firstSeenByDevice.values()].filter(t => t > dayAgo).length;
    }

    // AI usage in the last 24h, split by signed-in vs anonymous caller —
    // anonymous rows (user_id is null, rate-limited by ip_address instead;
    // see correct-sentence/generate-sentence) would otherwise be invisible
    // from the ai_usage_daily_by_user SQL view, which lumps every
    // anonymous caller into one user_id-is-null row. Aggregated here in JS
    // rather than a new SQL view, matching how usage_pings is already
    // aggregated above.
    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: aiRows } = await admin
      .from('ai_usage')
      .select('user_id, ip_address, input_tokens, output_tokens')
      .gte('created_at', dayAgoIso);
    function summarizeAiUsage(rows: { user_id: string | null; ip_address: string | null; input_tokens: number; output_tokens: number }[]) {
      const callers = new Set(rows.map(r => r.user_id ?? r.ip_address));
      const inputTokens = rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
      const outputTokens = rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
      // gpt-4o-mini pricing at the time this was written ($0.15/1M input,
      // $0.60/1M output) — same constants as the ai_usage_summary_view
      // migration; check OpenAI's current pricing if this drifts.
      const estimatedCostUsd = Math.round((inputTokens * 0.15 + outputTokens * 0.60) / 1000000 * 10000) / 10000;
      return { calls: rows.length, distinctCallers: callers.size, estimatedCostUsd };
    }
    const aiRowsList = aiRows ?? [];
    const aiUsage24h = {
      signedIn: summarizeAiUsage(aiRowsList.filter(r => r.user_id !== null)),
      anonymous: summarizeAiUsage(aiRowsList.filter(r => r.user_id === null)),
    };

    // Bug reports: total count plus the 5 most recent, for a quick glance
    // without needing to open the table editor.
    const { count: bugReportCount } = await admin
      .from('bug_reports')
      .select('id', { count: 'exact', head: true });
    const { data: recentBugReports } = await admin
      .from('bug_reports')
      .select('id, message, page_path, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    // Learning activity: how many user_progress rows exist at all (rough
    // proxy for "accounts that have actually studied something", since a
    // row is only created on a real first sync — see sync.ts).
    const { count: syncedProgressCount } = await admin
      .from('user_progress')
      .select('user_id', { count: 'exact', head: true });

    return json({
      totalUsers,
      syncedProgressCount: syncedProgressCount ?? 0,
      usage,
      last24h: {
        newSignedUpUsers: newSignedUpUsers24h,
        newDevices: newDevices24h,
        aiUsage: aiUsage24h,
      },
      bugReportCount: bugReportCount ?? 0,
      recentBugReports: recentBugReports ?? [],
    });
  } catch (err) {
    console.error('admin-stats error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
