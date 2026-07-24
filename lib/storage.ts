'use client';

export type Round = 1 | 2 | 3 | 4 | 5;
export const MAX_ROUND: Round = 5;

// The 4-stage dachshund mascot — a word's memory strength, derived from its
// masteryScore. See lib/srs.ts for the scoring/stage logic.
export type MascotStageId = 'puppy' | 'short' | 'medium' | 'long-crowned';

export interface WordProgress {
  id: string;
  round: Round;        // current difficulty level, 1 (copy word) .. 5 (no hints)
  studiedTimes: number; // legacy coin count — kept in sync with successfulReviews for
                         // existing displays (Stats, Words badges, the congrats card)
  fullyMastered: boolean; // kept in sync with mascotStage === 'long-crowned'
  lastPracticed?: string;

  // --- Spaced-repetition fields (see lib/srs.ts) ---
  masteryScore: number;       // M — scheduling-only score; can dip after a mistake,
                               // drives nextReviewDue's interval. Not used for the mascot.
  growthScore: number;        // M' — monotonic; drives mascotStage + retirement. Only
                               // ever increases: a mistake shrinks the *next* increment,
                               // it doesn't undo progress already made.
  successfulReviews: number;  // S — total successful no-hint (round 5) passes
  pendingMistakes: number;    // failed attempts since the last successful review;
                               // consumed (feeding both M and the next growthScore
                               // increment), then reset, on the next success
  lastReviewedAt?: string;    // date of the last successful round-5 pass
  nextReviewDue?: string;     // date this word next becomes eligible for Review
  mascotStage: MascotStageId; // derived from growthScore, stored for convenient display
}

export interface Streak {
  lastDate: string;
  count: number;
}

export interface Settings {
  studyBatchSize: number;
  dailyReview: number;
  language: string;
  level: string;
  autoPlayAudio: boolean;
  requireArticle: boolean;
}

const KEYS = {
  progress: 'wb2_progress',
  streak: 'wb2_streak',
  settings: 'wb2_settings',
  settingsUpdatedAt: 'wb2_settings_updated_at',
  dailyStats: 'wb2_daily_stats',
  studyBatch: 'wb2_study_batch',
  dailySession: 'wb2_daily_session',
  onboardingDone: 'wb2_onboarding_done',
};

const EXTRA_STUDY_KEY = 'wb2_extra_study_limit';
const EXTRA_REVIEW_KEY = 'wb2_extra_review_limit';

const DEFAULT_SETTINGS: Settings = {
  studyBatchSize: 15, dailyReview: 25, language: 'de', level: 'B2',
  autoPlayAudio: true, requireArticle: false,
};

// The user's LOCAL calendar date — deliberately not toISOString() (which is
// always UTC). Using UTC here meant the app's "today" silently disagreed
// with the user's actual calendar day for part of every day (more of the
// day, the further their timezone sits from UTC), which desynced due-date
// comparisons and could make review-eligible words not show as due, or a
// batch of same-session words land on different scheduled days.
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return localDateString(new Date());
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

function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Fills in defaults for any progress record saved under an older schema.
// Records from before the SRS system get sensible one-time defaults here —
// legacy coin count becomes the initial successfulReviews/masteryScore, and
// nextReviewDue defaults to "due now" rather than being stuck waiting for a
// date that was never set. Everything self-corrects the next time the word
// is actually reviewed (see lib/srs.ts).
function normalizeProgress(id: string, p: Partial<WordProgress> | undefined): WordProgress {
  const successfulReviews = p?.successfulReviews ?? p?.studiedTimes ?? 0;
  const fullyMastered = p?.fullyMastered ?? false;
  // Legacy records predate growthScore — treat their past coin count as if
  // every pass had been clean (1.5 each), a reasonable one-time assumption
  // that self-corrects as the word is reviewed again going forward.
  const growthScore = p?.growthScore ?? successfulReviews * 1.5;
  let nextReviewDue = p?.nextReviewDue ?? today();
  // One-time migration: words that reached their first-ever review before the
  // "first review is 1 day later" fix shipped were scheduled ~3 days out
  // (the old mastery-based formula). Pull those back to lastPracticed+1 so
  // already-learned words get the same fast first review as new ones —
  // otherwise this is stuck on the stale value forever, since the fix only
  // changes how *new* completions compute the date, not ones already saved.
  if (successfulReviews === 1 && p?.lastPracticed) {
    const target = addOneDay(p.lastPracticed);
    if (nextReviewDue > target) nextReviewDue = target;
  }
  return {
    id,
    round: (p?.round as Round) ?? 1,
    studiedTimes: p?.studiedTimes ?? successfulReviews,
    fullyMastered,
    lastPracticed: p?.lastPracticed,
    masteryScore: p?.masteryScore ?? successfulReviews * 1.5,
    growthScore,
    successfulReviews,
    pendingMistakes: p?.pendingMistakes ?? 0,
    lastReviewedAt: p?.lastReviewedAt ?? p?.lastPracticed,
    nextReviewDue,
    mascotStage: p?.mascotStage ?? (
      fullyMastered ? 'long-crowned' : growthScore >= 4.5 ? 'medium' : growthScore >= 3.0 ? 'short' : 'puppy'
    ),
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
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = localDateString(d);
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
  localStorage.setItem(KEYS.settingsUpdatedAt, new Date().toISOString());
}

// When settings last changed on this device — lets a remote sync pull decide
// whether its copy is actually newer before overwriting a local edit.
export function getSettingsUpdatedAt(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(KEYS.settingsUpdatedAt) || '';
}

// --- Onboarding ---
// Whether a first-time visitor has been through the welcome/setup page yet.

export function isOnboardingDone(): boolean {
  if (typeof window === 'undefined') return true;
  if (localStorage.getItem(KEYS.onboardingDone) === '1') return true;
  // Grandfather in anyone who already has settings or progress saved from
  // before this feature existed — don't send existing users to onboarding.
  if (localStorage.getItem(KEYS.settings) !== null || localStorage.getItem(KEYS.progress) !== null) {
    markOnboardingDone();
    return true;
  }
  return false;
}

export function markOnboardingDone(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.onboardingDone, '1');
}

