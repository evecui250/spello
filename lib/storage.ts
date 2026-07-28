'use client';

import { Level, LEVEL_ORDER } from './words';

// Round 5 was removed — completing round 4 (full recall, no hints) once is
// now the pass condition, both for a word's first climb in Study and for a
// Review episode. See lib/practice.ts's requestHint for the "give me more
// hints" demotion path (round 1 has nowhere lower to go).
export type Round = 1 | 2 | 3 | 4;
export const MAX_ROUND: Round = 4;

// The 4-stage dachshund mascot — a word's progress through the fixed
// review schedule (see lib/srs.ts's REVIEW_PLAN/OFFSET_AFTER_STAGE).
export type MascotStageId = 'puppy' | 'short' | 'medium' | 'long-crowned';

export interface WordProgress {
  id: string;
  round: Round;        // current rung on the 1-4 ladder
  studiedTimes: number; // total milestone passes (1-4) — "earned" signal for
                         // Word List/Stats/congrats card
  fullyMastered: boolean; // kept in sync with mascotStage === 'long-crowned'
  lastPracticed?: string;

  // successfulReviews mirrors studiedTimes (both incremented together on
  // every milestone pass) — kept as a separate field for sync/back-compat
  // smoothness with existing remote data, not because it means anything
  // studiedTimes doesn't.
  successfulReviews: number;
  lastReviewedAt?: string;    // date of the last milestone pass
  nextReviewDue?: string;     // date this word's next review becomes due;
                               // undefined once fullyMastered (retired)
  // undefined = hasn't finished Day 1 (introduction) yet — this is the
  // load-bearing signal buildStudyWords/buildReviewWords key off. Set (and
  // never cleared) the moment round 2 first passes; advances one stage per
  // review milestone thereafter. See lib/srs.ts's recordMilestonePass.
  mascotStage?: MascotStageId;

  // Set once, the first time the learner translates round-1's AI-generated
  // English sentence and it comes back AI-corrected (see lib/ai.ts's
  // correctSentence). Shown on the Word List, and re-shown (word blanked
  // out) on rounds 2-4/review as an extra recall cue — never touches
  // scoring. englishPrompt is the original English sentence they translated
  // (absent for A1 bootstrap words, which skip the sentence exercise
  // entirely — see isBootstrapCopyWord).
  exampleSentence?: { sentence: string; wordForm: string; englishPrompt?: string };
}

export interface Streak {
  lastDate: string;
  count: number;
}

export interface Settings {
  studyBatchSize: number;
  dailyReview: number;
  language: string;
  level: Level;
  autoPlayAudio: boolean;
  requireArticle: boolean;
}

// Every one of these is per-level storage: switching level in Settings is a
// full profile switch — separate progress, streak, daily stats/session, and
// pace settings, with zero interference between levels. Only onboarding and
// the "which level is active" pointer itself are level-independent.
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

const ACTIVE_LEVEL_KEY = 'wb2_active_level';
const MIGRATION_FLAG = 'wb2_migrated_per_level_v1';
const B2_RENAME_FLAG = 'wb2_migrated_b2_to_b2_old_v1';
const ROUND5_REMOVAL_FLAG = 'wb2_migrated_round5_removal_v1';
// Deliberately NOT level-namespaced — a lifetime count of calendar days on
// which ANY level's study or review goal was completed. Switching levels
// doesn't reset or affect it.
const GOAL_DAYS_KEY = 'wb2_goal_days_total';

const DEFAULT_SETTINGS: Settings = {
  studyBatchSize: 15, dailyReview: 25, language: 'de', level: 'A1',
  autoPlayAudio: true, requireArticle: false,
};

