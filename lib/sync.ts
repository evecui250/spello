'use client';

import { supabase } from './supabase';
import {
  getActiveLevel,
  getAllProgressForLevel, saveAllProgressForLevel, WordProgress, MascotStageId,
  getStreak, saveStreak, Streak,
  getSettingsForLevel, saveSettingsForLevel, getSettingsUpdatedAtForLevel, Settings,
  getGoalDaysRecordForSync, mergeGoalDaysFromSync,
  getPartialDaysRecordForSync, mergePartialDaysFromSync,
  getDailyWordLogForSync, mergeDailyWordLogFromSync, DailyWordLog,
  getAllCustomWordsForLevel, saveAllCustomWordsForLevel,
  today,
} from './storage';
import { Level, LEVEL_ORDER, Word } from './words';
import { getOrCreateDeviceId, isLocalDev } from './telemetry';
import { migrateLocalProfileIfNeeded } from './shop';

// Each level is its own profile locally (see storage.ts) — the remote row
// mirrors that by nesting every level's progress/settings under its own key,
// so switching levels on one device and syncing never overwrites another
// level's cloud backup with the wrong profile's data. Streak (like
// goal_days) is level-independent — completing any level's daily goal
// extends the one shared streak, so it's stored flat, not nested.
type ProgressByLevel = Partial<Record<Level, Record<string, WordProgress>>>;
type SettingsByLevel = Partial<Record<Level, Settings>>;
// Learner-added vocabulary (see lib/storage.ts's custom-words section) —
// nested by level the same way progress/settings are, for the same reason.
type CustomWordsByLevel = Partial<Record<Level, Record<string, Word>>>;
// Legacy shape from before streak became global — one entry per level.
type LegacyStreakByLevel = Partial<Record<Level, Streak>>;

interface RemoteRow {
  progress: ProgressByLevel | Record<string, WordProgress> | null;
  streak: Streak | LegacyStreakByLevel | null;
  settings: SettingsByLevel | Settings | null;
  goal_days: string[] | null;
  partial_days: string[] | null;
  word_log: DailyWordLog | null;
  custom_words: CustomWordsByLevel | null;
  updated_at: string | null;
}

function isFlatStreak(s: unknown): s is Streak {
  return !!s && typeof s === 'object' && 'lastDate' in s && 'count' in s;
}

// Old rows (from before the per-level split) stored a single flat blob.
// Detect the new shape by checking that every top-level key is a known
// CEFR level; anything else (a word id, or streak's "lastDate" field, etc.)
// means it's the legacy flat shape.
const KNOWN_LEVEL_KEYS = LEVEL_ORDER as string[];
function isNestedByLevel(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).every(k => KNOWN_LEVEL_KEYS.includes(k));
}

// Earlier stage = less mature; no stage at all (still mid-introduction) ranks
// below every real stage.
const STAGE_RANK: Record<MascotStageId, number> = { puppy: 0, short: 1, medium: 2, 'long-crowned': 3 };
function stageRank(p: WordProgress): number {
  return p.mascotStage ? STAGE_RANK[p.mascotStage] : -1;
}

// Prefers whichever side is "further along" for each word, so syncing never
// loses progress made on either device. Compares by mascotStage first, not
// raw `round` — round alone isn't a reliable "further along" signal (a
// stale/legacy record can carry a mismatched round value that has nothing
// to do with actual milestones passed, which used to let a stale remote
// row silently overwrite correct local progress).
// Article mastery is a genuinely independent dimension from word mastery
// (see WordProgress's own comment) -- reconciled separately by its own
// "most recent activity wins" rule so a more recent article mistake/
// recall on the losing side of the word-mastery comparison above never
// gets silently dropped just because that side lost on stage/reviews.
function mergeArticleFields(l: WordProgress, r: WordProgress): Pick<WordProgress, 'articleMistake' | 'articleRecallStreak' | 'articleMistakeCount'> {
  const lAt = l.articleMistake?.at ?? '';
  const rAt = r.articleMistake?.at ?? '';
  const winner = rAt > lAt ? r : l;
  const count = Math.max(l.articleMistakeCount ?? 0, r.articleMistakeCount ?? 0);
  return {
    articleMistake: winner.articleMistake,
    articleRecallStreak: winner.articleRecallStreak,
    articleMistakeCount: count || undefined,
  };
}

