'use client';

import { MascotStageId, WordProgress, today } from './storage';

// ============================================================================
// Mastery Score (M) — scheduling only
//
//   M = (S * 1.5) + log2(daysElapsed + 1) - (2 * mistakes),  floored at 0
//
//   S           = total successful no-hint (round 4) passes
//   daysElapsed  = calendar days since the word was last successfully reviewed
//   mistakes     = failed attempts since that last success
//
// This drives review scheduling (getNextReviewInterval) only. It can dip
// after a mistake — that's fine, it just means "review this again sooner."
// It does NOT drive the mascot or retirement anymore; see growthScore below.
// ============================================================================
export function calculateMasteryScore(
  successfulReviews: number,
  daysElapsed: number,
  mistakes: number,
): number {
  const raw = successfulReviews * 1.5 + Math.log2(daysElapsed + 1) - 2 * mistakes;
  return Math.max(0, raw);
}

// Interval doubles with mastery — 2^M days — clamped to [1, 120].
export function getNextReviewInterval(masteryScore: number): number {
  const days = Math.round(2 ** masteryScore);
  return Math.min(120, Math.max(1, days));
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00Z`).getTime();
  const to = new Date(`${toStr}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86400000));
}

// ============================================================================
// Growth Score (M') — drives the mascot and retirement
//
// Monotonic: it only ever increases. A successful round-4 pass adds an
// increment that's full value if the pass was clean (no mistake since the
// last success), and smaller the more mistakes preceded it — so a forgotten
// word climbs slower, but a mistake never erases progress already earned.
//
//   increment = 1.5 / (1 + mistakesSincePreviousSuccess * 0.5)
//
// Clean pass -> +1.5. One mistake first -> +1.0. Two -> +0.75. Etc.
// ============================================================================
const GROWTH_INCREMENT_BASE = 1.5;
const GROWTH_MISTAKE_DECAY = 0.5;

export function calculateGrowthIncrement(pendingMistakes: number): number {
  return GROWTH_INCREMENT_BASE / (1 + pendingMistakes * GROWTH_MISTAKE_DECAY);
}

// ============================================================================
// Mascot stages — thresholds on growthScore. A clean word lands exactly on
// a new stage with each successful pass: pass 1 -> Puppy (1.5), pass 2 ->
// Short (3.0), pass 3 -> Medium (4.5), pass 4 -> Mastered (6.0).
// ============================================================================
export interface MascotStageInfo {
  id: MascotStageId;
  name: string;
  visualKey: string;  // for a future UI layer to map to actual artwork
  isMastered: boolean;
  minScore: number;
}

export const MASTERY_GROWTH_THRESHOLD = 6.0;

export const MASCOT_STAGES: MascotStageInfo[] = [
  { id: 'puppy', name: 'Puppy Dachshund', visualKey: 'mascot-puppy', isMastered: false, minScore: 0 },
  { id: 'short', name: 'Young Dachshund', visualKey: 'mascot-short', isMastered: false, minScore: 3.0 },
  { id: 'medium', name: 'Adult Dachshund', visualKey: 'mascot-medium', isMastered: false, minScore: 4.5 },
  { id: 'long-crowned', name: 'Master Dachshund', visualKey: 'mascot-long-crowned', isMastered: true, minScore: MASTERY_GROWTH_THRESHOLD },
];

export function getMascotStage(growthScore: number): MascotStageInfo {
  let stage = MASCOT_STAGES[0];
  for (const s of MASCOT_STAGES) {
    if (growthScore >= s.minScore) stage = s;
  }
  return stage;
}

// ============================================================================
// Wiring — applied on the round-4 pass that actually concludes a word's
// climb, whether that happened in Study or after however many retries in
// Review. Mistakes along the way are tracked separately (WordProgress.
// pendingMistakes, bumped directly in practice.ts) — they shrink this
// pass's growth increment but don't touch the schedule until this fires.
// ============================================================================

// The very first successful pass gets a short 1-day interval instead of the
// formula's ~3 days (2^1.5) — closer to real forgetting-curve practice (the
// steepest drop-off is in the first 24-48h), and it guarantees a word
// learned today shows up for review again tomorrow rather than sitting out
// for a few days. Every later pass still uses the normal exponential
// formula unchanged.
function reviewIntervalFor(successfulReviews: number, masteryScore: number): number {
  return successfulReviews === 1 ? 1 : getNextReviewInterval(masteryScore);
}

// A successful round-4 pass: banks a coin (legacy field, kept for existing
// UI), advances S and growthScore, and reschedules the next review using
// the freshly recalculated M.
export function recordRound4Success(progress: WordProgress, todayStr: string = today()): WordProgress {
  const successfulReviews = progress.successfulReviews + 1;
  const daysElapsed = progress.lastReviewedAt ? daysBetween(progress.lastReviewedAt, todayStr) : 0;
  const masteryScore = calculateMasteryScore(successfulReviews, daysElapsed, progress.pendingMistakes);
  const growthScore = progress.growthScore + calculateGrowthIncrement(progress.pendingMistakes);
  const stage = getMascotStage(growthScore);
  return {
    ...progress,
    successfulReviews,
    pendingMistakes: 0,
    masteryScore,
    growthScore,
    mascotStage: stage.id,
    lastReviewedAt: todayStr,
    nextReviewDue: addDays(todayStr, reviewIntervalFor(successfulReviews, masteryScore)),
    // Kept in sync so the existing coin/mastered UI (Stats, Words badges,
    // Home's mastered count, the congrats card) keeps working unchanged.
    studiedTimes: successfulReviews,
    fullyMastered: stage.isMastered,
  };
}

// For the Settings-page forecast: how many calendar days it takes one word
// to go from "just introduced" (1 clean pass) to mastered (growthScore >=
// 6.0, i.e. 4 clean passes), assuming every review happens exactly on
// schedule with no mistakes. Days-per-pass still comes from M's scheduling
// (which does compound); the pass count needed comes from growthScore's
// flat, linear climb.
export function simulateDaysToMastery(): number {
  let successfulReviews = 1;
  let masteryScore = calculateMasteryScore(successfulReviews, 0, 0);
  let growthScore = GROWTH_INCREMENT_BASE;
  let totalDays = 0;
  let guard = 0;
  while (growthScore < MASTERY_GROWTH_THRESHOLD && guard < 100) {
    const interval = reviewIntervalFor(successfulReviews, masteryScore);
    totalDays += interval;
    successfulReviews += 1;
    masteryScore = calculateMasteryScore(successfulReviews, interval, 0);
    growthScore += GROWTH_INCREMENT_BASE;
    guard += 1;
  }
  return totalDays;
}