// One-time move of pre-level-split data (flat keys, always implicitly the
// original B2 import) into the 'B2_old' namespace, so existing progress/
// streak/settings survive the switch to per-level storage instead of
// silently vanishing. Idempotent — guarded by MIGRATION_FLAG so it only ever
// runs once per browser.
function migrateLegacyKeysToB2(): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  const legacyToNamespaced: [string, string][] = [
    ['wb2_progress', namespacedKey(KEYS.progress, 'B2_old')],
    ['wb2_streak', namespacedKey(KEYS.streak, 'B2_old')],
    ['wb2_settings', namespacedKey(KEYS.settings, 'B2_old')],
    ['wb2_settings_updated_at', namespacedKey(KEYS.settingsUpdatedAt, 'B2_old')],
    ['wb2_daily_stats', namespacedKey(KEYS.dailyStats, 'B2_old')],
    ['wb2_study_batch', namespacedKey(KEYS.studyBatch, 'B2_old')],
    ['wb2_daily_session', namespacedKey(KEYS.dailySession, 'B2_old')],
  ];
  for (const [oldKey, newKey] of legacyToNamespaced) {
    const val = localStorage.getItem(oldKey);
    if (val !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, val);
    }
  }
  if (!localStorage.getItem(ACTIVE_LEVEL_KEY)) {
    localStorage.setItem(ACTIVE_LEVEL_KEY, 'B2_old');
  }
  localStorage.setItem(MIGRATION_FLAG, '1');
}

// One-time rename for anyone who already adopted the per-level split back
// when the original import was still called 'B2' (before its source PDF
// turned out to be the wrong wordlist and it was set aside as 'B2_old') —
// renames every `__B2`-suffixed key to `__B2_old` and remaps the active-level
// pointer, so their real progress on it isn't orphaned under a dead level.
function migrateB2ToB2Old(): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(B2_RENAME_FLAG)) return;
  const bases = [
    KEYS.progress, KEYS.streak, KEYS.settings, KEYS.settingsUpdatedAt,
    KEYS.dailyStats, KEYS.studyBatch, KEYS.dailySession,
  ];
  for (const base of bases) {
    const oldKey = `${base}__B2`;
    const newKey = `${base}__B2_old`;
    const val = localStorage.getItem(oldKey);
    if (val !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, val);
      localStorage.removeItem(oldKey);
    }
  }
  for (const base of [EXTRA_STUDY_KEY, EXTRA_REVIEW_KEY]) {
    const oldKey = `${base}__B2`;
    const val = sessionStorage.getItem(oldKey);
    if (val !== null) {
      sessionStorage.setItem(`${base}__B2_old`, val);
      sessionStorage.removeItem(oldKey);
    }
  }
  if (localStorage.getItem(ACTIVE_LEVEL_KEY) === 'B2') {
    localStorage.setItem(ACTIVE_LEVEL_KEY, 'B2_old');
  }
  localStorage.setItem(B2_RENAME_FLAG, '1');
}

// One-time fix for a data-migration edge case from removing round 5: a word
// that was mid-climb at round 4 under the OLD 5-round system (promoted
// there, but not yet tested/passed at the old round 5) suddenly looked
// "already at the new ceiling" once MAX_ROUND dropped to 4 — silently
// excluded from the study queue as if already done, without ever actually
// passing through recordRound4Success. That left it invisible to review
// forever (buildReviewWords requires successfulReviews >= 1) despite still
// counting toward that day's "words learned" tally (which just counts the
// batch, not genuine passes). Demotes any such orphaned record one round so
// it naturally re-enters the queue and gets a real round-4 test next time.
function migrateOrphanedRound4(): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(ROUND5_REMOVAL_FLAG)) return;
  for (const level of LEVEL_ORDER) {
    const key = namespacedKey(KEYS.progress, level);
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as Record<string, Partial<WordProgress>>;
      let changed = false;
      for (const id of Object.keys(data)) {
        const p = data[id];
        if ((p.round ?? 1) >= MAX_ROUND && !p.fullyMastered && (p.successfulReviews ?? 0) === 0) {
          data[id] = { ...p, round: (MAX_ROUND - 1) as Round };
          changed = true;
        }
      }
      if (changed) localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Malformed record — leave untouched, same as every other place that
      // parses this key defensively.
    }
  }
  localStorage.setItem(ROUND5_REMOVAL_FLAG, '1');
}