function mergeProgress(
  local: Record<string, WordProgress>,
  remote: Record<string, WordProgress>,
): Record<string, WordProgress> {
  const merged: Record<string, WordProgress> = { ...local };
  for (const id of Object.keys(remote)) {
    const r = remote[id];
    const l = merged[id];
    if (!l) { merged[id] = r; continue; }
    const remoteIsFurther = stageRank(r) !== stageRank(l)
      ? stageRank(r) > stageRank(l)
      : r.successfulReviews !== l.successfulReviews
        ? r.successfulReviews > l.successfulReviews
        : (r.lastPracticed ?? '') > (l.lastPracticed ?? '');
    const winner = remoteIsFurther ? r : l;
    merged[id] = { ...winner, ...mergeArticleFields(l, r) };
  }
  return merged;
}

// Pulls the signed-in user's remote data and merges it into local storage —
// level by level, so a backup of one profile never bleeds into another.
// Called right after sign-in so progress from other devices shows up here.
export async function pullAndMerge(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('user_progress')
    .select('progress, streak, settings, goal_days, partial_days, word_log, custom_words, updated_at')
    .eq('user_id', userId)
    .maybeSingle<RemoteRow>();

  if (error) {
    console.error('Spello sync pull failed:', error.message);
    return;
  }
  if (!data) return;

  // Streak's own shape is checked separately from progress/settings — since
  // it's flat now instead of nested-by-level, folding it into the same
  // "nested" check would misdetect a row with perfectly normal nested
  // progress/settings as legacy-flat the moment streak stopped being nested.
  const nested = isNestedByLevel(data.progress) && isNestedByLevel(data.settings);
  // A legacy (pre-per-level-split) flat-blob row has no level of its own to
  // land on anymore now that B2_old is gone — simply not merged, rather
  // than force-fit into any current level.
  const remoteProgressByLevel: ProgressByLevel = nested ? (data.progress as ProgressByLevel) : {};
  const remoteSettingsByLevel: SettingsByLevel = nested ? ((data.settings as SettingsByLevel) ?? {}) : {};

  for (const level of LEVEL_ORDER) {
    const remoteProgress = remoteProgressByLevel[level];
    if (remoteProgress) {
      saveAllProgressForLevel(level, mergeProgress(getAllProgressForLevel(level), remoteProgress));
    }
  }

  // Whichever side's streak is further along wins outright (same "further
  // along survives" spirit as mergeProgress) — a flat Streak from the new
  // shape compares directly; a legacy per-level blob is reduced to its own
  // best (highest-count) entry first, so an old row synced before this
  // change still contributes a sensible starting point instead of being
  // silently dropped.
  const remoteStreak: Streak | null = isFlatStreak(data.streak)
    ? data.streak
    : data.streak
      ? Object.values(data.streak as LegacyStreakByLevel).reduce<Streak | null>((best, s) => (
        !s ? best : !best || s.count > best.count ? s : best
      ), null)
      : null;
  if (remoteStreak && remoteStreak.lastDate > getStreak().lastDate) {
    saveStreak(remoteStreak);
  }

  // Settings are pushed/pulled as one all-levels bundle, but the staleness
  // check is still done per level — the remote row only carries one shared
  // updated_at, but comparing it against THIS level's own local edit time
  // (not the most-recently-edited level across the whole device) means a
  // level nobody has touched on this device yet always accepts the remote
  // copy, instead of getting silently blocked by an unrelated level having
  // been edited more recently here. A level edited moments ago locally still
  // isn't clobbered, since its own updated-at wins that comparison.
  for (const level of LEVEL_ORDER) {
    const remoteSettings = remoteSettingsByLevel[level];
    if (!remoteSettings) continue;
    const localUpdatedAt = getSettingsUpdatedAtForLevel(level);
    const remoteIsNewer = !localUpdatedAt
      || (!!data.updated_at && data.updated_at > localUpdatedAt);
    if (remoteIsNewer) saveSettingsForLevel(level, remoteSettings);
  }

  // Level-independent, and never a "which side wins" comparison — a plain
  // union of both devices' completed-goal dates is always exactly correct,
  // unlike trying to compare two raw counts.
  if (Array.isArray(data.goal_days) && data.goal_days.length > 0) {
    mergeGoalDaysFromSync(data.goal_days);
  }
  if (Array.isArray(data.partial_days) && data.partial_days.length > 0) {
    mergePartialDaysFromSync(data.partial_days);
  }
  if (data.word_log && typeof data.word_log === 'object' && Object.keys(data.word_log).length > 0) {
    mergeDailyWordLogFromSync(data.word_log);
  }

  // Plain union by id, per level — unlike WordProgress there's no "further
  // along" to compare (a custom word is just user-authored data, not a
  // milestone track), and a same-id collision between devices is
  // essentially impossible anyway (ids are freshly-generated UUIDs, never
  // reused or mutated after creation — see storage.ts's newCustomWordId),
  // so remote simply fills in whatever local doesn't already have.
  const remoteCustomWordsByLevel = (data.custom_words ?? {}) as CustomWordsByLevel;
  for (const level of LEVEL_ORDER) {
    const remoteWords = remoteCustomWordsByLevel[level];
    if (!remoteWords) continue;
    saveAllCustomWordsForLevel(level, { ...remoteWords, ...getAllCustomWordsForLevel(level) });
  }
}

