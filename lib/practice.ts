'use client';

import { WORDS, Word } from './words';
import { getAllProgress, getSettings, today, MAX_ROUND, Round, WordProgress } from './storage';

// Reviews always start from this baseline difficulty — the word isn't new,
// so testing it from round 1 would be too easy.
export const REVIEW_BASE_ROUND: Round = 5;

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

const WORDS_BY_ID = new Map(WORDS.map(w => [w.id, w]));

// Looks up words by id, preserving order and silently dropping unknown ids.
export function wordsById(ids: string[]): Word[] {
  return ids.map(id => WORDS_BY_ID.get(id)).filter((w): w is Word => !!w);
}

// Study pool: words that haven't reached round 5 yet — brand new words and
// words still climbing the round 1-4 ladder, however many days that's taken.
// Words already in progress (abandoned mid-ladder) are prioritized over
// brand-new ones, so an unfinished word gets picked up again before more
// new words are introduced.
export function buildStudyWords(limit = getSettings().studyBatchSize): Word[] {
  const allProgress = getAllProgress();
  const inProgress: Word[] = [];
  const fresh: Word[] = [];
  for (const w of WORDS) {
    const p = allProgress[w.id];
    if (!p) fresh.push(w);
    else if (!p.fullyMastered && p.round < MAX_ROUND) inProgress.push(w);
  }
  return [...shuffled(inProgress), ...shuffled(fresh)].slice(0, limit);
}

// Review pool: words that have earned at least one coin (reached round 5 and
// been tested there successfully) and aren't fully mastered yet. Prioritizes
// the ones with fewer studiedTimes (coins) — they need more reinforcement.
// By default, words last touched today (just graduated from study, or
// already reviewed today) are excluded — reviewing something minutes after
// learning it isn't real spaced repetition, and it keeps day-one empty
// rather than immediately full of words just studied. Pass `includeToday`
// to lift that (the "Review Extra" flow). `excludeIds` lets a session pull
// additional batches via "Review more".
export function buildReviewWords(
  limit = getSettings().dailyReview,
  excludeIds: Set<string> = new Set(),
  includeToday = false,
): Word[] {
  const allProgress = getAllProgress();
  const t = today();
  const pool = WORDS.filter(w => {
    const p = allProgress[w.id];
    if (!p || p.fullyMastered || p.round !== MAX_ROUND || p.studiedTimes < 1) return false;
    if (excludeIds.has(w.id)) return false;
    if (!includeToday && p.lastPracticed === t) return false;
    return true;
  });
  pool.sort((a, b) => allProgress[a.id].studiedTimes - allProgress[b.id].studiedTimes);
  return pool.slice(0, limit);
}

// Returns hint pattern: true = hidden (user must type it), false = revealed (locked, pre-filled).
// Round 1: nothing revealed in the tiles (the word is shown separately as reference text).
// Round 2: ~50% of letters revealed, always including the first letter.
// Round 3: only the first letter revealed.
// Round 4 & 5: no hints — full recall.
export function generateHint(word: string, round: Round): boolean[] {
  const n = [...word].length;
  if (round === 1 || round === 4 || round === 5) return Array.from({ length: n }, () => true);
  if (round === 3) return Array.from({ length: n }, (_, i) => i !== 0);

  // round 2
  const revealCount = Math.max(1, Math.round(n / 2));
  const revealed = new Set([0]);
  const rest = shuffled(Array.from({ length: n - 1 }, (_, i) => i + 1));
  rest.slice(0, revealCount - 1).forEach(i => revealed.add(i));
  return Array.from({ length: n }, (_, i) => !revealed.has(i));
}

// Suggests a daily review count that can keep up with the review backlog
// a given study pace generates. Each word needs (masteryThreshold - 1) more
// successful reviews after its introduction day to be fully mastered — in
// steady state that's how many review slots per day are needed to review
// every eligible word once, so the backlog doesn't grow indefinitely.
export function recommendedDailyReview(studyBatchSize: number, masteryThreshold: number): number {
  return Math.max(1, Math.min(100, Math.round(studyBatchSize * (masteryThreshold - 1))));
}

