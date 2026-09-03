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

// Kept in sync with lib/shop.ts's own copy (and get-leaderboard/
// get-my-profile/buy-accessory's) -- see that file's comment for why
// this cap exists.
const GAME_PLAY_DAILY_POINT_CAP = 5;

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
    // Collected (not just console.error'd) so /admin can show a real error
    // banner instead of a wrong-looking "0" if a query keeps failing —
    // temporary/diagnostic, but console logs weren't reachable to pin
    // down why accountsStartedLearning read 0 even after splitting that
    // query out from the heavier one below, so surfacing the actual
    // Postgres/PostgREST message directly in the response is the fastest
    // way to actually see it without dashboard log access.
    const debugErrors: string[] = [];
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
    if (usersError) {
      console.error('listUsers failed:', usersError.message);
      debugErrors.push(`listUsers: ${usersError.message}`);
    }
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
    // account's current level (for the level-breakdown chart's signed-in
    // half). Deliberately its OWN lightweight query, separate from the
    // full progress blob below — confirmed real: these used to be one
    // combined select, and accountsStartedLearning/levelBreakdown's
    // signed-in half started silently reading as 0 the moment `progress`
    // (every account's full learning history, unbounded) got added to
    // that same select for the word-stages feature. Neither branch here
    // was ever checked for `error` before, so a failure on the heavy
    // column silently zeroed out the cheap one riding along with it
    // instead of surfacing anywhere. Logged now (not just swallowed) so a
    // future failure shows up in the function's logs instead of just
    // reading as "0 accounts", which looks like real data rather than a
    // broken query.
    const { data: progressLevelRows, count: accountsStartedLearning, error: progressLevelError } = await admin
      .from('user_progress')
      .select('user_id, level', { count: 'exact' });
    if (progressLevelError) {
      console.error('user_progress (level) query failed:', progressLevelError.message);
      debugErrors.push(`user_progress (level): ${progressLevelError.message}`);
    }

    // Full progress blob — only used for the word-stages breakdown, kept
    // separate (see above) so a problem here can't also take out the
    // accounts-started-learning count or the level breakdown. `level`
    // is included again too (cheap either way, not the risky part) so
    // the per-learner word-stages table can still show it without a
    // third query or a join against progressLevelRows.
    const { data: progressRows, error: progressError } = await admin
      .from('user_progress')
      .select('user_id, level, progress');
    if (progressError) {
      console.error('user_progress (progress) query failed:', progressError.message);
      debugErrors.push(`user_progress (progress): ${progressError.message}`);
    }

    // progress is nested by level ({A1: {...}, B2: {...}}) for any account
    // that's synced since the per-level split shipped; a handful of very
    // old rows can still be one flat {wordId: WordProgress} blob from
    // before that — same shape sync.ts's own pullAndMerge already has to
    // handle. Good enough here to just check whether every top-level key
    // looks like a level code, without sync.ts's fuller migration handling
    // — this is a read-only admin view, not a data-correctness-critical path.
    const LEVEL_KEYS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const STAGE_KEYS = ['puppy', 'short', 'medium', 'long-crowned'] as const;
    function stageCounts(progress: unknown): Record<typeof STAGE_KEYS[number], number> {
      const counts = { puppy: 0, short: 0, medium: 0, 'long-crowned': 0 };
      if (!progress || typeof progress !== 'object') return counts;
      const obj = progress as Record<string, unknown>;
      const isNested = Object.keys(obj).length > 0 && Object.keys(obj).every(k => LEVEL_KEYS.includes(k));
      const wordMaps = (isNested ? Object.values(obj) : [obj]) as Record<string, unknown>[];
      for (const wordMap of wordMaps) {
        if (!wordMap || typeof wordMap !== 'object') continue;
        for (const wp of Object.values(wordMap)) {
          const stage = (wp as { mascotStage?: string } | null)?.mascotStage;
          if (stage && stage in counts) counts[stage as typeof STAGE_KEYS[number]] += 1;
        }
      }
      return counts;
    }
    const learnerRows = (progressRows ?? []).map(r => ({
      email: emailByUserId.get(r.user_id) ?? '(unknown)',
      level: r.level as string | null,
      stages: stageCounts(r.progress),
    }));
    const stageTotals = learnerRows.reduce((acc, r) => {
      for (const k of STAGE_KEYS) acc[k] += r.stages[k];
      return acc;
    }, { puppy: 0, short: 0, medium: 0, 'long-crowned': 0 });
    const learnersByStageTotal = [...learnerRows]
      .sort((a, b) => {
        const totalOf = (r: typeof a) => STAGE_KEYS.reduce((s, k) => s + r.stages[k], 0);
        return totalOf(b) - totalOf(a);
      });

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

    const { data: allPingsIdsOnly } = await admin.from('usage_pings').select('device_id, ip_address, created_at, user_id, theme');
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
    const allPingRows = (allPingsIdsOnly ?? []) as { device_id: string; ip_address: string | null; created_at: string; user_id: string | null; theme: string | null }[];
    const deviceFirstSeen = firstSeenMap(allPingRows, r => r.device_id);
    const ipFirstSeen = firstSeenMap(allPingRows, r => r.ip_address);

    // "How many people have actually used it, roughly" — a distinct IP is
    // a coarser, imperfect proxy for a person (shared wifi/NAT undercounts,
    // a mobile network changing IPs overcounts), but it's the only signal
    // available for someone who never signs in and isn't device_id (which
    // undercounts differently — same device, storage cleared, counts as a
    // new device but the same IP). "Active in the past 7 days" reuses the
    // exact same unbounded ping data already fetched above, no new query.
    const sevenDaysAgoTime = Date.now() - 7 * DAY_MS;
    const totalDistinctIps = new Set(allPingRows.map(r => r.ip_address).filter((ip): ip is string => !!ip)).size;
    const activeIps7d = new Set(
      allPingRows
        .filter(r => r.ip_address && new Date(r.created_at).getTime() >= sevenDaysAgoTime)
        .map(r => r.ip_address as string),
    ).size;
    // Country breakdown: ip-api.com's free batch endpoint (no key, HTTP
    // only — the free tier doesn't offer HTTPS; this is a server-to-
    // server call from the function's own runtime, not the visitor's
    // browser, so nothing about their connection is exposed by this).
    // Looked up fresh on every admin-stats call rather than cached/stored
    // anywhere — this is an on-demand dashboard view, not a live per-visit
    // pipeline, and the free tier's ~15 req/min limit (batches of up to
    // 100 IPs each still count as one request) is comfortably enough for
    // that. Best-effort: any failure here (network hiccup, rate limit)
    // just means the geo breakdown reads empty, never breaks the rest of
    // this dashboard.
    const allIps = [...new Set(allPingRows.map(r => r.ip_address).filter((ip): ip is string => !!ip))];
    const countryByIp = new Map<string, string>();
    try {
      for (let i = 0; i < allIps.length; i += 100) {
        const chunk = allIps.slice(i, i + 100);
        const res = await fetch('http://ip-api.com/batch?fields=query,country,status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) { console.error('ip-api batch lookup failed:', res.status); break; }
        const results = await res.json() as { query: string; country?: string; status: string }[];
        for (const r of results) {
          countryByIp.set(r.query, r.status === 'success' && r.country ? r.country : 'Unknown');
        }
      }
    } catch (err) {
      console.error('ip-api batch lookup error:', err instanceof Error ? err.message : err);
    }
    // "IPs" — every distinct IP counted once, by its country. "Users" —
    // every distinct device counted once, by the country of its MOST
    // RECENT ping's IP (a device seen from two countries, e.g. travel or
    // a VPN, only ever counts under whichever is most recent).
    const deviceLatestIp = new Map<string, { ip: string; t: number }>();
    for (const r of allPingRows) {
      if (!r.ip_address) continue;
      const t = new Date(r.created_at).getTime();
      const prev = deviceLatestIp.get(r.device_id);
      if (!prev || t > prev.t) deviceLatestIp.set(r.device_id, { ip: r.ip_address, t });
    }
    function bumpCountry(map: Map<string, number>, country: string) {
      map.set(country, (map.get(country) ?? 0) + 1);
    }
    const byIpCountry = new Map<string, number>();
    for (const ip of allIps) bumpCountry(byIpCountry, countryByIp.get(ip) ?? 'Unknown');
    const byUserCountry = new Map<string, number>();
    for (const { ip } of deviceLatestIp.values()) bumpCountry(byUserCountry, countryByIp.get(ip) ?? 'Unknown');
    const toSortedArray = (m: Map<string, number>) =>
      [...m.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count);
    const geoBreakdown = { byIp: toSortedArray(byIpCountry), byUser: toSortedArray(byUserCountry) };

    // Theme breakdown: each device's MOST RECENT ping's theme (same
    // "most recent wins" rule as deviceLatestIp/country above) -- a
    // device that switched themes only ever counts under whichever it's
    // using now, not partial credit for one it briefly tried. `theme` is
    // NULL on any ping recorded before that column existed, so devices
    // that haven't pinged since then simply don't appear here yet.
    // Ordered dark -> bright (THEME_CONFIG's own key order in
    // AppBackground.tsx, i.e. Settings' picker order) rather than by
    // count, same reasoning as LEVEL_DISPLAY_ORDER below -- a fixed order
    // reads easier at a glance than one that reshuffles every time the
    // numbers change.
    const deviceLatestTheme = new Map<string, { theme: string; t: number }>();
    for (const r of allPingRows) {
      if (!r.theme) continue;
      const t = new Date(r.created_at).getTime();
      const prev = deviceLatestTheme.get(r.device_id);
      if (!prev || t > prev.t) deviceLatestTheme.set(r.device_id, { theme: r.theme, t });
    }
    const THEME_DISPLAY_ORDER = ['stellar', 'ocean', 'ember', 'forest', 'lavender', 'sunset', 'citrus', 'meadow', 'bubblegum', 'vanilla'];
    const themeRank = (theme: string) => {
      const i = THEME_DISPLAY_ORDER.indexOf(theme);
      return i === -1 ? THEME_DISPLAY_ORDER.length : i;
    };
    const themeCounts = new Map<string, number>();
    for (const { theme } of deviceLatestTheme.values()) themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    const themeBreakdown = [...themeCounts.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => themeRank(a.theme) - themeRank(b.theme));

    // Word Match game plays (see the game_plays migration) -- split by
    // entry point so "how many played from Settings' preview link" vs.
    // "how many played from the real end-of-learning slot" is visible
    // separately. dailyFlow reads 0 until that real slot actually exists
    // (see app/game/page.tsx's own top comment) -- expected, not a bug.
    const { data: gamePlayRows } = await admin.from('game_plays').select('source');
    const gamePlaysBySource = { settingsPreview: 0, dailyFlow: 0 };
    for (const r of gamePlayRows ?? []) {
      if (r.source === 'settings_preview') gamePlaysBySource.settingsPreview += 1;
      else if (r.source === 'daily_flow') gamePlaysBySource.dailyFlow += 1;
    }

    // Every registered account, most-recently-active first — "who's
    // actually signed up and who's actually using it" at a glance,
    // without digging through the Supabase auth dashboard by hand.
    // "Active" here means a real usage_pings row (fired on every genuine
    // app visit — see lib/telemetry.ts), which is a better signal than
    // auth's own last_sign_in_at: a returning learner on a persisted
    // session doesn't re-authenticate every visit, so last_sign_in_at can
    // sit stale for weeks while they're actively studying daily. Country
    // reuses the exact same IP->country lookup already done for the geo
    // charts above, keyed off each account's own most recent ping's IP —
    // same "most recent wins" rule deviceLatestIp uses. Falls back to the
    // account's signup date (never sorts above someone with a real ping,
    // since a ping can only be at-or-after signup) for an account that's
    // never actually pinged at all — created but never opened the app.
    const userLatestPing = new Map<string, { ip: string | null; t: number }>();
    for (const r of allPingRows) {
      if (!r.user_id) continue;
      const t = new Date(r.created_at).getTime();
      const prev = userLatestPing.get(r.user_id);
      if (!prev || t > prev.t) userLatestPing.set(r.user_id, { ip: r.ip_address, t });
    }
    const registeredLearners = [...allUsers]
      .map(u => {
        const latest = userLatestPing.get(u.id);
        const lastActiveMs = latest?.t ?? new Date(u.created_at).getTime();
        return {
          email: u.email ?? '(no email)',
          country: latest?.ip ? (countryByIp.get(latest.ip) ?? 'Unknown') : 'Unknown',
          lastActive: new Date(lastActiveMs).toISOString(),
          everActive: !!latest,
          createdAt: u.created_at,
        };
      })
      .sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());

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
    for (const row of progressLevelRows ?? []) bump(row.level, 'signedIn');
    for (const row of todaysPings.filter(r => !r.signed_in)) bump(row.level, 'anonymous');
    // A1 -> B2 (real book order), then "unknown" pinned last — was sorted
    // by count descending before, which reshuffled every time the numbers
    // changed and made the chart harder to scan at a glance.
    const LEVEL_DISPLAY_ORDER = ['A1', 'A2', 'B1', 'B2'];
    const levelRank = (level: string) => {
      const i = LEVEL_DISPLAY_ORDER.indexOf(level);
      return i === -1 ? LEVEL_DISPLAY_ORDER.length + 1 : i; // unknown/anything else sorts last
    };
    const levelBreakdown = [...levelCounts.entries()]
      .map(([level, counts]) => ({ level, ...counts }))
      .sort((a, b) => levelRank(a.level) - levelRank(b.level));

    // AI usage: last-30-days window for the trend, filtered down to today
    // for the "Today" card — one query covers both, split by whether
    // user_id is set (anonymous calls are rate-limited/logged by
    // ip_address instead; see correct-sentence/generate-sentence).
    const { data: aiRowsWindow } = await admin
      .from('ai_usage')
      .select('user_id, ip_address, input_tokens, output_tokens, created_at, kind')
      .gte('created_at', windowStartIso);
    const aiRows = (aiRowsWindow ?? []) as { user_id: string | null; ip_address: string | null; input_tokens: number; output_tokens: number; created_at: string; kind: string | null }[];
    // kind is null for any row inserted before the column existed —
    // treated as 'correction' (its only meaning back then), same as the
    // column's own DB default for new rows.
    const correctionRows = aiRows.filter(r => (r.kind ?? 'correction') === 'correction');
    const explanationRows = aiRows.filter(r => r.kind === 'explanation');
    const aiUsageTrend = windowDays.map(date => {
      const rows = correctionRows.filter(r => dateStr(new Date(r.created_at)) === date);
      const signedIn = rows.filter(r => r.user_id !== null);
      const anon = rows.filter(r => r.user_id === null);
      return {
        date,
        signedInCalls: signedIn.length,
        anonymousCalls: anon.length,
        costUsd: costUsd(rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0), rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0)),
      };
    });
    const aiRowsToday = correctionRows.filter(r => dateStr(new Date(r.created_at)) === todayStr);
    const aiUsageToday = {
      signedIn: summarizeAiUsage(aiRowsToday.filter(r => r.user_id !== null)),
      anonymous: summarizeAiUsage(aiRowsToday.filter(r => r.user_id === null)),
    };
    // "Why?" button usage — its own count, not folded into aiUsageToday
    // above, specifically so this answers "is anyone actually using this"
    // on its own rather than being invisible inside the correction totals.
    const explanationClicksToday = explanationRows.filter(r => dateStr(new Date(r.created_at)) === todayStr).length;
    const explanationClicksTrend = windowDays.map(date => ({
      date,
      count: explanationRows.filter(r => dateStr(new Date(r.created_at)) === date).length,
    }));

    // Words studied — signed-in/synced accounts via daily_activity (full
    // per-word detail never leaves an anonymous learner's device, so that
    // table only ever has real accounts in it — see its own migration).
    // Anonymous learners get a much coarser, device-keyed daily total
    // instead, from daily_activity_anon (see that migration and
    // record-anon-activity) — a real aggregate count, not per-word detail,
    // written on the same "after real activity" trigger as the signed-in
    // side rather than usage_pings' once-a-day page-load snapshot. Both
    // will read as mostly empty before the date each shipped; neither can
    // backfill history from before it existed.
    const { data: activityWindow } = await admin
      .from('daily_activity')
      .select('user_id, activity_date, words_studied, words_mastered, level')
      .gte('activity_date', windowStartDate);
    const activityRows = activityWindow ?? [];
    const { data: anonActivityWindow } = await admin
      .from('daily_activity_anon')
      .select('device_id, activity_date, words_studied, words_mastered, level')
      .gte('activity_date', windowStartDate);
    const anonActivityRows = anonActivityWindow ?? [];
    const wordsStudiedTrend = windowDays.map(date => ({
      date,
      signedIn: activityRows.filter(r => r.activity_date === date).reduce((s, r) => s + (r.words_studied ?? 0), 0),
      anonymous: anonActivityRows.filter(r => r.activity_date === date).reduce((s, r) => s + (r.words_studied ?? 0), 0),
    }));
    const wordsStudiedToday = {
      signedIn: activityRows.filter(r => r.activity_date === todayStr).reduce((s, r) => s + (r.words_studied ?? 0), 0),
      anonymous: anonActivityRows.filter(r => r.activity_date === todayStr).reduce((s, r) => s + (r.words_studied ?? 0), 0),
    };

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

    // Points per user -- all-time, unwindowed (unlike wordsStudiedTrend
    // above, which is the last TREND_DAYS only). Same balance formula as
    // get-my-profile/buy-accessory's own copies (kept in sync by hand,
    // same reasoning as those two — no _shared/ module in this codebase's
    // Edge Functions). "Total accumulated" is earned, before any
    // spending; "points left" is earned minus spent.
    const { data: allActivityRows } = await admin.from('daily_activity').select('user_id, words_studied');
    const { data: allGameRows } = await admin.from('game_plays').select('user_id, created_at').not('user_id', 'is', null);
    const { data: allOwnedRows } = await admin.from('owned_accessories').select('user_id, cost_paid');
    const { data: profileRows } = await admin.from('profiles').select('user_id, nickname');

    const earnedFromWordsByUser = new Map<string, number>();
    for (const row of allActivityRows ?? []) {
      earnedFromWordsByUser.set(row.user_id, (earnedFromWordsByUser.get(row.user_id) ?? 0) + (row.words_studied ?? 0));
    }
    const gamesByUserDay = new Map<string, Map<string, number>>();
    for (const row of allGameRows ?? []) {
      const uid = row.user_id as string;
      const day = dateStr(new Date(row.created_at));
      const byDay = gamesByUserDay.get(uid) ?? new Map<string, number>();
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      gamesByUserDay.set(uid, byDay);
    }
    const earnedFromGamesByUser = new Map<string, number>();
    for (const [uid, byDay] of gamesByUserDay) {
      let total = 0;
      for (const count of byDay.values()) total += Math.min(count, GAME_PLAY_DAILY_POINT_CAP);
      earnedFromGamesByUser.set(uid, total);
    }
    const spentByUser = new Map<string, number>();
    for (const row of allOwnedRows ?? []) {
      spentByUser.set(row.user_id, (spentByUser.get(row.user_id) ?? 0) + (row.cost_paid ?? 0));
    }
    const nicknameByUserId = new Map((profileRows ?? []).map(p => [p.user_id, p.nickname as string | null]));

    const pointsUserIds = new Set([...earnedFromWordsByUser.keys(), ...earnedFromGamesByUser.keys(), ...spentByUser.keys()]);
    const userPoints = [...pointsUserIds].map(uid => {
      const earned = (earnedFromWordsByUser.get(uid) ?? 0) + (earnedFromGamesByUser.get(uid) ?? 0);
      const spent = spentByUser.get(uid) ?? 0;
      return {
        email: emailByUserId.get(uid) ?? '(unknown)',
        nickname: nicknameByUserId.get(uid) ?? null,
        totalAccumulated: earned,
        pointsLeft: earned - spent,
      };
    }).sort((a, b) => b.totalAccumulated - a.totalAccumulated);

    return json({
      totals: {
        totalAccounts,
        accountsStartedLearning: accountsStartedLearning ?? 0,
        totalDistinctIps,
        activeIps7d,
      },
      today: {
        newSignups: newSignupsToday,
        newDevicesSignedIn: newDevicesTodaySignedIn,
        newDevicesAnonymous: newDevicesTodayAnonymous,
        newIpsTotal: newIpsToday.length,
        newIpsSignedIn: newIpsSignedInToday,
        wordsStudied: wordsStudiedToday,
        aiUsage: aiUsageToday,
        explanationClicks: explanationClicksToday,
      },
      trends: {
        signups: signupTrend,
        devices: deviceTrend,
        aiUsage: aiUsageTrend,
        wordsStudied: wordsStudiedTrend,
        explanationClicks: explanationClicksTrend,
      },
      levelBreakdown,
      geoBreakdown,
      themeBreakdown,
      gamePlaysBySource,
      registeredLearners,
      leaderboardToday,
      // Signed-in/synced learners only — see the comment on the query
      // above for why anonymous learners can't appear here at all (their
      // word-level progress never reaches the server, full stop).
      wordStages: {
        totals: stageTotals,
        byLearner: learnersByStageTotal,
      },
      bugReportCount: bugReportCount ?? 0,
      recentBugReports: recentBugReports ?? [],
      userPoints,
      // Temporary/diagnostic — see the comment where this is built. Empty
      // array in the normal case; /admin only renders anything for this
      // when it's actually non-empty.
      debugErrors,
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
