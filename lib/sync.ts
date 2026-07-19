'use client';

import { supabase } from './supabase';
import {
  getAllProgress, saveAllProgress, WordProgress,
  getStreak, saveStreak, Streak,
  getSettings, saveSettings, getSettingsUpdatedAt,
} from './storage';

interface RemoteRow {
  progress: Record<string, WordProgress>;
  streak: Streak;
  settings: ReturnType<typeof getSettings> | null;
  updated_at: string | null;
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

// Pulls the signed-in user's remote data and merges it into local storage.
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

  saveAllProgress(mergeProgress(getAllProgress(), data.progress ?? {}));

  const localStreak = getStreak();
  const remoteStreak = data.streak;
  if (remoteStreak && remoteStreak.lastDate > localStreak.lastDate) {
    saveStreak(remoteStreak);
  }

  // Only apply remote settings if they're actually newer than this device's
  // last local edit — otherwise a pull (which runs on every page load while
  // signed in) can clobber a change made moments ago that hasn't pushed yet.
  const localSettingsUpdatedAt = getSettingsUpdatedAt();
  const remoteIsNewer = !localSettingsUpdatedAt
    || (!!data.updated_at && data.updated_at > localSettingsUpdatedAt);
  if (data.settings && remoteIsNewer) {
    saveSettings(data.settings);
  }
}

// Pushes the current local state up as this user's remote snapshot.
// Alongside the full `progress` blob (needed to actually restore state on
// another device), this also tries to write flat summary columns —
// streak_count, learning_count, mastered_count, language, level — so the
// row is readable at a glance in the Supabase table editor without
// expanding the JSON. Those columns are optional (added via a follow-up
// ALTER TABLE); if they don't exist yet, Postgres rejects the whole upsert,
// so this falls back to the core payload rather than silently failing to
// sync at all.
async function pushToRemote(userId: string): Promise<void> {
  const progress = getAllProgress();
  const streak = getStreak();
  const settings = getSettings();
  const values = Object.values(progress);

  const corePayload = {
    user_id: userId,
    progress,
    streak,
    settings,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('user_progress').upsert({
    ...corePayload,
    streak_count: streak.count,
    learning_count: values.filter(p => !p.fullyMastered && p.studiedTimes >= 1).length,
    mastered_count: values.filter(p => p.fullyMastered).length,
    language: settings.language,
    level: settings.level,
  });

  if (error) {
    const retry = await supabase.from('user_progress').upsert(corePayload);
    if (retry.error) {
      console.error('Spello sync failed:', retry.error.message);
    }
  }
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
