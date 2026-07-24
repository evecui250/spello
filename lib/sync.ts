'use client';

import { supabase } from './supabase';
import {
  getActiveLevel,
  getAllProgressForLevel, saveAllProgressForLevel, WordProgress,
  getStreakForLevel, saveStreakForLevel, Streak,
  getSettingsForLevel, saveSettingsForLevel, getMostRecentSettingsUpdatedAt, Settings,
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

  // Settings are pushed/pulled as one all-levels bundle, so the staleness
  // check is against the most recently edited level on this device, not any
  // one level in particular — otherwise a pull (which runs on every page
  // load while signed in) could clobber a change made moments ago on
  // whichever level wasn't currently active.
  const localSettingsUpdatedAt = getMostRecentSettingsUpdatedAt();
  const remoteIsNewer = !localSettingsUpdatedAt
    || (!!data.updated_at && data.updated_at > localSettingsUpdatedAt);
  if (remoteIsNewer) {
    for (const level of LEVEL_ORDER) {
      const remoteSettings = remoteSettingsByLevel[level];
      if (remoteSettings) saveSettingsForLevel(level, remoteSettings);
    }
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

// Call after any local mutation. Debounced and a no-op when signed out, so
// it's safe to sprinkle after every save without worrying about network cost.
export function scheduleSync(): void {
  if (typeof window === 'undefined') return;
  supabase.auth.getSession().then(({ data }) => {
    const userId = data.session?.user.id;
    if (!userId) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => pushToRemote(userId), 1500);
  });
}