// Pushes every level's local state up as this user's remote snapshot —
// progress/settings nested by level (see ProgressByLevel/SettingsByLevel
// above) so each profile keeps its own separate cloud backup; streak and
// goal_days are flat/global, shared across every level. Alongside the full
// `progress` blob (needed to actually restore state on another device),
// this also tries to write flat summary columns — streak_count,
// learning_count, mastered_count, language, level — describing the
// *currently active* level/profile, so the row is readable at a glance in
// the Supabase table editor without expanding the JSON. Those columns are
// optional (added via a follow-up ALTER TABLE); if they don't exist yet,
// Postgres rejects the whole upsert, so this falls back to the core
// payload rather than silently failing to sync at all.
async function pushToRemote(userId: string): Promise<void> {
  const progress: ProgressByLevel = {};
  const settings: SettingsByLevel = {};
  const customWords: CustomWordsByLevel = {};
  for (const level of LEVEL_ORDER) {
    const p = getAllProgressForLevel(level);
    if (Object.keys(p).length > 0) progress[level] = p;
    settings[level] = getSettingsForLevel(level);
    const cw = getAllCustomWordsForLevel(level);
    if (Object.keys(cw).length > 0) customWords[level] = cw;
  }
  const streak = getStreak();
  const activeLevel = getActiveLevel();
  const activeSettings = settings[activeLevel];
  const allValues = Object.values(progress).flatMap(p => Object.values(p));

  // `level` lives in corePayload itself (not just the flat-summary spread
  // below) specifically so the fallback retry still writes it — confirmed
  // real: a handful of accounts showed up as "unknown" level in /admin
  // because a failed first attempt fell back to corePayload alone, which
  // never included it, silently leaving the column null on that account's
  // very first (INSERT, not UPDATE) row. streak_count/learning_count/
  // mastered_count/language stay first-attempt-only below — level is a
  // plain, always-valid string with none of the "column might not exist
  // yet" risk those were originally guarding against.
  const corePayload = {
    user_id: userId,
    progress,
    streak,
    settings,
    goal_days: getGoalDaysRecordForSync(),
    partial_days: getPartialDaysRecordForSync(),
    word_log: getDailyWordLogForSync(),
    custom_words: customWords,
    updated_at: new Date().toISOString(),
    level: activeLevel,
  };

  // Explicit onConflict: without it, upsert falls back to the table's
  // primary key for conflict detection — if that's ever a separate id
  // column rather than user_id itself, every "upsert" would silently
  // INSERT a new row instead of replacing this user's existing one,
  // leaving stale duplicate rows that a later .maybeSingle() pull can
  // then trip over.
  const { error } = await supabase.from('user_progress').upsert({
    ...corePayload,
    streak_count: streak.count,
    learning_count: allValues.filter(p => !p.fullyMastered && p.studiedTimes >= 1).length,
    mastered_count: allValues.filter(p => p.fullyMastered).length,
    language: activeSettings?.language,
  }, { onConflict: 'user_id' });

  if (error) {
    const retry = await supabase.from('user_progress').upsert(corePayload, { onConflict: 'user_id' });
    if (retry.error) {
      console.error('Spello sync failed:', retry.error.message);
    }
  }

  // Best-effort, separate from the main sync above and never allowed to
  // affect it either way — a failure here just means today's row in
  // /admin's trend/leaderboard is briefly stale, never a lost-progress
  // bug. See the daily_activity migration for why this can't just be
  // read off user_progress: that table is a snapshot overwritten on every
  // sync, so it has no day-by-day history at all — this is the only place
  // that accumulates one, and only from whenever this shipped forward.
  // lastPracticed/lastReviewedAt (used below) are per-word "most recent
  // touch" dates, not a log either — but comparing them against today()
  // (this device's own local date, same convention telemetry.ts already
  // uses) is exact for TODAY specifically, since nothing later in the day
  // can have already overwritten it by the time this runs.
  try {
    const t = today();
    await supabase.from('daily_activity').upsert({
      user_id: userId,
      activity_date: t,
      words_studied: allValues.filter(p => p.lastPracticed === t).length,
      words_mastered: allValues.filter(p => p.fullyMastered && p.lastReviewedAt === t).length,
      level: activeLevel,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,activity_date' });
  } catch {
    // Silent — see comment above.
  }
}

// Anonymous counterpart to the daily_activity upsert inside pushToRemote
// above — same words_studied/words_mastered computation (merged across
// every level's own progress, same as that function), just keyed by
// device_id instead of a signed-in user_id, since that's the only
// identity an anonymous learner has (see lib/telemetry.ts). Routed through
// the record-anon-activity Edge Function (service role) rather than a
// direct table write — daily_activity_anon has no client policies at all,
// same lockdown as usage_pings. Best-effort and silent, exactly like the
// daily_activity upsert it mirrors: this is a stats-only side channel,
// never something that should affect (or be affected by) real study flow.
async function pushAnonActivity(): Promise<void> {
  if (isLocalDev()) return;
  try {
    const activeLevel = getActiveLevel();
    const allValues = LEVEL_ORDER.flatMap(level => Object.values(getAllProgressForLevel(level)));
    const t = today();
    await supabase.functions.invoke('record-anon-activity', {
      body: {
        deviceId: getOrCreateDeviceId(),
        activityDate: t,
        wordsStudied: allValues.filter(p => p.lastPracticed === t).length,
        wordsMastered: allValues.filter(p => p.fullyMastered && p.lastReviewedAt === t).length,
        level: activeLevel,
      },
    });
  } catch {
    // Silent — see comment above.
  }
}

// Immediate (non-debounced) push, awaited — for actions where the caller
// needs to know the upload actually went out before doing anything else
// (e.g. clearing progress: without this, the debounced scheduleSync's
// timer could still be pending if the tab closes/navigates away in an
// environment where the pagehide/visibilitychange flush doesn't fire,
// leaving the now-cleared local state never actually overwriting remote —
// so a later pull silently resurrects the "removed" progress).
export async function syncNow(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return false;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  await pushToRemote(userId);
  return true;
}

// The event fired on window once a signed-in pull-and-merge finishes, so
// any already-mounted page can pick up the freshly merged data instead of
// only ever seeing whatever was in local storage at its own mount time.
export const SYNCED_EVENT = 'spello:synced';

// Subscribes to auth state and pulls+merges remote progress whenever a
// session becomes available — on initial load AND right after sign-in.
// Meant to be mounted once, globally (see components/SyncGate.tsx), so
// every page benefits regardless of which one the user lands on first;
// previously this only ran on Settings, since AccountPanel was the only
// thing wired to it, leaving Home stuck showing stale/empty local data
// until the user happened to visit Settings.
export function watchAuthAndSync(): () => void {
  const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
      pullAndMerge(session.user.id).then(() => {
        window.dispatchEvent(new Event(SYNCED_EVENT));
      });
    }
    // Only on a genuine fresh sign-in, not every reload of an
    // already-authenticated session — see migrateLocalProfileIfNeeded's
    // own header comment for why INITIAL_SESSION would run this too often.
    if (session?.user && event === 'SIGNED_IN') {
      migrateLocalProfileIfNeeded();
    }
  });

  // A tab/app left open for a while never re-pulls on its own otherwise —
  // pullAndMerge only ever ran once, at that tab's own launch. Re-pulling
  // on refocus (switching back from another app, or from a different
  // device's tab) is what actually makes a change made elsewhere show up
  // here without needing a full reload — mergeProgress's "further along
  // wins" comparison already makes this safe to call anytime.
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible') return;
    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id;
      if (!userId) return;
      pullAndMerge(userId).then(() => {
        window.dispatchEvent(new Event(SYNCED_EVENT));
      });
    });
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    sub.subscription.unsubscribe();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUserId: string | null = null;
let anonActivityTimer: ReturnType<typeof setTimeout> | null = null;

