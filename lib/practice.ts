'use client';

import { WORDS, Word } from './words';
import { getAllProgress, getSettings, WordProgress } from './storage';

export function buildSessionWords(): Word[] {
  const allProgress = getAllProgress();
  const settings = getSettings();

  const shuffled = <T>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

  const newWords: Word[] = [];
  const reviewWords: Word[] = [];

  for (const word of WORDS) {
    const p = allProgress[word.id];
    if (p?.mastered) continue;
    if (!p) newWords.push(word);
    else reviewWords.push(word);
  }

  return [
    ...shuffled(newWords).slice(0, settings.dailyNew),
    ...shuffled(reviewWords).slice(0, settings.dailyReview),
  ];
}

// Returns hint pattern: true = blank (hidden), false = show the letter.
// Round 0: 1 random letter revealed. Round 1: first letter. Round 2: all blank.
export function generateHint(word: string, round: 0 | 1 | 2): boolean[] {
  const n = [...word].length;
  if (round === 0) {
    const idx = Math.floor(Math.random() * n);
    return Array.from({ length: n }, (_, i) => i !== idx);
  }
  if (round === 1) {
    return Array.from({ length: n }, (_, i) => i !== 0);
  }
  return Array.from({ length: n }, () => true);
}

export function checkAnswer(word: string, answer: string): boolean {
  return word.toLowerCase() === answer.trim().toLowerCase();
}

// Wrong answer → no level change. Correct → advance stored level for this round.
export function applyResult(
  progress: WordProgress,
  round: 0 | 1 | 2,
  correct: boolean,
): WordProgress {
  const today = new Date().toISOString().slice(0, 10);
  if (!correct) return { ...progress, lastPracticed: today };
  const next = { ...progress, lastPracticed: today };
  if (round === 0 && next.level < 1) next.level = 1;
  if (round === 1 && next.level < 2) next.level = 2;
  if (round === 2) {
    next.level2Count = (next.level2Count ?? 0) + 1;
    if (next.level2Count >= 2) next.mastered = true;
  }
  return next;
}
