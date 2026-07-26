'use client';

import { WORDS, Word, wordsForLevel } from './words';
import {
  getAllProgress, getSettings, today, MAX_ROUND, Round, WordProgress,
  getDailySession, saveDailySession, SessionPhase,
} from './storage';
import { recordRound4Success, simulateDaysToMastery } from './srs';

// Reviews always start from this baseline difficulty — the word isn't new,
// so testing it from round 1 would be too easy.
export const REVIEW_BASE_ROUND: Round = 4;

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

const WORDS_BY_ID = new Map(WORDS.map(w => [w.id, w]));

// Looks up words by id, preserving order and silently dropping unknown ids.
export function wordsById(ids: string[]): Word[] {
  return ids.map(id => WORDS_BY_ID.get(id)).filter((w): w is Word => !!w);
}

// Beginners find long words disproportionately harder to type from scratch —
// for A1, until a learner has been introduced to their first SHORT_WORD_
// GRACE_COUNT words, new words are drawn short-first (article not counted
// toward length). Tied to words actually introduced, not calendar days, so
// it adapts to whatever pace the learner is actually keeping.
const SHORT_WORD_GRACE_COUNT = 100;
const SHORT_WORD_MAX_LENGTH = 6;

// Study pool: words that haven't reached round 4 yet — brand new words and
// words still climbing the round 1-4 ladder, however many days that's taken.
// Words already in progress (abandoned mid-ladder) are prioritized over
// brand-new ones, so an unfinished word gets picked up again before more
// new words are introduced.
export function buildStudyWords(
  limit = getSettings().studyBatchSize,
  excludeIds: Set<string> = new Set(),
): Word[] {
  const settings = getSettings();
  const allProgress = getAllProgress();
  const inProgress: Word[] = [];
  const fresh: Word[] = [];
  for (const w of wordsForLevel(settings.level)) {
    if (excludeIds.has(w.id)) continue;
    const p = allProgress[w.id];
    if (!p) fresh.push(w);
    else if (!p.fullyMastered && p.round < MAX_ROUND) inProgress.push(w);
  }

  let freshOrdered = shuffled(fresh);
  if (settings.level === 'A1') {
    const introducedCount = wordsForLevel('A1').filter(w => allProgress[w.id]).length;
    if (introducedCount < SHORT_WORD_GRACE_COUNT) {
      const short = freshOrdered.filter(w => [...w.de].length <= SHORT_WORD_MAX_LENGTH);
      const long = freshOrdered.filter(w => [...w.de].length > SHORT_WORD_MAX_LENGTH);
      freshOrdered = [...short, ...long];
    }
  }

  return [...shuffled(inProgress), ...freshOrdered].slice(0, limit);
}

// Called when the user changes "New words per day" in Settings, so the
// change is felt today instead of waiting for tomorrow's fresh batch. Resizes
// today's DailySession study batch (the main merged flow) — a no-op if
// today's session hasn't started yet (next Start uses the new size
// naturally) or if the study portion of it is already behind the user
// (phase has moved on to review or later — that part of today is settled).
// Growing pulls in more words (never re-shuffling ones already assigned);
// shrinking drops from the not-yet-finished tail first, but never below
// however many are already done today — a smaller pace shouldn't undo
// progress already made.
const RESIZABLE_STUDY_PHASES: SessionPhase[] = ['study-rounds', 'study-mcq', 'study-matching'];

export function resizeTodayStudyBatch(newSize: number): void {
  const session = getDailySession();
  if (!session || !RESIZABLE_STUDY_PHASES.includes(session.phase)) return;

  const allProgress = getAllProgress();
  const isDone = (id: string) => (allProgress[id]?.round ?? 1) >= MAX_ROUND;
  const existing = session.studyWordIds;
  const doneIds = existing.filter(isDone);
  const pendingIds = existing.filter(id => !isDone(id));
  const targetSize = Math.max(newSize, doneIds.length);

  if (targetSize > existing.length) {
    const extra = buildStudyWords(targetSize - existing.length, new Set(existing));
    session.studyWordIds = [...existing, ...extra.map(w => w.id)];
    // Brand new to today's batch, so they owe a round-1.5 check too —
    // without this they'd silently never get one.
    session.mcqQueueIds = [...session.mcqQueueIds, ...extra.map(w => w.id)];
    saveDailySession(session);
  } else if (targetSize < existing.length) {
    const keepPending = pendingIds.slice(0, targetSize - doneIds.length);
    session.studyWordIds = [...doneIds, ...keepPending];
    const kept = new Set(session.studyWordIds);
    session.mcqQueueIds = session.mcqQueueIds.filter(id => kept.has(id));
    session.mcqWrongIds = session.mcqWrongIds.filter(id => kept.has(id));
    saveDailySession(session);
  }
}