// Debounced just enough to coalesce a rapid string of edits (e.g. dragging a
// pace slider) into one push, not so long that closing/backgrounding the
// tab shortly after a change has much chance of losing it before it fires —
// watchForUnloadFlush covers most of that gap already, but shrinking the
// window itself is the more reliable half of the fix (those unload events
// aren't 100% guaranteed to fire on every mobile browser/PWA).
const SYNC_DEBOUNCE_MS = 500;

// Call after any local mutation. Debounced and a no-op when signed out, so
// it's safe to sprinkle after every save without worrying about network cost.
export function scheduleSync(): void {
  if (typeof window === 'undefined') return;
  supabase.auth.getSession().then(({ data }) => {
    const userId = data.session?.user.id;
    if (!userId) {
      // No account to sync real progress to, but still worth a lightweight
      // activity ping (see pushAnonActivity) so anonymous usage shows up in
      // /admin too — same debounce window/timer as the signed-in path,
      // just a different (much smaller) payload.
      if (anonActivityTimer) clearTimeout(anonActivityTimer);
      anonActivityTimer = setTimeout(() => {
        anonActivityTimer = null;
        pushAnonActivity();
      }, SYNC_DEBOUNCE_MS);
      return;
    }
    pendingUserId = userId;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushToRemote(userId);
    }, SYNC_DEBOUNCE_MS);
  });
}

// Pushes a still-pending debounced sync immediately instead of waiting out
// the rest of the 1.5s window — see watchForUnloadFlush, which calls this
// right before the page is hidden/closed. Without this, finishing a session
// and then quickly closing the tab/app (very common, especially on mobile)
// could drop that session's progress from ever reaching the cloud, since the
// debounce timer never gets to fire.
function flushPendingSync(): void {
  if (!pushTimer || !pendingUserId) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  pushToRemote(pendingUserId);
}

// Mounted once, globally (see SyncGate) — flushes any pending sync as soon
// as the page is backgrounded or unloaded, rather than only on whatever's
// left of the debounce timer. 'visibilitychange' catches the common mobile
// case (switching apps) while the page is still briefly alive in the
// background; 'pagehide' catches an outright close/navigation.
export function watchForUnloadFlush(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onVisibilityChange = () => { if (document.hidden) flushPendingSync(); };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', flushPendingSync);
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', flushPendingSync);
  };
}