// --- Daily study/review goals ---

export interface DailyStats {
  date: string;
  studyDone: boolean;
  reviewDone: boolean;
  studiedCount: number;   // words brought to round 5 today, across all rounds (main + any extras)
  reviewedCount: number;  // words reviewed today, across all review batches
  congratsShown: boolean; // whether the "both sections done" card has been shown today
  // Cumulative across every round today (main + extras) — kept separate from
  // DailySession's own earnedPuppies/earnedUpgrades, which reset each round
  // and drive the interim "Study complete!" screen instead. These two are
  // for the congrats card, which sits next to the cumulative studiedCount/
  // reviewedCount above and needs to match that same "whole day" framing.
  puppiesEarned: number;
  upgradesEarned: Partial<Record<MascotStageId, number>>;
}

function defaultDailyStats(): DailyStats {
  return {
    date: today(), studyDone: false, reviewDone: false,
    studiedCount: 0, reviewedCount: 0, congratsShown: false,
    puppiesEarned: 0, upgradesEarned: {},
  };
}

export function getDailyStats(): DailyStats {
  if (typeof window === 'undefined') return defaultDailyStats();
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS.dailyStats) || 'null') as Partial<DailyStats> | null;
    // Merged against the default so a record saved today under an older
    // schema (missing newer fields) doesn't produce NaN/undefined instead
    // of a sensible starting value.
    if (raw && raw.date === today()) return { ...defaultDailyStats(), ...raw };
  } catch {
    // fall through to default
  }
  return defaultDailyStats();
}

function saveDailyStats(stats: DailyStats): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.dailyStats, JSON.stringify(stats));
}

// Whether the user has completed a full study session today (their daily goal).
export function isStudyGoalDoneToday(): boolean {
  return getDailyStats().studyDone;
}

export function isReviewGoalDoneToday(): boolean {
  return getDailyStats().reviewDone;
}

// Records that today's study batch finished. `count` is added, since a user
// can run multiple rounds today (the main batch, then any number of "study
// more" extra rounds) — studiedCount accumulates across all of them so the
// congrats card can show the day's real total.
export function markStudyGoalDone(count: number): DailyStats {
  const stats = getDailyStats();
  stats.studyDone = true;
  stats.studiedCount += count;
  saveDailyStats(stats);
  return stats;
}

// Directly sets the study-goal flag, without touching studiedCount. Used
// when resizing today's batch (see resizeTodayStudyBatch): growing it past
// an already-finished smaller batch means there's genuinely more to do
// today, so the goal needs to go back to "not done" until the new words
// are finished too — it shouldn't stay stuck showing "done" just because
// the original, smaller batch was.
export function setStudyGoalDoneFlag(done: boolean): void {
  const stats = getDailyStats();
  stats.studyDone = done;
  saveDailyStats(stats);
}

// Same idea for Review: lets Home mark the goal met when there's genuinely
// nothing due today, rather than only ever setting it from within an actual
// review session (see app/page.tsx).
export function setReviewGoalDoneFlag(done: boolean): void {
  const stats = getDailyStats();
  stats.reviewDone = done;
  saveDailyStats(stats);
}