// Raw key name, not a namespaced one — avoids infinite recursion through
// namespacedKey's own migration call.
function namespacedKey(base: string, level: Level): string {
  return `${base}__${level}`;
}

export function getActiveLevel(): Level {
  if (typeof window === 'undefined') return 'A1';
  migrateLegacyKeysToB2();
  migrateB2ToB2Old();
  migrateOrphanedRound4();
  return (localStorage.getItem(ACTIVE_LEVEL_KEY) as Level) || 'A1';
}

// Always runs migration first, regardless of whether `level` is passed
// explicitly — callers like isOnboardingDone() read a specific level's key
// before anything has called getActiveLevel() yet.
function levelKey(base: string, level?: Level): string {
  migrateLegacyKeysToB2();
  migrateB2ToB2Old();
  migrateOrphanedRound4();
  return namespacedKey(base, level ?? getActiveLevel());
}

// Switches the active profile and returns that level's own settings (or
// fresh defaults, if this level has never been used before) — the entry
// point for "log into a different level" from the Settings level selector.
export function switchToLevel(level: Level): Settings {
  if (typeof window !== 'undefined') {
    migrateLegacyKeysToB2();
    migrateB2ToB2Old();
    migrateOrphanedRound4();
    localStorage.setItem(ACTIVE_LEVEL_KEY, level);
  }
  return getSettings();
}

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

// --- Lifetime goal-days counter (level-independent) ---
// A running total of calendar days on which the user finished at least one
// goal (study or review) in ANY level — unlike the per-level streak, this
// never resets and isn't affected by which level is active.

interface GoalDaysRecord {
  count: number;
  lastCountedDate: string;
}

// One-time backfill for anyone adopting this counter after already having
// practice history: approximates "days a goal was completed" as distinct
// calendar days (across every level) on which at least one word was
// successfully reviewed — not a perfect record of "the full daily goal was
// finished" (that was never tracked per-day historically), but a reasonable
// stand-in so an existing user's count doesn't start back at zero.
function backfillGoalDaysFromHistory(): GoalDaysRecord {
  const days = new Set<string>();
  for (const level of LEVEL_ORDER) {
    const progress = getAllProgressForLevel(level);
    for (const id of Object.keys(progress)) {
      const lastReviewedAt = progress[id].lastReviewedAt;
      if (lastReviewedAt) days.add(lastReviewedAt);
    }
  }
  const t = today();
  return { count: days.size, lastCountedDate: days.has(t) ? t : '' };
}

function getGoalDaysRecord(): GoalDaysRecord {
  if (typeof window === 'undefined') return { count: 0, lastCountedDate: '' };
  const raw = localStorage.getItem(GOAL_DAYS_KEY);
  if (raw === null) {
    const backfilled = backfillGoalDaysFromHistory();
    localStorage.setItem(GOAL_DAYS_KEY, JSON.stringify(backfilled));
    return backfilled;
  }
  try {
    return JSON.parse(raw) ?? { count: 0, lastCountedDate: '' };
  } catch {
    return { count: 0, lastCountedDate: '' };
  }
}

// At most one increment per calendar day, no matter how many goals (across
// however many levels) get completed that day.
function touchGoalDaysCounter(): void {
  if (typeof window === 'undefined') return;
  const rec = getGoalDaysRecord();
  const t = today();
  if (rec.lastCountedDate === t) return;
  localStorage.setItem(GOAL_DAYS_KEY, JSON.stringify({ count: rec.count + 1, lastCountedDate: t }));
}

export function getTotalGoalDays(): number {
  return getGoalDaysRecord().count;
}

// --- Progress ---