// Review pool: words that have earned at least one coin (reached round 4 and
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
  const pool = wordsForLevel(getSettings().level).filter(w => {
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
// Round 4: no hints — full recall.
export function generateHint(word: string, round: Round): boolean[] {
  const n = [...word].length;
  if (round === 1 || round === 4) return Array.from({ length: n }, () => true);
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
  const levelWords = wordsForLevel(getSettings().level);
  let introduced = 0;
  for (const w of levelWords) {
    if (allProgress[w.id]) introduced++;
  }

  const wordsRemaining = levelWords.length - introduced;
  const daysToIntroduceAll = studyBatchSize > 0 ? Math.ceil(wordsRemaining / studyBatchSize) : Infinity;

  // The natural pace the SRS formula itself produces, from first study pass
  // to crossing the mastery score, assuming on-schedule reviews with no
  // mistakes. The last word introduced still needs this full runway after
  // it's introduced; earlier words mature in parallel alongside it.
  const daysToMasterAll = daysToIntroduceAll + simulateDaysToMastery();

  return { wordsRemaining, daysToIntroduceAll, daysToMasterAll };
}

// Forecasts read more naturally in weeks once they run past a couple of
// weeks — used by Settings/Welcome's "at this pace" display. Infinity (a
// batch size of 0) passes through unchanged rather than becoming NaN.
export function daysToWeeks(days: number): number {
  if (!Number.isFinite(days)) return days;
  return Math.max(1, Math.round(days / 7));
}

export function checkAnswer(word: string, answer: string): boolean {
  return word.toLowerCase() === answer.trim().toLowerCase();
}

// Wrong answer → stay at the same round and just try it again (no demotion —
// see requestHint below for the learner-initiated way to actually drop a
// round for more scaffolding).
// Correct answer below round 4 → promote one round.
// Correct answer at round 4 → this is a real successful no-hint pass, so it
// feeds the SRS scoring (mastery score, mascot stage, next review date) —
// same bookkeeping a Review success gets. Round 4 is now the ceiling: one
// clean no-hint pass is the whole pass condition, there's no round 5.
export function applyResult(progress: WordProgress, correct: boolean): WordProgress {
  const lastPracticed = today();

  if (!correct) {
    return { ...progress, lastPracticed };
  }

  if (progress.round < MAX_ROUND) {
    const round = (progress.round + 1) as Round;
    return { ...progress, round, lastPracticed };
  }

  return { ...recordRound4Success(progress), round: MAX_ROUND, lastPracticed };
}

// A learner-requested hint: explicitly demotes one round for more scaffolding
// (round 3 shows the first letter, round 2 shows ~half, round 1 is a full
// copy) — a deliberate ask, distinct from a wrong typed answer, which just
// retries at the same round. Counts the same as a mistake for SRS purposes
// (shrinks the eventual growth increment when the word is finally passed),
// since the learner is telling us they didn't know it unaided. Not available
// at round 1 — already the most scaffolded there is, nowhere lower to go.
export function requestHint(progress: WordProgress, currentRound: Round): { progress: WordProgress; nextRound: Round } {
  const nextRound = Math.max(1, currentRound - 1) as Round;
  return {
    progress: { ...progress, pendingMistakes: progress.pendingMistakes + 1, lastPracticed: today() },
    nextRound,
  };
}

export interface ReviewOutcome {
  progress: WordProgress;
  // The round to show next time this word comes up in this session — only
  // meaningful when `isFinal` is false (isFinal means it's leaving the queue).
  nextRound: Round;
  // True once this word's review episode is over: either a full pass at
  // round 4 (whether on the first try or after climbing back from a hint
  // demotion), or a one-shot "Review Extra" practice attempt.
  isFinal: boolean;
  // True if this attempt actually happened on-schedule and can affect
  // mastery — false for "Review Extra" bonus practice on a not-yet-due word.
  scored: boolean;
}

// Review scoring: every review episode starts at REVIEW_BASE_ROUND (= the
// new MAX_ROUND, 4) — correct there immediately passes it, same as any other
// round-4 completion. A wrong typed answer stays at the same round (same as
// Study — no demotion; see requestHint for the deliberate way to drop a
// round) and keeps it in the session's queue for another try — it does NOT
// get rescheduled for tomorrow, since the user is expected to keep retrying
// today. Only the round-4 answer that actually concludes the episode (first
// try, or after however many retries/hint-demotions) touches the SRS
// schedule, using whatever pendingMistakes built up along the way for the
// growth increment.
export function applyReviewResult(progress: WordProgress, correct: boolean, currentRound: Round): ReviewOutcome {
  const t = today();

  // Not actually due yet — only reachable via "Review Extra" pulling in a
  // word early. That's bonus practice: gives feedback, but doesn't touch
  // the SRS schedule, score, or round, since reviewing early doesn't tell
  // us anything about long-term recall the way an on-schedule review does.
  if (progress.nextReviewDue && progress.nextReviewDue > t) {
    return { progress, nextRound: REVIEW_BASE_ROUND, isFinal: true, scored: false };
  }

  if (correct) {
    if (currentRound >= REVIEW_BASE_ROUND) {
      return { progress: recordRound4Success(progress, t), nextRound: MAX_ROUND, isFinal: true, scored: true };
    }
    const nextRound = (currentRound + 1) as Round;
    return { progress: { ...progress, lastPracticed: t }, nextRound, isFinal: false, scored: true };
  }

  const updated = { ...progress, pendingMistakes: progress.pendingMistakes + 1, lastPracticed: t };
  return { progress: updated, nextRound: currentRound, isFinal: false, scored: true };
}

// ============================================================================
// Round 1.5 — DE -> EN translation choice, and the end-of-section matching
// quiz. Both are reinforcement layered on top of the round ladder above:
// neither ever touches masteryScore/growthScore/nextReviewDue.
// ============================================================================

// True once every word in a batch has cleared round 1 — the gate for
// entering the batch-wide round-1.5 checkpoint (study-mcq phase).
export function allClearedRoundOne(ids: string[], progress: Record<string, WordProgress>): boolean {
  return ids.every(id => (progress[id]?.round ?? 1) >= 2);
}

// Picks 3 wrong English choices for `word`, preferring words from the same
// `category` (only ~200 noun entries have one); falling back to the same
// `type` (part of speech) when there's no category or too few members; and
// finally to any other word if even that pool is too small. `seen` (choices
// already shown to this word this session — tracked in-memory by the caller)
// is excluded so a retry after a wrong answer gets genuinely different
// distractors, degrading gracefully to repeats only if the pool is exhausted.
export function buildMcqChoices(word: Word, seen: string[] = []): { correct: string; choices: string[] } {
  const excluded = new Set([word.en.toLowerCase(), ...seen.map(s => s.toLowerCase())]);
  const pickedEn = new Set<string>();
  const wrongChoices: string[] = [];

  const addFrom = (pool: Word[]) => {
    for (const w of shuffled(pool)) {
      if (wrongChoices.length >= 3) break;
      const key = w.en.toLowerCase();
      if (excluded.has(key) || pickedEn.has(key)) continue;
      pickedEn.add(key);
      wrongChoices.push(w.en);
    }
  };

  if (word.category) {
    addFrom(WORDS.filter(w => w.id !== word.id && w.category === word.category));
  }
  if (wrongChoices.length < 3) {
    addFrom(WORDS.filter(w => w.id !== word.id && w.type === word.type));
  }
  if (wrongChoices.length < 3) {
    addFrom(WORDS.filter(w => w.id !== word.id));
  }

  return { correct: word.en, choices: shuffled([word.en, ...wrongChoices]) };
}

// Chunks word ids into matching-quiz pages of exactly 5 each. A page is only
// ever shorter than 5 when there aren't 5 distinct words in the whole batch
// to draw from — otherwise the last page is padded back up to 5 using words
// from earlier pages (already tested, since each page must be fully correct
// — see MatchingQuizPage — before moving on, repeats there are harmless).
// E.g. 8 words -> page 1 = words 1-5, page 2 = words 6-8 + 2 more from 1-5.
export function buildMatchingPages(wordIds: string[]): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < wordIds.length; i += 5) {
    pages.push(wordIds.slice(i, i + 5));
  }
  if (pages.length > 1 && wordIds.length >= 5) {
    const last = pages[pages.length - 1];
    if (last.length < 5) {
      const lastSet = new Set(last);
      const padPool = shuffled(wordIds.filter(id => !lastSet.has(id)));
      pages[pages.length - 1] = [...last, ...padPool.slice(0, 5 - last.length)];
    }
  }
  return pages;
}
