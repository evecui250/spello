'use client';

import { WORDS, Word } from './words';
import { getAllProgress, getSettings, today, MAX_ROUND, Round, WordProgress } from './storage';
import { recordRound5Success, recordRound5Failure, simulateDaysToMastery } from './srs';

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
// been tested there successfully) and aren't fully mastered yet. By default,
// only words that are actually due (today >= nextReviewDue, per the SRS
// schedule) are eligible — spacing grows with mastery, so a strong word
// might not be due again for weeks or months. Pass `includeToday` to bypass
// the schedule for early bonus practice (the "Review Extra" flow); those
// attempts don't affect the schedule or score (see applyReviewResult).
// `excludeIds` lets a session pull additional batches via "Review more".
export function buildReviewWords(
  limit = getSettings().dailyReview,
  excludeIds: Set<string> = new Set(),
  includeToday = false,
): Word[] {
  const allProgress = getAllProgress();
  const t = today();
  const pool = WORDS.filter(w => {
    const p = allProgress[w.id];
    if (!p || p.fullyMastered || p.round !== MAX_ROUND || p.successfulReviews < 1) return false;
    if (excludeIds.has(w.id)) return false;
    if (!includeToday && p.nextReviewDue && p.nextReviewDue > t) return false;
    return true;
  });
  // Most overdue first, then weakest (lowest mastery score) first.
  pool.sort((a, b) => {
    const dueA = allProgress[a.id].nextReviewDue ?? t;
    const dueB = allProgress[b.id].nextReviewDue ?? t;
    return dueA.localeCompare(dueB) || allProgress[a.id].masteryScore - allProgress[b.id].masteryScore;
  });
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

// Suggests a daily review count. Each word needs exactly 3 successful
// reviews after introduction to retire (at ~day 3, ~day 35, and ~day 155,
// per the SRS schedule in lib/srs.ts) — so once the pace has been running
// long enough for all three cohorts to be active simultaneously, steady-state
// daily review load converges to 3x the study pace (three cohorts' worth of
// words landing on any given day).
export function recommendedDailyReview(studyBatchSize: number): number {
  return Math.max(1, Math.min(100, Math.round(studyBatchSize * 3)));
}

export interface ProgressForecast {
  wordsRemaining: number;
  daysToIntroduceAll: number;
  daysToMasterAll: number;
}

// Rough forecast for the Settings page: how many days at the given pace
// until every word has been studied at least once, and until every word is
// mastered (mascot stage 4, M >= 10). daysToMasterAll assumes review
// capacity isn't a bottleneck — i.e. dailyReview is generous enough to
// review every due word — since with exponentially-spaced reviews the true
// due-word volume on any given day depends on the whole history of when
// each word was introduced, which isn't tractable to forecast exactly here.
export function estimateProgressForecast(studyBatchSize: number): ProgressForecast {
  const allProgress = getAllProgress();
  let introduced = 0;
  for (const w of WORDS) {
    if (allProgress[w.id]) introduced++;
  }

  const wordsRemaining = WORDS.length - introduced;
  const daysToIntroduceAll = studyBatchSize > 0 ? Math.ceil(wordsRemaining / studyBatchSize) : Infinity;

  // The natural pace the SRS formula itself produces, from first study pass
  // to crossing the mastery score, assuming on-schedule reviews with no
  // mistakes. The last word introduced still needs this full runway after
  // it's introduced; earlier words mature in parallel alongside it.
  const daysToMasterAll = daysToIntroduceAll + simulateDaysToMastery();

  return { wordsRemaining, daysToIntroduceAll, daysToMasterAll };
}

export function checkAnswer(word: string, answer: string): boolean {
  return word.toLowerCase() === answer.trim().toLowerCase();
}

// Wrong answer → demote one round (floor at 1, since there's no round 0).
// Correct answer below round 5 → promote one round.
// Correct answer at round 5 → this is a real successful no-hint pass, so it
// feeds the SRS scoring (mastery score, mascot stage, next review date) —
// same bookkeeping a Review success gets.
export function applyResult(progress: WordProgress, correct: boolean): WordProgress {
  const lastPracticed = today();

  if (!correct) {
    const round = Math.max(1, progress.round - 1) as Round;
    return { ...progress, round, lastPracticed };
  }

  if (progress.round < MAX_ROUND) {
    const round = (progress.round + 1) as Round;
    return { ...progress, round, lastPracticed };
  }

  return { ...recordRound5Success(progress), round: MAX_ROUND, lastPracticed };
}

// Review scoring: every review attempt is judged from the REVIEW_BASE_ROUND
// baseline, regardless of the word's stored round (which is always MAX_ROUND
// going into a review).
export function applyReviewResult(progress: WordProgress, correct: boolean): WordProgress {
  const lastPracticed = today();
  const t = today();

  // Not actually due yet — only reachable via "Review Extra" pulling in a
  // word early. That's bonus practice: gives feedback, but doesn't touch
  // the SRS schedule, score, or round, since reviewing early doesn't tell
  // us anything about long-term recall the way an on-schedule review does.
  if (progress.nextReviewDue && progress.nextReviewDue > t) {
    return progress;
  }

  if (!correct) {
    const round = (REVIEW_BASE_ROUND - 1) as Round;
    return { ...recordRound5Failure(progress, t), round, lastPracticed };
  }

  return { ...recordRound5Success(progress, t), round: MAX_ROUND, lastPracticed };
}
