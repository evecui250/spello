'use client';

import { WORDS, Word } from './words';
import { getAllProgress, getSettings, today, MAX_ROUND, Round, WordProgress } from './storage';

// Reviews always start from this baseline difficulty — the word isn't new,
// so testing it from round 1 would be too easy.
export const REVIEW_BASE_ROUND: Round = 5;

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
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
// been tested there successfully) and aren't fully mastered yet — including
// words that graduated earlier the same day. Prioritizes the ones with fewer
// studiedTimes (coins) — they need more reinforcement.
// `excludeIds` lets a session pull additional batches via "Review more".
export function buildReviewWords(limit = getSettings().dailyReview, excludeIds: Set<string> = new Set()): Word[] {
  const allProgress = getAllProgress();
  const pool = WORDS.filter(w => {
    const p = allProgress[w.id];
    return p && !p.fullyMastered && p.round === MAX_ROUND && p.studiedTimes >= 1 && !excludeIds.has(w.id);
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