export function getAllProgress(): Record<string, WordProgress> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(levelKey(KEYS.progress)) || '{}');
    const normalized: Record<string, WordProgress> = {};
    for (const id of Object.keys(raw)) {
      normalized[id] = normalizeProgress(id, raw[id]);
    }
    return normalized;
  } catch {
    return {};
  }
}

// Fills in defaults for any progress record saved under an older schema,
// and grandfathers existing in-flight words into the fixed review schedule
// (see lib/srs.ts) that replaced the old mastery-score formula.
function normalizeProgress(id: string, p: Partial<WordProgress> | undefined): WordProgress {
  const successfulReviews = p?.successfulReviews ?? p?.studiedTimes ?? 0;
  const fullyMastered = p?.fullyMastered ?? false;
  // Only a record that actually earned a stage under either the old or new
  // system carries one forward — no default-to-'puppy' here, since that
  // would wrongly make a word still mid-introduction (round 1/2, no stage
  // yet) look review-eligible to buildReviewWords.
  const mascotStage = p?.mascotStage ?? (fullyMastered ? 'long-crowned' : undefined);
  // Grandfathering: a word already past introduction (has a stage) but with
  // no next-review date, or one that's already overdue, becomes due today
  // instead of trying to reverse-engineer a historical schedule — the exact
  // same "meet it where it is" treatment an overdue review already gets.
  // A genuinely future-dated old-schedule date is left alone (avoids
  // dumping a huge backlog on a long-time user's first post-migration day).
  let nextReviewDue = p?.nextReviewDue;
  if (mascotStage && mascotStage !== 'long-crowned' && (!nextReviewDue || nextReviewDue < today())) {
    nextReviewDue = today();
  }
  if (mascotStage === 'long-crowned') nextReviewDue = undefined;
  return {
    id,
    round: (p?.round as Round) ?? 1,
    studiedTimes: p?.studiedTimes ?? successfulReviews,
    fullyMastered,
    lastPracticed: p?.lastPracticed,
    successfulReviews,
    lastReviewedAt: p?.lastReviewedAt ?? p?.lastPracticed,
    nextReviewDue,
    mascotStage,
    exampleSentence: p?.exampleSentence,
  };
}

export function saveAllProgress(data: Record<string, WordProgress>): void {
  localStorage.setItem(levelKey(KEYS.progress), JSON.stringify(data));
}

// Level-parameterized variants, for sync.ts — it needs to read/write every
// level's data in one pass (to keep each level's cloud backup separate too),
// not just whatever's currently active.
export function getAllProgressForLevel(level: Level): Record<string, WordProgress> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = JSON.parse(localStorage.getItem(levelKey(KEYS.progress, level)) || '{}');
    const normalized: Record<string, WordProgress> = {};
    for (const id of Object.keys(raw)) {
      normalized[id] = normalizeProgress(id, raw[id]);
    }
    return normalized;
  } catch {
    return {};
  }
}

export function saveAllProgressForLevel(level: Level, data: Record<string, WordProgress>): void {
  localStorage.setItem(levelKey(KEYS.progress, level), JSON.stringify(data));
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
    return JSON.parse(localStorage.getItem(levelKey(KEYS.streak)) || '{"lastDate":"","count":0}');
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
  localStorage.setItem(levelKey(KEYS.streak), JSON.stringify(s));
}

export function getStreakForLevel(level: Level): Streak {
  if (typeof window === 'undefined') return { lastDate: '', count: 0 };
  try {
    return JSON.parse(localStorage.getItem(levelKey(KEYS.streak, level)) || '{"lastDate":"","count":0}');
  } catch {
    return { lastDate: '', count: 0 };
  }
}

export function saveStreakForLevel(level: Level, s: Streak): void {
  localStorage.setItem(levelKey(KEYS.streak, level), JSON.stringify(s));
}

// --- Settings ---

export function getSettings(): Settings {
  return getSettingsForLevel(getActiveLevel());
}

