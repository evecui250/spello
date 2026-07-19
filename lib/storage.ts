'use client';

export type Round = 1 | 2 | 3 | 4 | 5;
export const MAX_ROUND: Round = 5;

export interface WordProgress {
  id: string;
  round: Round;        // current difficulty level, 1 (copy word) .. 5 (no hints)
  studiedTimes: number; // number of times round 5 has been passed; reaching masteryThreshold = fully mastered
  fullyMastered: boolean;
  lastPracticed?: string;
}

export interface Streak {
  lastDate: string;
  count: number;
}

export interface Settings {
  studyBatchSize: number;
  dailyReview: number;
  masteryThreshold: number;
  language: string;
  level: string;
  autoPlayAudio: boolean;
}

const KEYS = {
  progress: 'wb2_progress',
  streak: 'wb2_streak',
  settings: 'wb2_settings',
  studyDone: 'wb2_study_done',
  studyBatch: 'wb2_study_batch',
};

const EXTRA_STUDY_KEY = 'wb2_extra_study_limit';

const DEFAULT_SETTINGS: Settings = {
  studyBatchSize: 10, dailyReview: 20, masteryThreshold: 5, language: 'de', level: 'B2',
  autoPlayAudio: true,
};

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- Progress ---

export function getAllProgress(): Record<string, WordProgress> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS.progress) || '{}');
    const normalized: Record<string, WordProgress> = {};
    for (const id of Object.keys(raw)) {
      normalized[id] = normalizeProgress(id, raw[id]);
    }
    return normalized;
  } catch {
    return {};
  }
}

// Fills in defaults for any progress record saved under the old schema.
function normalizeProgress(id: string, p: Partial<WordProgress> | undefined): WordProgress {
  return {
    id,
    round: (p?.round as Round) ?? 1,
    studiedTimes: p?.studiedTimes ?? 0,
    fullyMastered: p?.fullyMastered ?? false,
    lastPracticed: p?.lastPracticed,
  };
}

export function saveAllProgress(data: Record<string, WordProgress>): void {
  localStorage.setItem(KEYS.progress, JSON.stringify(data));
}

export function getWordProgress(id: string): WordProgress {
  const all = getAllProgress();
  return all[id] ?? normalizeProgress(id, undefined);
}

export function saveWordProgress(p: WordProgress): void {
  const all = getAllProgress();
  all[p.id] = p;
  saveAllProgress(all);
}

// --- Streak ---

export function getStreak(): Streak {
  if (typeof window === 'undefined') return { lastDate: '', count: 0 };
  try {
    return JSON.parse(localStorage.getItem(KEYS.streak) || '{"lastDate":"","count":0}');
  } catch {
    return { lastDate: '', count: 0 };
  }
}

export function touchStreak(): void {
  const t = today();
  const s = getStreak();
  if (s.lastDate === t) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const newCount = s.lastDate === yesterday ? s.count + 1 : 1;
  saveStreak({ lastDate: t, count: newCount });
}

export function saveStreak(s: Streak): void {
  localStorage.setItem(KEYS.streak, JSON.stringify(s));
}

// --- Settings ---

export function getSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS.settings) || 'null');
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
}

// --- Daily study goal ---

// Whether the user has completed a full study session today (their daily goal).
export function isStudyGoalDoneToday(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS.studyDone) || '{"date":""}');
    return raw.date === today();
  } catch {
    return false;
  }
}

export function markStudyGoalDone(): void {
  localStorage.setItem(KEYS.studyDone, JSON.stringify({ date: today() }));
}

// --- Today's study batch ---
// The fixed set of word ids pulled for today's primary study goal, so
// navigating away and back resumes the same batch instead of drawing a new
// random one. Naturally invalidated once the date rolls over.

export function getTodayStudyBatch(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS.studyBatch) || 'null');
    if (raw && raw.date === today() && Array.isArray(raw.wordIds)) return raw.wordIds;
    return null;
  } catch {
    return null;
  }
}

export function saveTodayStudyBatch(wordIds: string[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.studyBatch, JSON.stringify({ date: today(), wordIds }));
}

// A one-shot "study N extra words" request from the Home page, consumed by
// the next study session. Session-scoped so a stale value can't linger.
export function setExtraStudyLimit(n: number): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(EXTRA_STUDY_KEY, String(n));
}

export function takeExtraStudyLimit(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(EXTRA_STUDY_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(EXTRA_STUDY_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// --- Reset ---

export function clearAllProgress(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEYS.progress);
  localStorage.removeItem(KEYS.streak);
  localStorage.removeItem(KEYS.studyDone);
  localStorage.removeItem(KEYS.studyBatch);
}
