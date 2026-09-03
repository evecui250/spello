// Public (no auth) weekly/monthly points leaderboard for the Progress
// page — see components/Leaderboard.tsx. Points = 1 per unique word
// studied per day (daily_activity.words_studied, any SRS stage) + 1 per
// Word Match game played (game_plays), capped per calendar day (see
// GAME_PLAY_DAILY_POINT_CAP below — kept in sync with lib/shop.ts's own
// copy and get-my-profile/buy-accessory's, no shared module exists in
// this codebase to import it from instead).
//
// Deployed --no-verify-jwt, same reasoning as record-anon-activity:
// signed-out visitors can view the leaderboard (a soft sign-up nudge),
// even though only signed-in users ever appear ON it.
//
// Reads with the service-role key (bypasses RLS) since this deliberately
// needs everyone's daily_activity/game_plays/profiles rows, not just a
// caller's own — same "separate service-role client, aggregate in plain
// JS" pattern as admin-stats, which this function's shape closely
// mirrors (see its own leaderboardToday).
//
// SECURITY: this response must NEVER contain a real email address — any
// caller, signed in or not, can read this JSON directly. A user with no
// nickname set is masked server-side, here, before the response is
// built; the real email is never serialized.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const GAME_PLAY_DAILY_POINT_CAP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
// Comfortably covers both "1st of this month" and "Monday of this week"
// even right at a month boundary (a week can start in the previous
// month), without needing two separate queries.
const FETCH_WINDOW_DAYS = 40;

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Monday on/before `d`, UTC, as YYYY-MM-DD. getUTCDay() is 0=Sun..6=Sat.
function mondayOfWeek(d: Date): string {
  const dow = d.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  return dateStr(new Date(d.getTime() - diff * DAY_MS));
}

function firstOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Shows the first 2 letters (not just 1) so people can at least
// recognize their own or a friend's entry — still nowhere near enough to
// identify a stranger from it.
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const localMasked = `${local?.slice(0, 2) ?? '??'}•••`;
  const domainMasked = `•••${domain?.slice(-4) ?? ''}`;
  return `${localMasked}@${domainMasked}`;
}

interface LeaderboardEntry {
  // Safe to expose publicly -- an opaque UUID, not PII -- so the client
  // can highlight "you" by exact ID match rather than a fragile
  // string-compare against its own locally-computed display name (which
  // could collide with someone else's mask by coincidence).
  userId: string;
  displayName: string;
  avatarId: string;
  points: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date();
    const todayStr = dateStr(now);
    const weekStart = mondayOfWeek(now);
    const monthStart = firstOfMonth(now);
    const fetchStart = dateStr(new Date(now.getTime() - FETCH_WINDOW_DAYS * DAY_MS));

    const [{ data: activityRows }, { data: gameRows }, { data: profileRows }, { data: usersData }] = await Promise.all([
      admin.from('daily_activity').select('user_id, activity_date, words_studied').gte('activity_date', fetchStart),
      admin.from('game_plays').select('user_id, created_at').not('user_id', 'is', null).gte('created_at', new Date(now.getTime() - FETCH_WINDOW_DAYS * DAY_MS).toISOString()),
      admin.from('profiles').select('user_id, nickname, avatar_id, leaderboard_opt_out'),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const profileByUserId = new Map((profileRows ?? []).map(p => [p.user_id, p]));
    const emailByUserId = new Map((usersData?.users ?? []).map(u => [u.id, u.email ?? null]));

    // One combined per-user, per-day points map: daily_activity's
    // words_studied plus game_plays counted per day and capped there.
    const gamesByUserDay = new Map<string, Map<string, number>>();
    for (const row of gameRows ?? []) {
      const uid = row.user_id as string;
      const day = dateStr(new Date(row.created_at));
      const byDay = gamesByUserDay.get(uid) ?? new Map<string, number>();
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      gamesByUserDay.set(uid, byDay);
    }

    const pointsByUserDay = new Map<string, Map<string, number>>();
    for (const row of activityRows ?? []) {
      const uid = row.user_id as string;
      const byDay = pointsByUserDay.get(uid) ?? new Map<string, number>();
      byDay.set(row.activity_date, (byDay.get(row.activity_date) ?? 0) + (row.words_studied ?? 0));
      pointsByUserDay.set(uid, byDay);
    }
    for (const [uid, byDay] of gamesByUserDay) {
      const merged = pointsByUserDay.get(uid) ?? new Map<string, number>();
      for (const [day, count] of byDay) {
        const capped = Math.min(count, GAME_PLAY_DAILY_POINT_CAP);
        merged.set(day, (merged.get(day) ?? 0) + capped);
      }
      pointsByUserDay.set(uid, merged);
    }

    function buildWindow(windowStart: string): LeaderboardEntry[] {
      const totals: { userId: string; points: number; lastDay: string }[] = [];
      for (const [uid, byDay] of pointsByUserDay) {
        if (profileByUserId.get(uid)?.leaderboard_opt_out) continue;
        let points = 0;
        let lastDay = '';
        for (const [day, dayPoints] of byDay) {
          if (day < windowStart || day > todayStr) continue;
          points += dayPoints;
          if (dayPoints > 0 && day > lastDay) lastDay = day;
        }
        if (points > 0) totals.push({ userId: uid, points, lastDay });
      }
      totals.sort((a, b) => b.points - a.points || (a.lastDay < b.lastDay ? -1 : a.lastDay > b.lastDay ? 1 : (a.userId < b.userId ? -1 : 1)));
      return totals.slice(0, 3).map(t => {
        const profile = profileByUserId.get(t.userId);
        const email = emailByUserId.get(t.userId);
        const displayName = profile?.nickname || (email ? maskEmail(email) : 'Anonymous');
        return { userId: t.userId, displayName, avatarId: profile?.avatar_id || 'dachshund', points: t.points };
      });
    }

    return json({ week: buildWindow(weekStart), month: buildWindow(monthStart) });
  } catch (err) {
    console.error('get-leaderboard error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