export function getSettingsForLevel(level: Level): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(levelKey(KEYS.settings, level)) || 'null');
    // `level` always wins over whatever's in storage — it's the namespace
    // this record was read from, so it can never legitimately disagree.
    return { ...DEFAULT_SETTINGS, ...raw, level };
  } catch {
    return { ...DEFAULT_SETTINGS, level };
  }
}

// Persists this level's settings AND makes that level the active profile —
// the two are the same action for a local edit, since "save settings for
// level X" only makes sense if X is what's currently being edited.
export function saveSettings(s: Settings): void {
  if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_LEVEL_KEY, s.level);
  saveSettingsForLevel(s.level, s);
}

// Same, but WITHOUT touching the active-level pointer — for sync.ts, which
// writes every level's settings on a pull and must never let that silently
// switch which profile the user is currently on.
export function saveSettingsForLevel(level: Level, s: Settings): void {
  localStorage.setItem(levelKey(KEYS.settings, level), JSON.stringify(s));
  localStorage.setItem(levelKey(KEYS.settingsUpdatedAt, level), new Date().toISOString());
}

// When this level's settings last changed on this device — lets a remote
// sync pull decide whether its copy is actually newer before overwriting a
// local edit (see sync.ts's pullAndMerge, compared per level).
export function getSettingsUpdatedAtForLevel(level: Level): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(levelKey(KEYS.settingsUpdatedAt, level)) || '';
}

// --- Onboarding ---
// Whether a first-time visitor has been through the welcome/setup page yet.
// Level-independent — onboarding is a whole-app, one-time intro, not
// something a level switch should ever re-trigger.

export function isOnboardingDone(): boolean {
  if (typeof window === 'undefined') return true;
  if (localStorage.getItem(KEYS.onboardingDone) === '1') return true;
  // Grandfather in anyone who already has settings or progress saved from
  // before this feature (or the per-level split) existed — don't send
  // existing users to onboarding just because migration renamed their keys.
  if (localStorage.getItem(levelKey(KEYS.settings, 'B2_old')) !== null
    || localStorage.getItem(levelKey(KEYS.progress, 'B2_old')) !== null) {
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
  studiedCount: number;   // words brought to round 4 today, across all rounds (main + any extras)
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
    const raw = JSON.parse(localStorage.getItem(levelKey(KEYS.dailyStats)) || 'null') as Partial<DailyStats> | null;
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
  localStorage.setItem(levelKey(KEYS.dailyStats), JSON.stringify(stats));
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

// Called exactly when the congrats card is actually reached (both today's
// study and review goals done, or there was genuinely nothing to do for
// one of them) — this, not either individual goal, is what counts as
// "finished the day's goal" for the lifetime goal-days counter.
export function markCongratsShown(): void {
  const stats = getDailyStats();
  stats.congratsShown = true;
  saveDailyStats(stats);
  touchGoalDaysCounter();
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

// --- Today's single merged daily session ---
// One guided flow per day: study the day's new words (with the round-1.5
// translation-choice checkpoint woven in), a matching-quiz recap, then the
// same for review. `phase` + the queues below capture exactly where the user
// left off, so navigating away and coming back (even the next day, in which
// case a fresh session simply gets started) resumes cleanly. Naturally
// invalidated once the date rolls over, same pattern as DailyStats.
export type SessionPhase =
  | 'study-rounds' | 'study-matching'
  | 'study-done'
  | 'review-mcq' | 'review-rounds'
  | 'report'
  | 'congrats'
  | 'done';

export interface DailySession {
  date: string;
  phase: SessionPhase;
  studyWordIds: string[];
  reviewWordIds: string[];
  // Set once every study word has finished round 1 (the sentence exercise)
  // and the mid-Day-1 matching quiz has run — keeps it from firing twice if
  // the session is resumed mid-round-2.
  studyMatchingDone: boolean;
  // Every review-eligible word gets this "what does this word mean?"
  // reminder before its round-ladder continuation, regardless of which
  // milestone (1st/2nd/3rd review) it's on — drained one word at a time
  // regardless of right/wrong (no retry loop, it's a reminder not a gate).
  reviewMcqQueueIds: string[];
  matchingQueueIds: string[]; // which page comes next in the matching quiz
  // The exact in-session order of the study/review round-ladder queue,
  // updated every time it changes (a wrong answer requeues a word to the
  // back). Undefined means "not entered yet this session" — enterRoundsPhase
  // then builds it fresh from studyWordIds/reviewWordIds. Without this,
  // quitting mid-round and coming back would recompute the queue from
  // scratch in original list order, landing on a different word than
  // whichever one was actually on screen when the learner left.
  studyQueueIds?: string[];
  reviewQueueIds?: string[];
  earnedPuppies: number;
  earnedUpgrades: Partial<Record<MascotStageId, number>>;
  isExtra: boolean; // true for a "Study more"/"Review more" bonus round, so
                     // Home keeps showing "Study more" (not "Start") if the
                     // user quits mid-round and comes back.
}

export function getDailySession(): DailySession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(levelKey(KEYS.dailySession)) || 'null') as DailySession | null;
    if (raw && raw.date === today()) return raw;
    return null;
  } catch {
    return null;
  }
}

