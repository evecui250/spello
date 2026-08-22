'use client';

import { MascotStageId, Round, WordProgress, today } from './storage';

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
// Fixed review schedule — replaces the old mastery-score/growth-score
// formulas entirely. Every word goes through exactly 4 milestones (one per
// mascot stage): introduction (round 1 sentence -> round 2), then 3 reviews
// at fixed offsets from whenever the previous milestone actually completed
// (not from a fixed introduction date, so a late review doesn't throw off
// the rest of the schedule — same forgiving behavior the old system had for
// overdue reviews).
// ============================================================================

// Days to wait after passing a given stage before its next review is due.
// null = fully mastered, retired from review for good.
export const OFFSET_AFTER_STAGE: Record<MascotStageId, number | null> = {
  puppy: 1,
  short: 3,
  medium: 5,
  'long-crowned': null,
};

// Each review milestone's starting round (wherever the word left off last
// time), the round it must pass to complete that milestone, and the stage
// it advances to on a pass. Only the 3 non-terminal stages ever enter a
// review (long-crowned is retired).
// Round -> hint level: 2 = half-word hint, 3 = first-letter-only hint,
// 4 = no hint (see generateHint in lib/practice.ts). Deliberately eased
// from an earlier version that ramped straight to a no-hint round by the
// 2nd review and made the 3rd review nothing but a single no-hint check —
// that jumped to fully-unaided recall too fast. Now the 1st and 2nd
// reviews repeat the same gentler half-hint -> first-letter-hint pair
// (one extra rep at that level instead of escalating), and the 3rd review
// eases into the final no-hint check via a first-letter-hint round first,
// rather than that being the only thing standing between "Strong" and
// "Mastered".
export const REVIEW_PLAN: Record<'puppy' | 'short' | 'medium', {
  nextStage: MascotStageId;
  startRound: Round;
  capRound: Round;
}> = {
  puppy:  { nextStage: 'short',        startRound: 2, capRound: 3 },
  short:  { nextStage: 'medium',       startRound: 2, capRound: 3 },
  medium: { nextStage: 'long-crowned', startRound: 3, capRound: 4 },
};

// The round a word sits at once it reaches a given stage — used to make
// sure `round` never reports lower than what was actually just passed.
const ROUND_FOR_STAGE: Record<MascotStageId, Round> = {
  puppy: 2, short: 3, medium: 4, 'long-crowned': 4,
};

// Total days from introduction to full mastery, on-schedule with no
// mistakes: 1 (1st review) + 3 (2nd) + 5 (3rd) = 9. Replaces the old
// simulateDaysToMastery — no simulation needed, the schedule is fixed.
export const MASTERY_DAYS_AFTER_INTRODUCTION = 9;

// The single write path for advancing a word to its next milestone —
// called on a clean pass at round 2 (introduction) or at a review's cap
// round (1st/2nd/3rd review). Sets the new stage, reschedules the next
// review at its fixed offset from today (or retires the word for good at
// long-crowned), and keeps round/studiedTimes/successfulReviews/
// fullyMastered in step.
export function recordMilestonePass(progress: WordProgress, toStage: MascotStageId, todayStr: string = today()): WordProgress {
  const offset = OFFSET_AFTER_STAGE[toStage];
  return {
    ...progress,
    mascotStage: toStage,
    round: Math.max(progress.round, ROUND_FOR_STAGE[toStage]) as Round,
    lastReviewedAt: todayStr,
    nextReviewDue: offset === null ? undefined : addDays(todayStr, offset),
    fullyMastered: toStage === 'long-crowned',
    studiedTimes: progress.studiedTimes + 1,
    successfulReviews: progress.successfulReviews + 1,
  };
}