// Records that a review batch finished. `count` is added, since a user can
// review multiple batches ("Review more") across the day.
export function markReviewGoalDone(count: number): DailyStats {
  const stats = getDailyStats();
  stats.reviewDone = true;
  stats.reviewedCount += count;
  saveDailyStats(stats);
  return stats;
}

export function markCongratsShown(): void {
  const stats = getDailyStats();
  stats.congratsShown = true;
  saveDailyStats(stats);
}

// Cumulative-for-the-day puppy/upgrade tally, for the congrats card — see
// the DailyStats.puppiesEarned/upgradesEarned comment for why these are
// separate from DailySession's own per-round versions.
export function addEarnedPuppy(): void {
  const stats = getDailyStats();
  stats.puppiesEarned += 1;
  saveDailyStats(stats);
}

export function addEarnedUpgrade(stage: MascotStageId): void {
  const stats = getDailyStats();
  stats.upgradesEarned[stage] = (stats.upgradesEarned[stage] ?? 0) + 1;
  saveDailyStats(stats);
}

// Called right before starting an extra round through the merged flow
// (today's main goal is already done) — un-latches studyDone/reviewDone and
// congratsShown so that finishing this round earns its own congrats card
// again, while studiedCount/reviewedCount (untouched here) keep accumulating
// toward the day's real total.
export function resetDailyGoalsForExtraRound(): void {
  const stats = getDailyStats();
  stats.studyDone = false;
  stats.reviewDone = false;
  stats.congratsShown = false;
  saveDailyStats(stats);
}

// --- Today's study batch (legacy — still used by the Study Extra flow's
// underlying PracticeSession component; the main daily flow below has its
// own studyWordIds instead) ---

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

// --- Today's single merged daily session ---
// One guided flow per day: study the day's new words (with the round-1.5
// translation-choice checkpoint woven in), a matching-quiz recap, then the
// same for review. `phase` + the queues below capture exactly where the user
// left off, so navigating away and coming back (even the next day, in which
// case a fresh session simply gets started) resumes cleanly. Naturally
// invalidated once the date rolls over, same pattern as DailyStats.
export type SessionPhase =
  | 'study-rounds' | 'study-mcq' | 'study-matching'
  | 'study-done'
  | 'review-rounds' | 'review-matching'
  | 'report'
  | 'congrats'
  | 'done';

export interface DailySession {
  date: string;
  phase: SessionPhase;
  studyWordIds: string[];
  reviewWordIds: string[];
  mcqQueueIds: string[];    // not-yet-tested ids in the current round-1.5 pass
  mcqWrongIds: string[];    // wrong this pass — seeds the next pass, redone
                             // immediately (not deferred to a later round)
  matchingQueueIds: string[]; // which page comes next in the matching quiz
  earnedPuppies: number;
  earnedUpgrades: Partial<Record<MascotStageId, number>>;
}

export function getDailySession(): DailySession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KEYS.dailySession) || 'null') as DailySession | null;
    if (raw && raw.date === today()) return raw;
    return null;
  } catch {
    return null;
  }
}

export function saveDailySession(s: DailySession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEYS.dailySession, JSON.stringify(s));
}

export function startDailySession(studyWordIds: string[], reviewWordIds: string[]): DailySession {
  const s: DailySession = {
    date: today(),
    // 'report' is the universal fallback when there's nothing to study AND
    // nothing to review — it renders nothing (0 upgrades) and immediately
    // cascades into 'congrats', so the streak/congrats bookkeeping still
    // goes through the one code path that owns it.
    phase: studyWordIds.length > 0 ? 'study-rounds' : reviewWordIds.length > 0 ? 'review-rounds' : 'report',
    studyWordIds,
    reviewWordIds,
    // Every study word owes a first-time round-1.5 check — this queue
    // doubles as that work list AND as the "have we already run the
    // batch-wide gate" flag (see allClearedRoundOne in lib/practice.ts).
    mcqQueueIds: [...studyWordIds],
    mcqWrongIds: [],
    matchingQueueIds: [],
    earnedPuppies: 0,
    earnedUpgrades: {},
  };
  saveDailySession(s);
  return s;
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

// Same one-shot handoff, for "review N extra words" — includes words
// touched today (just-graduated or already-reviewed), unlike the normal
// due-for-review pool.
export function setExtraReviewLimit(n: number): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(EXTRA_REVIEW_KEY, String(n));
}

export function takeExtraReviewLimit(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(EXTRA_REVIEW_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(EXTRA_REVIEW_KEY);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// --- Reset ---

export function clearAllProgress(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEYS.progress);
  localStorage.removeItem(KEYS.streak);
  localStorage.removeItem(KEYS.dailyStats);
  localStorage.removeItem(KEYS.studyBatch);
  localStorage.removeItem(KEYS.dailySession);
}
