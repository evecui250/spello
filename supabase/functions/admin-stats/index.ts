// Aggregate stats for the /admin page — the app-owner-only alternative to
// digging through the Supabase dashboard by hand. Deployed --no-verify-jwt
// since it does its OWN authorization check below (comparing the caller's
// real signed-in email against ADMIN_EMAIL) rather than accepting any
// authenticated user; a stricter check than Supabase's default "any valid
// JWT" verification would give us. Reads with the service-role key
// (bypasses RLS) since this deliberately needs to see everyone's data in
// aggregate, not just the caller's own.
//
// Everything below is aggregated in plain JS after a handful of bounded
// queries, rather than SQL-side GROUP BY views — simplest through the JS
// client, and fine at the data volumes a small/early-stage app actually
// has. Revisit (move to SQL views, like ai_usage_daily_by_user) if this
// ever gets slow.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'evecui250@gmail.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const TREND_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// YYYY-MM-DD in UTC — the same "plain calendar date" convention every
// date column here already uses (ping_date, activity_date are both dates,
// not timestamps). Good enough for a small, single-timezone-ish user base
// right now; a date right at a day boundary can land on either side
// depending on the caller's own timezone vs UTC, same known/accepted
// looseness usage_pings already has elsewhere in this codebase.
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Every calendar date in the trailing N-day window, oldest first — trend
// arrays are built FROM this (not just from whatever rows happen to
// exist), so a day with zero activity still shows as a real zero point
// instead of silently vanishing from the chart.
function lastNDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(dateStr(new Date(Date.now() - i * DAY_MS)));
  }
  return out;
}

interface AiUsageSummary {
  calls: number;
  distinctCallers: number;
  estimatedCostUsd: number;
}

// gpt-4o-mini pricing at the time this was written ($0.15/1M input,
// $0.60/1M output) — same constants as the ai_usage_summary_view
// migration; check OpenAI's current pricing if this drifts.
function costUsd(inputTokens: number, outputTokens: number): number {
  return Math.round((inputTokens * 0.15 + outputTokens * 0.60) / 1000000 * 10000) / 10000;
}

