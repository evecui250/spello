'use client';

import { supabase } from './supabase';
import {
  getActiveLevel,
  getAllProgressForLevel, saveAllProgressForLevel, WordProgress,
  getStreakForLevel, saveStreakForLevel, Streak,
  getSettingsForLevel, saveSettingsForLevel, getSettingsUpdatedAtForLevel, Settings,
} from './storage';
import { Level, LEVEL_ORDER } from './words';

// Each level is its own profile locally (see storage.ts) — the remote row
// mirrors that by nesting every level's progress/streak/settings under its
// own key, so switching levels on one device and syncing never overwrites
// another level's cloud backup with the wrong profile's data.
type ProgressByLevel = Partial<Record<Level, Record<string, WordProgress>>>;
type StreakByLevel = Partial<Record<Level, Streak>>;
type SettingsByLevel = Partial<Record<Level, Settings>>;

interface RemoteRow {
  progress: ProgressByLevel | Record<string, WordProgress> | null;
  streak: StreakByLevel | Streak | null;
  settings: SettingsByLevel | Settings | null;
  updated_at: string | null;
}

// Old rows (from before the per-level split) stored a single flat blob that
// was always implicitly the original B2 import. Detect the new shape by
// checking that every top-level key is a known CEFR level; anything else (a
// word id, or streak's "lastDate" field, etc.) means it's the legacy flat
// shape. 'B2' (its own pre-rename key, back when 'B2_old' was still called
// 'B2') is accepted here too, purely for recognition — renameB2Key fixes it
// up to 'B2_old' once a row is confirmed nested.
const KNOWN_LEVEL_KEYS = [...LEVEL_ORDER, 'B2'] as string[];
function isNestedByLevel(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).every(k => KNOWN_LEVEL_KEYS.includes(k));
}

// Remaps a nested-by-level object's old 'B2' key (from before the source PDF
// was found to be wrong and it was renamed to 'B2_old') to 'B2_old', so a
// remote row synced before this rename still lands in the right profile.
function renameB2Key<T>(obj: Partial<Record<string, T>>): Partial<Record<Level, T>> {
  const out: Partial<Record<Level, T>> = { ...(obj as Partial<Record<Level, T>>) };
  const legacy = (obj as Record<string, T>)['B2'];
  if (legacy !== undefined && out.B2_old === undefined) {
    out.B2_old = legacy;
  }
  delete (out as Record<string, T>)['B2'];
  return out;
}

// Prefers whichever side is "further along" for each word, so syncing never
// loses progress made on either device.
function mergeProgress(
  local: Record<string, WordProgress>,
  remote: Record<string, WordProgress>,
): Record<string, WordProgress> {
  const merged: Record<string, WordProgress> = { ...local };
  for (const id of Object.keys(remote)) {
    const r = remote[id];
    const l = merged[id];
    if (!l) { merged[id] = r; continue; }
    const remoteIsFurther = r.round !== l.round
      ? r.round > l.round
      : r.studiedTimes !== l.studiedTimes
        ? r.studiedTimes > l.studiedTimes
        : (r.lastPracticed ?? '') > (l.lastPracticed ?? '');
    if (remoteIsFurther) merged[id] = r;
  }
  return merged;
}

// Pulls the signed-in user's remote data and merges it into local storage —
// level by level, so a backup of one profile never bleeds into another.
// Called right after sign-in so progress from other devices shows up here.
export async function pullAndMerge(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('user_progress')
    .select('progress, streak, settings, updated_at')
    .eq('user_id', userId)
    .maybeSingle<RemoteRow>();

  if (error) {
    console.error('Spello sync pull failed:', error.message);
    return;
  }
  if (!data) return;

  const nested = isNestedByLevel(data.progress) && isNestedByLevel(data.streak);
  // Legacy rows (pre-per-level split) stored one flat blob that was always
  // implicitly the original B2 import — read it as B2_old rather than
  // dropping it.
  const remoteProgressByLevel: ProgressByLevel = nested
    ? renameB2Key(data.progress as ProgressByLevel)
    : { B2_old: (data.progress as Record<string, WordProgress>) ?? {} };
  const remoteStreakByLevel: StreakByLevel = nested
    ? renameB2Key(data.streak as StreakByLevel)
    : { B2_old: data.streak as Streak };
  const remoteSettingsByLevel: SettingsByLevel = nested
    ? renameB2Key((data.settings as SettingsByLevel) ?? {})
    : { B2_old: data.settings as Settings };

  for (const level of LEVEL_ORDER) {
    const remoteProgress = remoteProgressByLevel[level];
    if (remoteProgress) {
      saveAllProgressForLevel(level, mergeProgress(getAllProgressForLevel(level), remoteProgress));
    }
    const remoteStreak = remoteStreakByLevel[level];
    if (remoteStreak && remoteStreak.lastDate > getStreakForLevel(level).lastDate) {
      saveStreakForLevel(level, remoteStreak);
    }
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
}

// Pushes every level's local state up as this user's remote snapshot, nested
// by level (see ProgressByLevel/StreakByLevel/SettingsByLevel above) so each
// profile keeps its own separate cloud backup. Alongside the full `progress`
// blob (needed to actually restore state on another device), this also
// tries to write flat summary columns — streak_count, learning_count,
// mastered_count, language, level — describing the *currently active*
// level/profile, so the row is readable at a glance in the Supabase table
// editor without expanding the JSON. Those columns are optional (added via a
// follow-up ALTER TABLE); if they don't exist yet, Postgres rejects the
// whole upsert, so this falls back to the core payload rather than silently
// failing to sync at all.
async function pushToRemote(userId: string): Promise<void> {
  const progress: ProgressByLevel = {};
  const streak: StreakByLevel = {};
  const settings: SettingsByLevel = {};
  for (const level of LEVEL_ORDER) {
    const p = getAllProgressForLevel(level);
    if (Object.keys(p).length > 0) progress[level] = p;
    const s = getStreakForLevel(level);
    if (s.lastDate) streak[level] = s;
    settings[level] = getSettingsForLevel(level);
  }

  const corePayload = {
    user_id: userId,
    progress,
    streak,
    settings,
    updated_at: new Date().toISOString(),
  };

  const activeLevel = getActiveLevel();
  const activeStreak = streak[activeLevel] ?? { lastDate: '', count: 0 };
  const activeSettings = settings[activeLevel];
  const allValues = Object.values(progress).flatMap(p => Object.values(p));

  const { error } = await supabase.from('user_progress').upsert({
    ...corePayload,
    streak_count: activeStreak.count,
    learning_count: allValues.filter(p => !p.fullyMastered && p.studiedTimes >= 1).length,
    mastered_count: allValues.filter(p => p.fullyMastered).length,
    language: activeSettings?.language,
    level: activeLevel,
  });

  if (error) {
    const retry = await supabase.from('user_progress').upsert(corePayload);
    if (retry.error) {
      console.error('Spello sync failed:', retry.error.message);
    }
  }
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
  });
  return () => sub.subscription.unsubscribe();
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingUserId: string | null = null;

// Call after any local mutation. Debounced and a no-op when signed out, so
// it's safe to sprinkle after every save without worrying about network cost.
export function scheduleSync(): void {
  if (typeof window === 'undefined') return;
  supabase.auth.getSession().then(({ data }) => {
    const userId = data.session?.user.id;
    if (!userId) return;
    pendingUserId = userId;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      pushToRemote(userId);
    }, 1500);
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
