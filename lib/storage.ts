'use client';

export interface WordProgress {
  id: string;
  level: number;       // -1 = beginning (never seen), 0, 1, 2
  mastered: boolean;
  level2Count: number; // correct answers at level 2; needs 2 to master
  lastPracticed?: string;
}

export interface Streak {
  lastDate: string;
  count: number;
}

export interface Settings {
  dailyNew: number;
  dailyReview: number;
}

export interface SessionProgress {
  date: string;
  total: number;
  done: number;
}

const KEYS = {
  progress: 'wb2_progress',
  streak: 'wb2_streak',
  settings: 'wb2_settings',
  session: (date: string) => `wb2_session_${date}`,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- Progress ---

export function getAllProgress(): Record<string, WordProgress> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(KEYS.progress) || '{}');
  } catch {
    return {};
  }
}

export function saveAllProgress(data: Record<string, WordProgress>): void {
  localStorage.setItem(KEYS.progress, JSON.stringify(data));
}

export function getWordProgress(id: string): WordProgress {
  const all = getAllProgress();
  return all[id] ?? { id, level: -1, mastered: false, level2Count: 0 };
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
  localStorage.setItem(KEYS.streak, JSON.stringify({ lastDate: t, count: newCount }));
}

// --- Settings ---

export function getSettings(): Settings {
  if (typeof window === 'undefined') return { dailyNew: 10, dailyReview: 20 };
  try {
    return JSON.parse(localStorage.getItem(KEYS.settings) || '{"dailyNew":10,"dailyReview":20}');
  } catch {
    return { dailyNew: 10, dailyReview: 20 };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
}

// --- Session ---

export function getSession(): SessionProgress {
  if (typeof window === 'undefined') return { date: today(), total: 0, done: 0 };
  const t = today();
  try {
    const raw = localStorage.getItem(KEYS.session(t));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { date: t, total: 0, done: 0 };
}

export function saveSession(s: SessionProgress): void {
  localStorage.setItem(KEYS.session(s.date), JSON.stringify(s));
}