function summarizeAiUsage(rows: { user_id: string | null; ip_address: string | null; input_tokens: number; output_tokens: number }[]): AiUsageSummary {
  const callers = new Set(rows.map(r => r.user_id ?? r.ip_address));
  const inputTokens = rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const outputTokens = rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
  return { calls: rows.length, distinctCallers: callers.size, estimatedCostUsd: costUsd(inputTokens, outputTokens) };
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
    if (userData.user.email !== ADMIN_EMAIL) return json({ error: 'Not authorized' }, 403);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const todayStr = dateStr(new Date());
    const windowDays = lastNDays(TREND_DAYS);
    const windowStartIso = new Date(Date.now() - TREND_DAYS * DAY_MS).toISOString();
    const windowStartDate = windowStartIso.slice(0, 10);

    // All signed-up accounts — the GoTrue admin API, not a public-schema
    // table, so this goes through auth.admin rather than .from(...).
    // Reused for the signup trend, today's new-signup count, and the
    // leaderboard's user_id -> email lookup, rather than fetching users
    // multiple times.
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const allUsers = usersError ? [] : usersData.users;
    const emailByUserId = new Map(allUsers.map(u => [u.id, u.email ?? '(no email)']));
    const totalAccounts = allUsers.length;
    const newSignupsToday = allUsers.filter(u => dateStr(new Date(u.created_at)) === todayStr).length;

    const signupTrend = windowDays.map(date => ({
      date,
      count: allUsers.filter(u => dateStr(new Date(u.created_at)) === date).length,
    }));

    // Accounts that have actually studied something (a user_progress row
    // only ever exists after a real first sync — see sync.ts), plus each
    // account's current level, for the level-breakdown chart's signed-in
    // half.
    const { data: progressRows, count: accountsStartedLearning } = await admin
      .from('user_progress')
      .select('user_id, level', { count: 'exact' });

    // usage_pings: every ping in the trend window, used for the device
    // trend, today's new-device/new-IP counts, and the anonymous half of
    // the level breakdown. "New device/IP today" needs each one's TRUE
    // first-ever appearance, which the window-bounded query above can't
    // answer on its own (a device/IP whose real first ping was outside
    // the window would be miscounted as new) — so first-seen is computed
    // from a second, unbounded query over device_id/ip_address only.
    const { data: pingsInWindow } = await admin
      .from('usage_pings')
      .select('device_id, ip_address, signed_in, level, ping_date')
      .gte('ping_date', windowStartDate);
    const pingRows = pingsInWindow ?? [];

    const deviceTrend = windowDays.map(date => {
      const rows = pingRows.filter(r => r.ping_date === date);
      return {
        date,
        signedIn: new Set(rows.filter(r => r.signed_in).map(r => r.device_id)).size,
        anonymous: new Set(rows.filter(r => !r.signed_in).map(r => r.device_id)).size,
      };
    });

    const { data: allPingsIdsOnly } = await admin.from('usage_pings').select('device_id, ip_address, created_at');
    function firstSeenMap<T extends string>(rows: { created_at: string }[], key: (r: { created_at: string }) => T | null): Map<T, number> {
      const out = new Map<T, number>();
      for (const r of rows) {
        const k = key(r);
        if (k === null) continue;
        const t = new Date(r.created_at).getTime();
        const prev = out.get(k);
        if (prev === undefined || t < prev) out.set(k, t);
      }
      return out;
    }
    const allPingRows = (allPingsIdsOnly ?? []) as { device_id: string; ip_address: string | null; created_at: string }[];
    const deviceFirstSeen = firstSeenMap(allPingRows, r => r.device_id);
    const ipFirstSeen = firstSeenMap(allPingRows, r => r.ip_address);
    const todayStart = new Date(`${todayStr}T00:00:00.000Z`).getTime();
    const newDevicesToday = [...deviceFirstSeen.values()].filter(t => t >= todayStart).length;
    const newIpsToday = [...ipFirstSeen.entries()].filter(([, t]) => t >= todayStart).map(([ip]) => ip);
    // Of those new IPs, how many had at least one signed-in ping today —
    // answers "how many new IPs signed in" directly.
    const todaysPings = pingRows.filter(r => r.ping_date === todayStr);
    const newIpsSignedInToday = newIpsToday.filter(ip => todaysPings.some(r => r.ip_address === ip && r.signed_in)).length;
    const newDevicesTodaySignedIn = todaysPings.filter(r => deviceFirstSeen.get(r.device_id)! >= todayStart && r.signed_in).length;
    const newDevicesTodayAnonymous = newDevicesToday - newDevicesTodaySignedIn;

    // Level breakdown: signed-in half from each account's current level
    // (user_progress.level, one row per account); anonymous half from
    // TODAY's anonymous pings (the most recent signal we have for a
    // never-signed-in visitor — there's no persistent "account" to read a
    // level off of otherwise).
    const levelCounts = new Map<string, { signedIn: number; anonymous: number }>();
    const bump = (level: string | null | undefined, key: 'signedIn' | 'anonymous') => {
      const l = level || 'unknown';
      const entry = levelCounts.get(l) ?? { signedIn: 0, anonymous: 0 };
      entry[key] += 1;
      levelCounts.set(l, entry);
    };
    for (const row of progressRows ?? []) bump(row.level, 'signedIn');
    for (const row of todaysPings.filter(r => !r.signed_in)) bump(row.level, 'anonymous');
    const levelBreakdown = [...levelCounts.entries()]
      .map(([level, counts]) => ({ level, ...counts }))
      .sort((a, b) => (b.signedIn + b.anonymous) - (a.signedIn + a.anonymous));

    // AI usage: last-30-days window for the trend, filtered down to today
    // for the "Today" card — one query covers both, split by whether
    // user_id is set (anonymous calls are rate-limited/logged by
    // ip_address instead; see correct-sentence/generate-sentence).
    const { data: aiRowsWindow } = await admin
      .from('ai_usage')
      .select('user_id, ip_address, input_tokens, output_tokens, created_at')
      .gte('created_at', windowStartIso);
    const aiRows = aiRowsWindow ?? [];
    const aiUsageTrend = windowDays.map(date => {
      const rows = aiRows.filter(r => dateStr(new Date(r.created_at)) === date);
      const signedIn = rows.filter(r => r.user_id !== null);
      const anon = rows.filter(r => r.user_id === null);
      return {
        date,
        signedInCalls: signedIn.length,
        anonymousCalls: anon.length,
        costUsd: costUsd(rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0), rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0)),
      };
    });
    const aiRowsToday = aiRows.filter(r => dateStr(new Date(r.created_at)) === todayStr);
    const aiUsageToday = {
      signedIn: summarizeAiUsage(aiRowsToday.filter(r => r.user_id !== null)),
      anonymous: summarizeAiUsage(aiRowsToday.filter(r => r.user_id === null)),
    };

    // Words studied: only ever known for signed-in, synced accounts (see
    // the daily_activity migration) — an anonymous learner's word-level
    // progress never reaches the server at all. This will read as mostly
    // empty before the date this feature shipped; it can't backfill.
    const { data: activityWindow } = await admin
      .from('daily_activity')
      .select('user_id, activity_date, words_studied, words_mastered, level')
      .gte('activity_date', windowStartDate);
    const activityRows = activityWindow ?? [];
    const wordsStudiedTrend = windowDays.map(date => ({
      date,
      total: activityRows.filter(r => r.activity_date === date).reduce((s, r) => s + (r.words_studied ?? 0), 0),
    }));
    const wordsStudiedToday = activityRows
      .filter(r => r.activity_date === todayStr)
      .reduce((s, r) => s + (r.words_studied ?? 0), 0);

    // Leaderboard: today's daily_activity rows, sorted most-to-least
    // words studied — signed-in/synced learners only, by construction
    // (see above). Top 20 is plenty for a quick glance at this scale.
    const leaderboardToday = activityRows
      .filter(r => r.activity_date === todayStr && r.words_studied > 0)
      .sort((a, b) => b.words_studied - a.words_studied)
      .slice(0, 20)
      .map(r => ({
        email: emailByUserId.get(r.user_id) ?? '(unknown)',
        wordsStudied: r.words_studied,
        wordsMastered: r.words_mastered,
        level: r.level,
      }));

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

    return json({
      totals: {
        totalAccounts,
        accountsStartedLearning: accountsStartedLearning ?? 0,
      },
      today: {
        newSignups: newSignupsToday,
        newDevicesSignedIn: newDevicesTodaySignedIn,
        newDevicesAnonymous: newDevicesTodayAnonymous,
        newIpsTotal: newIpsToday.length,
        newIpsSignedIn: newIpsSignedInToday,
        wordsStudied: wordsStudiedToday,
        aiUsage: aiUsageToday,
      },
      trends: {
        signups: signupTrend,
        devices: deviceTrend,
        aiUsage: aiUsageTrend,
        wordsStudied: wordsStudiedTrend,
      },
      levelBreakdown,
      leaderboardToday,
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