export function saveDailySession(s: DailySession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(levelKey(KEYS.dailySession), JSON.stringify(s));
}

export function startDailySession(studyWordIds: string[], reviewWordIds: string[], isExtra = false): DailySession {
  // Every review-eligible word gets the pre-review "what does this word
  // mean?" reminder, regardless of which milestone (1st/2nd/3rd review)
  // it's on — computed up front so it's also what decides the initial
  // phase below when there's nothing to study today.
  const reviewMcqQueueIds = [...reviewWordIds];

  const s: DailySession = {
    date: today(),
    // 'report' is the universal fallback when there's nothing to study AND
    // nothing to review — it renders nothing (0 upgrades) and immediately
    // cascades into 'congrats', so the streak/congrats bookkeeping still
    // goes through the one code path that owns it.
    phase: studyWordIds.length > 0 ? 'study-rounds'
      : reviewMcqQueueIds.length > 0 ? 'review-mcq'
      : reviewWordIds.length > 0 ? 'review-rounds' : 'report',
    studyWordIds,
    reviewWordIds,
    studyMatchingDone: false,
    reviewMcqQueueIds,
    matchingQueueIds: [],
    earnedPuppies: 0,
    earnedUpgrades: {},
    isExtra,
  };
  saveDailySession(s);
  return s;
}

// A one-shot "study N extra words" request from the Home page, consumed by
// the next study session. Session-scoped so a stale value can't linger.
export function setExtraStudyLimit(n: number): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(levelKey(EXTRA_STUDY_KEY), String(n));
}

export function takeExtraStudyLimit(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(levelKey(EXTRA_STUDY_KEY));
  if (raw === null) return null;
  sessionStorage.removeItem(levelKey(EXTRA_STUDY_KEY));
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Same one-shot handoff, for "review N extra words" — includes words
// touched today (just-graduated or already-reviewed), unlike the normal
// due-for-review pool.
export function setExtraReviewLimit(n: number): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(levelKey(EXTRA_REVIEW_KEY), String(n));
}

export function takeExtraReviewLimit(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(levelKey(EXTRA_REVIEW_KEY));
  if (raw === null) return null;
  sessionStorage.removeItem(levelKey(EXTRA_REVIEW_KEY));
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// --- Reset ---

export function clearAllProgress(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(levelKey(KEYS.progress));
  localStorage.removeItem(levelKey(KEYS.streak));
  localStorage.removeItem(levelKey(KEYS.dailyStats));
  localStorage.removeItem(levelKey(KEYS.studyBatch));
  localStorage.removeItem(levelKey(KEYS.dailySession));
}
