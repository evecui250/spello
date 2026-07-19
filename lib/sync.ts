'use client';

import { supabase } from './supabase';
import {
  getAllProgress, saveAllProgress, WordProgress,
  getStreak, saveStreak, Streak,
  getSettings, saveSettings,
} from './storage';

interface RemoteRow {
  progress: Record<string, WordProgress>;
  streak: Streak;
  settings: ReturnType<typeof getSettings> | null;
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
    .select('progress, streak, settings')
    .eq('user_id', userId)
    .maybeSingle<RemoteRow>();

  if (error || !data) return;

  saveAllProgress(mergeProgress(getAllProgress(), data.progress ?? {}));

  const localStreak = getStreak();
  const remoteStreak = data.streak;
  if (remoteStreak && remoteStreak.lastDate > localStreak.lastDate) {
    saveStreak(remoteStreak);
  }

  if (data.settings) {
    saveSettings(data.settings);
  }
}

// Pushes the current local state up as this user's remote snapshot.
// Alongside the full `progress` blob (needed to actually restore state on
// another device), this also writes flat summary columns — streak_count,
// learning_count, mastered_count, language, level — so the row is readable
// at a glance in the Supabase table editor without expanding the JSON.
async function pushToRemote(userId: string): Promise<void> {
  const progress = getAllProgress();
  const streak = getStreak();
  const settings = getSettings();
  const values = Object.values(progress);

  await supabase.from('user_progress').upsert({
    user_id: userId,
    progress,
    streak,
    settings,
    streak_count: streak.count,
    learning_count: values.filter(p => !p.fullyMastered && p.studiedTimes >= 1).length,
    mastered_count: values.filter(p => p.fullyMastered).length,
    language: settings.language,
    level: settings.level,
    updated_at: new Date().toISOString(),
  });
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