export interface ProgressForecast {
  wordsRemaining: number;
  daysToIntroduceAll: number;
  daysToMasterAll: number;
}

// Rough forecast for the Settings page: how many days at the given pace
// until every word has been studied at least once, and until every word
// is fully mastered. Assumes correct answers every time (an optimistic
// best case), and that study happens before review each day.
export function estimateProgressForecast(
  studyBatchSize: number,
  dailyReview: number,
  masteryThreshold: number,
): ProgressForecast {
  const allProgress = getAllProgress();
  let introduced = 0;
  let reviewCoinsRemaining = 0;

  for (const w of WORDS) {
    const p = allProgress[w.id];
    if (!p) continue;
    introduced++;
    if (!p.fullyMastered) {
      reviewCoinsRemaining += Math.max(0, masteryThreshold - p.studiedTimes);
    }
  }

  const wordsRemaining = WORDS.length - introduced;
  const daysToIntroduceAll = studyBatchSize > 0 ? Math.ceil(wordsRemaining / studyBatchSize) : Infinity;

  // A word earns its first coin for free the same day it's introduced
  // (a study session doesn't end until every pulled word reaches round 5),
  // so only the remaining coins after that need dedicated review days.
  reviewCoinsRemaining += wordsRemaining * Math.max(0, masteryThreshold - 1);
  const daysForReview = dailyReview > 0 ? Math.ceil(reviewCoinsRemaining / dailyReview) : Infinity;

  return {
    wordsRemaining,
    daysToIntroduceAll,
    daysToMasterAll: daysToIntroduceAll + daysForReview,
  };
}

export function checkAnswer(word: string, answer: string): boolean {
  return word.toLowerCase() === answer.trim().toLowerCase();
}

// Wrong answer → demote one round (floor at 1, since there's no round 0).
// Correct answer below round 5 → promote one round.
// Correct answer at round 5 → increment studiedTimes (a "coin"); fully master
// once it reaches the (user-adjustable) threshold.
export function applyResult(
  progress: WordProgress,
  correct: boolean,
  masteryThreshold: number,
): WordProgress {
  const lastPracticed = today();

  if (!correct) {
    const round = Math.max(1, progress.round - 1) as Round;
    return { ...progress, round, lastPracticed };
  }

  if (progress.round < MAX_ROUND) {
    const round = (progress.round + 1) as Round;
    return { ...progress, round, lastPracticed };
  }

  const studiedTimes = progress.studiedTimes + 1;
  return {
    ...progress,
    round: MAX_ROUND,
    studiedTimes,
    fullyMastered: studiedTimes >= masteryThreshold,
    lastPracticed,
  };
}

// Review scoring: every review attempt is judged from the REVIEW_BASE_ROUND
// baseline, regardless of the word's stored round (which is always MAX_ROUND
// going into a review). Correct → passes round 5 again, earning a coin.
// Wrong → falls one step below the baseline, back into the study ladder.
export function applyReviewResult(
  progress: WordProgress,
  correct: boolean,
  masteryThreshold: number,
): WordProgress {
  const lastPracticed = today();

  // A word can only bank one coin per calendar day — mastery is meant to
  // reflect `masteryThreshold` distinct days of successful recall. Normal
  // review already only offers words that weren't touched today, but
  // "Review Extra" deliberately includes same-day graduates for bonus
  // practice; further correct answers today shouldn't double-count, and a
  // wrong one here shouldn't undo a coin already earned today either — it's
  // just practice.
  if (progress.lastPracticed === lastPracticed && progress.round === MAX_ROUND) {
    return progress;
  }

  if (!correct) {
    const round = (REVIEW_BASE_ROUND - 1) as Round;
    return { ...progress, round, lastPracticed };
  }

  const studiedTimes = progress.studiedTimes + 1;
  return {
    ...progress,
    round: MAX_ROUND,
    studiedTimes,
    fullyMastered: studiedTimes >= masteryThreshold,
    lastPracticed,
  };
}
