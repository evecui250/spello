'use client';

import { WORDS, Word } from './words';
import { getAllProgress, getSettings, WordProgress } from './storage';

export interface PracticeItem {
  word: Word;
  progress: WordProgress;
  isNew: boolean;
}

export function buildQueue(): PracticeItem[] {
  const allProgress = getAllProgress();
  const settings = getSettings();

  const newWords: PracticeItem[] = [];
  const reviewWords: PracticeItem[] = [];

  for (const word of WORDS) {
    const progress = allProgress[word.id] ?? { id: word.id, level: -1, mastered: false, level2Count: 0 };
    if (progress.mastered) continue;
    if (progress.level === -1) {
      newWords.push({ word, progress, isNew: true });
    } else {
      reviewWords.push({ word, progress, isNew: false });
    }
  }

  const shuffled = <T>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

  return [
    ...shuffled(newWords).slice(0, settings.dailyNew),
    ...shuffled(reviewWords).slice(0, settings.dailyReview),
  ];
}

// Returns which indices of the word to blank out, given the level.
// For nouns, the "word" passed here is just the noun (without article).
export function getBlankPattern(word: string, level: number): boolean[] {
  const chars = [...word];
  // true = blank, false = shown
  if (level === 0) {
    // All blanked except 1 random letter
    const shownIdx = Math.floor(Math.random() * chars.length);
    return chars.map((_, i) => i !== shownIdx);
  }
  if (level === 1) {
    // First letter shown, rest blank
    return chars.map((_, i) => i !== 0);
  }
  // level 2: all blank
  return chars.map(() => true);
}

export function buildDisplayWord(word: string, blanks: boolean[]): string {
  return [...word].map((ch, i) => (blanks[i] ? '_' : ch)).join('');
}

export function checkAnswer(word: string, answer: string): boolean {
  // Case-insensitive for the base letters, but umlauts must be correct
  return word.toLowerCase() === answer.trim().toLowerCase();
}

export function advanceLevel(progress: WordProgress): WordProgress {
  const next = { ...progress };
  if (next.level === -1) {
    next.level = 0;
    return next;
  }
  if (next.level === 2) {
    next.level2Count += 1;
    if (next.level2Count >= 2) {
      next.mastered = true;
    }
    return next;
  }
  next.level = Math.min(next.level + 1, 2);
  return next;
}

export function dropLevel(progress: WordProgress): WordProgress {
  const next = { ...progress };
  if (next.level <= 0) {
    next.level = 0;
    return next;
  }
  next.level -= 1;
  // Reset level2Count if dropping from level 2
  if (next.level < 2) next.level2Count = 0;
  return next;
}
