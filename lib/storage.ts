'use client';

import { Level, LEVEL_ORDER, Word, WORDS } from './words';

// Round 5 was removed — completing round 4 (full recall, no hints) once is
// now the pass condition, both for a word's first climb in Study and for a
// Review episode. See lib/practice.ts's requestHint for the "give me more
// hints" demotion path (round 1 has nowhere lower to go).
// Round 3 (first-letter-only hint) was removed entirely (owner call): every
// exercise that used to sit at round 3 is now either a batch MCQ/MCQ_reversed
// checkpoint or has been folded into round 2/4 directly — see lib/srs.ts's
// REVIEW_PLAN and lib/practice.ts's applyReviewResult for the full schedule.
// A handful of pre-existing WordProgress/session records may still carry a
// literal `3` from before this changed; those are treated as round 2 the
// moment they're read (see the migration in getWordProgress/normalizeProgress).
export type Round = 1 | 2 | 4;
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
  // entirely — see isBootstrapCopyWord). englishPromptZh is that same
  // prompt's Chinese translation, captured at save time (either the
  // corpus's own pre-baked exercisePromptZh, or the AI's live sentenceZh
  // for a word without one) — without saving this alongside englishPrompt,
  // any later display of this saved sentence would have to re-derive a
  // Chinese version from the word's own corpus data, which silently falls
  // back to English for any word missing that field, mixing languages on
  // an otherwise all-Chinese summary/list.
  // `at`: ISO timestamp of when this was set -- powers the Mistake
  // Notebook's "latest to oldest" ordering, which lastPracticed (date-only)
  // can't express on its own (multiple words redone the same day would
  // otherwise have no real ordering between them).
  exampleSentence?: { sentence: string; wordForm: string; englishPrompt?: string; englishPromptZh?: string; at?: string };

  // Set whenever round 1's translation correction comes back NOT perfect
  // (see DailySessionFlow's diffAgainstAttempt check) — the "Mistake
  // Notebook" (Word List's own "Needs practice" filter) surfaces these so
  // a learner can redo the EXACT SAME prompt rather than a fresh random
  // one. Cleared the moment a redo of this word comes back perfect (owner
  // call: reflects CURRENT weak points, not a permanent record of every
  // mistake ever made) — see MistakeRedoCard. userInput is the learner's
  // own wrong attempt, kept so the redo view can show what they wrote
  // last time alongside the correction, same as the in-session correction
  // screen already does.
  lastMistake?: { englishPrompt?: string; englishPromptZh?: string; userInput: string; correctedSentence: string; wordForm: string; at?: string };

  // Article mastery (der/die/das), tracked separately from word mastery
  // above -- a word can be fully learned/mastered (mascotStage set, even
  // fullyMastered) and still have its article wrong, which is exactly
  // what Artikel Blitz and the Mistake Notebook's Articles tab need to
  // know. articleMistake present = an active, unresolved mistake (shows
  // in the notebook); cleared (deleted) once articleRecallStreak reaches
  // 2 correct recalls in a row since it was set -- see lib/practice.ts's
  // recordArticleMistake/recordArticleRecall, the only two places that
  // should ever touch these three fields. articleMistakeCount is a
  // lifetime count, NEVER reset by clearing -- keeps historical stats
  // even after the active mistake is gone.
  articleMistake?: { at: string };
  articleRecallStreak?: number;
  articleMistakeCount?: number;
}

export interface Streak {
  lastDate: string;
  count: number;
}

export interface Settings {
  studyBatchSize: number;
  dailyReview: number;
  language: string;
  // Which language word meanings/exercise prompts are shown in — a
  // separate axis from `language` above (which is the language BEING
  // learned, currently always 'de'). See lib/words.ts's glossFor().
  nativeLanguage: 'en' | 'zh';
  level: Level;
  autoPlayAudio: boolean;
  // How many times in a row speakWord() says a word — default 1, a real
  // request from learners who want to hear a tricky word repeated without
  // tapping the speaker icon over and over. Optional (old stored settings
  // predate this field) — getSettings/getSettingsForLevel's own
  // {...DEFAULT_SETTINGS, ...raw} merge already backfills it to 1 for
  // anyone who saved settings before this existed.
  wordRepeatCount?: number;
  requireArticle: boolean;
  // When true (default), round 1 of a new word is the AI sentence-writing
  // exercise as usual. When false, round 1 instead uses the same
  // copy-the-word mechanic as A1's bootstrap words, with a correct example
  // sentence fetched and shown alongside purely as reference — no writing
  // required. See DailySessionFlow's useDirectSentence.
  sentenceWritingMode: boolean;
  // One-time flag: has this A1 profile already seen the "you've unlocked
  // AI sentence writing" celebration (shown the first time a round-1 word
  // isn't one of the ~220 bootstrap words — see isBootstrapCopyWord)? Lives
  // in Settings (not a separate storage key) specifically so it syncs like
  // everything else here — a signed-in learner who's seen it on one device
  // shouldn't see it again on another.
  hasSeenAiUnlockCelebration?: boolean;
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
  customWords: 'wb2_custom_words',
};

const ACTIVE_LEVEL_KEY = 'wb2_active_level';
const ROUND5_REMOVAL_FLAG = 'wb2_migrated_round5_removal_v1';
// Deliberately NOT level-namespaced — a lifetime count of calendar days on
// which ANY level's study or review goal was completed. Switching levels
// doesn't reset or affect it.
const GOAL_DAYS_KEY = 'wb2_goal_days_total';
// A day where only ONE of study/review got done, not both — the Progress
// page's activity calendar shows these as a fainter mark, distinct from a
// full goal_days day. Same level-independent, date-set shape/reasoning as
// GOAL_DAYS_KEY; kept as a fully separate record (rather than derived from
// DailyStats) because DailyStats only ever holds TODAY's numbers — nothing
// here would survive past midnight otherwise. A date can appear in this
// set and LATER also complete the full goal the same day (e.g. review
// first, study afterward) — it simply stays in both sets; the calendar
// always prefers goal_days (full) over this one when a date is in both,
// so being in both never downgrades a genuinely full day.
const PARTIAL_DAYS_KEY = 'wb2_partial_days_total';

// Per-day word-activity log, for the Progress page calendar's tap-a-date
// popup — deliberately a real log (date -> word ids touched that day),
// NOT derived from WordProgress's own lastPracticed/lastReviewedAt/
// mascotStage fields the way an earlier version of this feature tried to.
// Those fields only ever hold each word's SINGLE latest date/stage, so
// looking back at an OLD date after a word has since been touched AGAIN
// silently loses it from that day entirely (the earlier date gets
// overwritten, not appended to) — confirmed real: a genuinely full
// (goal-met) day showed as "no activity" once its words were reviewed
// again later. This log is append-only per day instead, so it stays
// accurate for every day going forward regardless of what happens to a
// word afterward. Can't retroactively fix history from before this
// shipped, same limitation every other backfilled record here has.
const DAILY_WORD_LOG_KEY = 'wb2_daily_word_log';
// Caps how long entries are kept, purely to keep this from growing
// forever across years of daily use — 2 years of history is far more
// than the calendar UI (which only ever shows one month at a time) has
// any real use for.
const WORD_LOG_RETENTION_DAYS = 730;

// Also deliberately NOT level-namespaced, for the same reason — completing
// either level's daily goal extends the one shared streak, the same as it
// counts toward the one shared goal-days total above. Used to be per-level
// (a relic of the "every level is its own profile" design), which is
// exactly why it could read differently depending on which level happened
// to be active, and even show a streak the goal-days count didn't yet
// reflect.
const STREAK_KEY = 'wb2_streak_global';

const DEFAULT_SETTINGS: Settings = {
  studyBatchSize: 5, dailyReview: 15, language: 'de', nativeLanguage: 'en', level: 'A1',
  autoPlayAudio: true, requireArticle: false, sentenceWritingMode: true, wordRepeatCount: 1,
};

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

const ORPHANED_LEVEL_PROGRESS_FLAG = 'wb2_migrated_orphan_progress_v1';

// A curated word's `level` field isn't permanently fixed — every A1/A2/B1
// expansion retagged existing B2 words in place (same id, corrected
// level — see the word-corpus-schema notes on that history). A word
// studied BEFORE its own retag left its lastMistake/exampleSentence
// filed under the OLD level's progress bucket, which no longer contains
// that word at all once retagged — invisible to the Mistake Notebook
// (which only shows words actually IN the current level's list) even
// though a raw progress scan still finds the record. That's exactly the
// "Home says 1 to redo, the page shows nothing" bug a real report caught
// (word w2202, "versorgen", now B2, with a stray lastMistake still filed
// under A1's own progress bucket). Drops (doesn't migrate forward) any
// such orphan: the record's own English prompt/corrected sentence may
// not even match what that word would generate today under its new
// level, so silently moving it into a different book's notebook would be
// a more confusing surprise than just dropping one stale entry. Custom
// (learner-added) words are never affected — they're absent from WORDS
// entirely, so levelById.get() returns undefined and the check no-ops.
function migrateOrphanedLevelProgress(): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(ORPHANED_LEVEL_PROGRESS_FLAG)) return;
  const levelById = new Map(WORDS.map(w => [w.id, w.level]));
  for (const level of LEVEL_ORDER) {
    const key = namespacedKey(KEYS.progress, level);
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as Record<string, WordProgress>;
      let changed = false;
      for (const id of Object.keys(data)) {
        const actualLevel = levelById.get(id);
        if (actualLevel && actualLevel !== level && (data[id].lastMistake || data[id].exampleSentence)) {
          const { lastMistake, exampleSentence, ...rest } = data[id];
          data[id] = rest;
          changed = true;
        }
      }
      if (changed) localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Malformed record — leave untouched, same as every other place that
      // parses this key defensively.
    }
  }
  localStorage.setItem(ORPHANED_LEVEL_PROGRESS_FLAG, '1');
}

const MISFILED_CUSTOM_WORDS_FLAG = 'wb2_migrated_misfiled_custom_words_v1';

// One-time repair for words added before addCustomWord's own fix (see its
// comment): a custom word whose `level` field says e.g. 'B2' but was
// actually filed under a different level's storage bucket (whichever
// level happened to be active at add-time) — invisible when browsing its
// claimed book, silently surfaced during the wrong level's study/review
// instead. Relocates both the word entry AND any progress already
// recorded against it (moving only the word and leaving progress behind
// would make real study history vanish the moment the word lands in its
// correct book) to the bucket its own `level` field actually claims.
function migrateMisfiledCustomWords(): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(MISFILED_CUSTOM_WORDS_FLAG)) return;
  for (const storedUnderLevel of LEVEL_ORDER) {
    const wordsKey = namespacedKey(KEYS.customWords, storedUnderLevel);
    const rawWords = localStorage.getItem(wordsKey);
    if (!rawWords) continue;
    let words: Record<string, Word>;
    try {
      words = JSON.parse(rawWords);
    } catch {
      continue;
    }
    let changed = false;
    for (const [id, word] of Object.entries(words)) {
      const claimedLevel = word.level;
      if (!claimedLevel || claimedLevel === storedUnderLevel || !LEVEL_ORDER.includes(claimedLevel)) continue;

      delete words[id];
      changed = true;

      const targetKey = namespacedKey(KEYS.customWords, claimedLevel);
      const targetWords = JSON.parse(localStorage.getItem(targetKey) || '{}') as Record<string, Word>;
      targetWords[id] = word;
      localStorage.setItem(targetKey, JSON.stringify(targetWords));

      const progressKey = namespacedKey(KEYS.progress, storedUnderLevel);
      const progressData = JSON.parse(localStorage.getItem(progressKey) || '{}') as Record<string, WordProgress>;
      if (progressData[id]) {
        const movedProgress = progressData[id];
        delete progressData[id];
        localStorage.setItem(progressKey, JSON.stringify(progressData));
        const targetProgressKey = namespacedKey(KEYS.progress, claimedLevel);
        const targetProgress = JSON.parse(localStorage.getItem(targetProgressKey) || '{}') as Record<string, WordProgress>;
        targetProgress[id] = movedProgress;
        localStorage.setItem(targetProgressKey, JSON.stringify(targetProgress));
      }
    }
    if (changed) localStorage.setItem(wordsKey, JSON.stringify(words));
  }
  localStorage.setItem(MISFILED_CUSTOM_WORDS_FLAG, '1');
}

// Raw key name, not a namespaced one — avoids infinite recursion through
// namespacedKey's own migration call.
function namespacedKey(base: string, level: Level): string {
  return `${base}__${level}`;
}

export function getActiveLevel(): Level {
  if (typeof window === 'undefined') return 'A1';
  migrateOrphanedRound4();
  migrateOrphanedLevelProgress();
  migrateMisfiledCustomWords();
  return (localStorage.getItem(ACTIVE_LEVEL_KEY) as Level) || 'A1';
}

// Always runs migration first, regardless of whether `level` is passed
// explicitly — callers like isOnboardingDone() read a specific level's key
// before anything has called getActiveLevel() yet.
function levelKey(base: string, level?: Level): string {
  migrateOrphanedRound4();
  migrateOrphanedLevelProgress();
  migrateMisfiledCustomWords();
  return namespacedKey(base, level ?? getActiveLevel());
}

// Switches the active profile and returns that level's own settings (or
// fresh defaults, if this level has never been used before) — the entry
// point for "log into a different level" from the Settings level selector.
export function switchToLevel(level: Level): Settings {
  if (typeof window === 'undefined') return getSettingsForLevel(level);
  migrateOrphanedRound4();

  // A level switched to for the first time ever starts from wherever the
  // learner already had their pace/audio/article preferences dialed in,
  // rather than resetting to the app's hardcoded defaults — those are
  // personal-taste settings, not something tied to the vocabulary itself,
  // so there's no reason a new book should feel like starting over on them.
  // A level that's already been configured before (switching back to it)
  // keeps its own saved settings untouched, same as always.
  const isFirstTimeOnThisLevel = localStorage.getItem(levelKey(KEYS.settings, level)) === null;
  const carryOver = isFirstTimeOnThisLevel ? getSettings() : null;

  localStorage.setItem(ACTIVE_LEVEL_KEY, level);
  if (carryOver) {
    const next: Settings = { ...carryOver, level };
    saveSettingsForLevel(level, next);
    return next;
  }
  return getSettings();
}

// The user's LOCAL calendar date — deliberately not toISOString() (which is
// always UTC). Using UTC here meant the app's "today" silently disagreed
// with the user's actual calendar day for part of every day (more of the
// day, the further their timezone sits from UTC), which desynced due-date
// comparisons and could make review-eligible words not show as due, or a
// batch of same-session words land on different scheduled days.
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function today(): string {
  return localDateString(new Date());
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateString(d);
}

// --- Lifetime goal-days counter (level-independent) ---
// A running total of calendar days on which the user finished at least one
// goal (study or review) in ANY level — unlike the per-level streak, this
// never resets and isn't affected by which level is active.

// Stored as the actual set of dates (not just a count) so syncing across
// devices is an exact set union — a plain running total couldn't be merged
// correctly (device A's 5 days and device B's 3 days might share some
// overlap and are almost never a clean max() of each other), and this was
// never synced at all before, which is exactly why two devices used to
// show different totals for the same account.
interface GoalDaysRecord {
  days: string[];
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
  return { days: [...days].sort() };
}

function getGoalDaysRecord(): GoalDaysRecord {
  if (typeof window === 'undefined') return { days: [] };
  const raw = localStorage.getItem(GOAL_DAYS_KEY);
  if (raw === null) {
    const backfilled = backfillGoalDaysFromHistory();
    localStorage.setItem(GOAL_DAYS_KEY, JSON.stringify(backfilled));
    return backfilled;
  }
  try {
    const parsed = JSON.parse(raw);
    // Grandfather the old {count, lastCountedDate} shape (pre-sync) into an
    // empty set rather than crashing on it — its count is superseded by
    // whatever the next pull brings down anyway (see sync.ts).
    if (!parsed || !Array.isArray(parsed.days)) return { days: [] };
    return parsed;
  } catch {
    return { days: [] };
  }
}

function saveGoalDaysRecord(rec: GoalDaysRecord): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(GOAL_DAYS_KEY, JSON.stringify(rec));
}

// At most one new date per calendar day, no matter how many goals (across
// however many levels) get completed that day.
function touchGoalDaysCounter(): void {
  if (typeof window === 'undefined') return;
  const rec = getGoalDaysRecord();
  const t = today();
  if (rec.days.includes(t)) return;
  saveGoalDaysRecord({ days: [...rec.days, t].sort() });
}

export function getTotalGoalDays(): number {
  return getGoalDaysRecord().days.length;
}

// Level-independent, like the counter itself — sync.ts reads/writes this
// directly to merge each device's date set into a union instead of trusting
// either side's raw count.
export function getGoalDaysRecordForSync(): string[] {
  return getGoalDaysRecord().days;
}

export function mergeGoalDaysFromSync(remoteDays: string[]): void {
  const local = getGoalDaysRecord();
  const merged = new Set([...local.days, ...remoteDays]);
  saveGoalDaysRecord({ days: [...merged].sort() });
}

// See PARTIAL_DAYS_KEY's own comment — same {days: string[]} shape and
// sync-merge treatment as goal days, just tracking "at least one of
// study/review done" instead of "both done".
// One-time backfill, same spirit and same imperfection as
// backfillGoalDaysFromHistory (see its own comment) — this field didn't
// exist before 2026-08-21, so anyone with practice history older than that
// would otherwise see a blank calendar for every one of those days, even
// ones where they demonstrably did something (confirmed real: a genuine
// review-only day from the day before this shipped showed nothing).
// Approximates "some activity happened" as any calendar day (across every
// level) with a lastPracticed/lastReviewedAt date, then excludes whatever's
// already a full goal_days day — not a perfect record of "exactly one of
// study/review, not both" (that distinction was never tracked per-day
// before this), but a reasonable stand-in.
function backfillPartialDaysFromHistory(fullDays: Set<string>): GoalDaysRecord {
  const days = new Set<string>();
  for (const level of LEVEL_ORDER) {
    const progress = getAllProgressForLevel(level);
    for (const id of Object.keys(progress)) {
      const p = progress[id];
      const d = p.lastReviewedAt || p.lastPracticed;
      if (d && !fullDays.has(d)) days.add(d);
    }
  }
  return { days: [...days].sort() };
}

function getPartialDaysRecord(): GoalDaysRecord {
  if (typeof window === 'undefined') return { days: [] };
  const raw = localStorage.getItem(PARTIAL_DAYS_KEY);
  if (raw === null) {
    const backfilled = backfillPartialDaysFromHistory(new Set(getGoalDaysRecord().days));
    localStorage.setItem(PARTIAL_DAYS_KEY, JSON.stringify(backfilled));
    return backfilled;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.days)) return { days: [] };
    return parsed;
  } catch {
    return { days: [] };
  }
}

function savePartialDaysRecord(rec: GoalDaysRecord): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PARTIAL_DAYS_KEY, JSON.stringify(rec));
}

function touchPartialDaysCounter(): void {
  if (typeof window === 'undefined') return;
  const rec = getPartialDaysRecord();
  const t = today();
  if (rec.days.includes(t)) return;
  savePartialDaysRecord({ days: [...rec.days, t].sort() });
}

export function getPartialDaysRecordForSync(): string[] {
  return getPartialDaysRecord().days;
}

export function mergePartialDaysFromSync(remoteDays: string[]): void {
  const local = getPartialDaysRecord();
  const merged = new Set([...local.days, ...remoteDays]);
  savePartialDaysRecord({ days: [...merged].sort() });
}

// The Progress page activity calendar's one read: every full-goal date and
// every partial (one-of-two) date, ready to render. A date present in both
// is a full day — dedupe in favor of full rather than showing it twice or
// letting the caller get that wrong.
export function getActivityCalendarDays(): { full: string[]; partial: string[] } {
  const full = new Set(getGoalDaysRecordForSync());
  const partial = getPartialDaysRecordForSync().filter(d => !full.has(d));
  return { full: [...full], partial };
}

// date -> word ids touched that day. See DAILY_WORD_LOG_KEY's own comment
// for why this is a real log rather than derived from WordProgress.
export type DailyWordLog = Record<string, { learned: string[]; reviewed: string[] }>;

export function getDailyWordLog(): DailyWordLog {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(DAILY_WORD_LOG_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function pruneWordLog(log: DailyWordLog): DailyWordLog {
  const cutoff = localDateString(addDaysToDate(new Date(), -WORD_LOG_RETENTION_DAYS));
  const pruned: DailyWordLog = {};
  for (const [date, entry] of Object.entries(log)) {
    if (date >= cutoff) pruned[date] = entry;
  }
  return pruned;
}

function addDaysToDate(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function saveDailyWordLog(log: DailyWordLog): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DAILY_WORD_LOG_KEY, JSON.stringify(pruneWordLog(log)));
}

// Called right at the moment a word is actually touched (see
// DailySessionFlow's submitResult) — 'learned' for the exact submission
// that completes round-1 introduction (reaches the puppy stage for the
// first time ever), 'reviewed' for every other study/review submission
// that day. Deduped per word per day per kind — answering the same word
// wrong twice today only logs it once.
export function logWordActivity(wordId: string, kind: 'learned' | 'reviewed'): void {
  if (typeof window === 'undefined') return;
  const log = getDailyWordLog();
  const t = today();
  const entry = log[t] ?? { learned: [], reviewed: [] };
  if (!entry[kind].includes(wordId)) entry[kind] = [...entry[kind], wordId];
  saveDailyWordLog({ ...log, [t]: entry });
}

export function getDailyWordLogForSync(): DailyWordLog {
  return getDailyWordLog();
}

// Per-date, per-kind union — same "merge, never let one side's history
// erase the other's" reasoning as mergeGoalDaysFromSync, just one level
// deeper (each date holds two arrays, not a single flag).
export function mergeDailyWordLogFromSync(remote: DailyWordLog): void {
  if (!remote || typeof remote !== 'object') return;
  const local = getDailyWordLog();
  const merged: DailyWordLog = { ...local };
  for (const [date, remoteEntry] of Object.entries(remote)) {
    const localEntry = merged[date] ?? { learned: [], reviewed: [] };
    merged[date] = {
      learned: [...new Set([...localEntry.learned, ...(remoteEntry.learned ?? [])])],
      reviewed: [...new Set([...localEntry.reviewed, ...(remoteEntry.reviewed ?? [])])],
    };
  }
  saveDailyWordLog(merged);
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
  // NO next-review date at all — a real pre-fixed-schedule record — becomes
  // due today instead of trying to reverse-engineer a historical schedule.
  // Deliberately NOT "or one that's already overdue" any more (confirmed
  // real bug: that ran on every single load/getWordProgress call, not
  // once, so a word that simply hadn't been reviewed yet today had its
  // genuinely-overdue date silently rewritten to today, EVERY day it went
  // unreviewed — permanently erasing how overdue it actually was and
  // masking it behind an ever-refreshing "due today" instead. Combined
  // with buildReviewWords sorting same-due-date words by least-mature
  // stage first, this meant a huge, perpetually-regenerating pile of
  // fresher puppy/short words could indefinitely crowd out the smaller
  // number of medium-stage words one review away from being fully
  // mastered — the real explanation behind "0 words mastered" even after
  // weeks of real use. A genuinely overdue date must be left alone: it's
  // exactly the signal buildReviewWords' "most overdue first" sort needs
  // to actually prioritize it.
  let nextReviewDue = p?.nextReviewDue;
  if (mascotStage && mascotStage !== 'long-crowned' && !nextReviewDue) {
    nextReviewDue = today();
  }
  if (mascotStage === 'long-crowned') nextReviewDue = undefined;
  // Migration: round 3 no longer exists (see Round's own comment) — a
  // record written before this changed can still literally have a 3
  // sitting in storage (e.g. a medium-stage word demoted there from a
  // wrong round-4 attempt under the old rules). Remapped to round 2 on
  // read, the same target a fresh round-4 miss lands on now, rather than
  // leaving an impossible value for anything downstream to trip over.
  const rawRound = p?.round as number | undefined;
  const round: Round = rawRound === 3 ? 2 : ((rawRound as Round) ?? 1);
  return {
    id,
    round,
    studiedTimes: p?.studiedTimes ?? successfulReviews,
    fullyMastered,
    lastPracticed: p?.lastPracticed,
    successfulReviews,
    lastReviewedAt: p?.lastReviewedAt ?? p?.lastPracticed,
    nextReviewDue,
    mascotStage,
    // Migration: exampleSentence and lastMistake are meant to be mutually
    // exclusive (see lastMistake's own comment) — a word either shows its
    // real, earned corrected sentence, or stays hidden behind a redo,
    // never both. A record can carry BOTH here if it was written before
    // DailySessionFlow's onCorrected was fixed to only set exampleSentence
    // on a genuinely perfect attempt (it used to set it unconditionally,
    // even on a wrong first attempt) — a real report caught exactly this:
    // the Word List's "Practiced sentences" view was still revealing an
    // old, stale exampleSentence for a word that ALSO had a lastMistake,
    // leaking the answer before a redo. lastMistake (the more recent,
    // more authoritative signal — it's only ever set going forward by the
    // fixed code) wins on read, same one-time self-healing spirit as the
    // round-3 migration below.
    exampleSentence: p?.lastMistake ? undefined : p?.exampleSentence,
    lastMistake: p?.lastMistake,
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

// Ranks how far along a word's own milestone track is — used below to
// pick a winner when the same word id appears in more than one level's
// progress store at once (possible via the cross-level "save for review"
// feature: a word studied natively under its own level can ALSO have a
// "foreign" copy saved into a different level's store).
const MASCOT_STAGE_RANK: Record<MascotStageId, number> = { puppy: 0, short: 1, medium: 2, 'long-crowned': 3 };
function mascotStageRank(p: WordProgress): number {
  return p.mascotStage ? MASCOT_STAGE_RANK[p.mascotStage] : -1;
}

// Merges every level's own separate progress store into one map, keyed by
// word id — the only accurate way to answer "what's my real progress on
// this word", full stop, regardless of which book you happened to study
// it under or which book is active right now. Each level keeps a fully
// isolated local store (see levelKey/namespacedKey above), so naively
// reading only getAllProgress() (the currently active level's store)
// silently hides real progress on any word studied under a DIFFERENT
// level — this is what backs Progress page's "All books" view and Word
// List's "All books" filter, so both agree with each other rather than
// one under-reporting relative to the other.
export function getMergedProgressAcrossLevels(): Record<string, WordProgress> {
  const merged: Record<string, WordProgress> = {};
  for (const level of LEVEL_ORDER) {
    const store = getAllProgressForLevel(level);
    for (const [id, p] of Object.entries(store)) {
      if (!merged[id] || mascotStageRank(p) > mascotStageRank(merged[id])) merged[id] = p;
    }
  }
  return merged;
}

export function getWordProgress(id: string): WordProgress {
  const all = getAllProgress();
  return all[id] ?? normalizeProgress(id, undefined);
}

// Fires on every word-progress or daily-session write — lets a component
// mounted OUTSIDE DailySessionFlow (which owns and re-renders its own
// session state internally) react to live progress without any direct
// coupling to it, e.g. a roadmap sidebar recomputing "how far through
// today" from scratch each time. Same cross-component-update pattern as
// SYNCED_EVENT/THEME_CHANGED_EVENT elsewhere in this app.
export const PROGRESS_CHANGED_EVENT = 'wb2-progress-changed';
function notifyProgressChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PROGRESS_CHANGED_EVENT));
}

export function saveWordProgress(p: WordProgress): void {
  const all = getAllProgress();
  all[p.id] = p;
  saveAllProgress(all);
  notifyProgressChanged();
}

// Level-aware siblings of the two functions above -- needed by anything
// that reads/writes progress for a word pool spanning EVERY level (e.g.
// Artikel Blitz, corpus-wide like WordMatchGame's own word pool), where
// "the active level" isn't necessarily the word's own level. Using
// getWordProgress/saveWordProgress for a word from a different level than
// whichever one is currently active would silently read/write the wrong
// level's store -- either missing that word's real progress entirely, or
// creating a stray duplicate record disconnected from it.
export function getWordProgressForLevel(level: Level, id: string): WordProgress {
  const all = getAllProgressForLevel(level);
  return all[id] ?? normalizeProgress(id, undefined);
}

export function saveWordProgressForLevel(level: Level, p: WordProgress): void {
  const all = getAllProgressForLevel(level);
  all[p.id] = p;
  saveAllProgressForLevel(level, all);
  notifyProgressChanged();
}

// --- Custom words (learner-added vocabulary) ---
//
// A word a learner adds themselves (see app/words/page.tsx's "look up &
// add" flow) is a full, ordinary Word -- same shape as any corpus entry,
// same study/review/hint/MCQ treatment (see lib/practice.ts's
// allWordsForLevel and every call site it feeds) -- just sourced from an
// AI lookup instead of the hand-curated static corpus, and stored
// per-user/per-level here instead of baked into the app bundle at build
// time (Spello ships as a static export with no server of its own, so
// there's nowhere else per-user data COULD live). Keyed by id, exactly
// like progress -- ids are generated by newCustomWordId, always prefixed
// so they can never collide with a static corpus id ("w123") no matter
// how large the corpus grows.
const CUSTOM_WORD_ID_PREFIX = 'custom-';

export function newCustomWordId(): string {
  return `${CUSTOM_WORD_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isCustomWordId(id: string): boolean {
  return id.startsWith(CUSTOM_WORD_ID_PREFIX);
}

export function getAllCustomWords(): Record<string, Word> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(levelKey(KEYS.customWords)) || '{}');
  } catch {
    return {};
  }
}

export function saveAllCustomWords(data: Record<string, Word>): void {
  localStorage.setItem(levelKey(KEYS.customWords), JSON.stringify(data));
}

// Level-parameterized variants, for sync.ts — same reason
// getAllProgressForLevel/saveAllProgressForLevel have them: syncing needs
// every level's own separate store, not just whichever is active locally.
export function getAllCustomWordsForLevel(level: Level): Record<string, Word> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(levelKey(KEYS.customWords, level)) || '{}');
  } catch {
    return {};
  }
}

export function saveAllCustomWordsForLevel(level: Level, data: Record<string, Word>): void {
  localStorage.setItem(levelKey(KEYS.customWords, level), JSON.stringify(data));
}

// Every custom word across every level, flattened — mirrors
// getMergedProgressAcrossLevels' own reasoning (hasEnoughWordsForGame and
// similar cross-level checks need every learner-added word regardless of
// which book it was added under, not just whichever is active right now).
export function getAllCustomWordsAcrossLevels(): Word[] {
  const all: Word[] = [];
  for (const level of LEVEL_ORDER) {
    all.push(...Object.values(getAllCustomWordsForLevel(level)));
  }
  return all;
}

// Files under word.level's OWN bucket -- NOT whichever level happens to be
// active right now. Real, confirmed bug: this used to call the active-
// level getAllCustomWords()/saveAllCustomWords() unconditionally, so a
// word added while browsing/filtering a book other than the currently
// active one (e.g. looked up under the "B2" filter while A1 is the active
// study level) got its `level` field correctly set to 'B2' by the caller,
// but was silently FILED under A1's storage instead -- invisible when
// actually browsing "B2" (allWordsForLevel('B2') reads B2's own bucket),
// and unexpectedly surfaced during A1 study/review instead. See
// migrateMisfiledCustomWords for the one-time repair of words already
// added before this fix.
export function addCustomWord(word: Word): void {
  const all = getAllCustomWordsForLevel(word.level);
  all[word.id] = word;
  saveAllCustomWordsForLevel(word.level, all);
  notifyProgressChanged();
}

// Also drops any progress recorded against it — an abandoned/mistaken add
// shouldn't leave an orphaned progress record behind (nothing else could
// ever reach it again to clean it up once the word itself is gone).
// Searches every level's own bucket for the id (rather than trusting the
// word's own `level` field, or whichever level happens to be active)
// since ids are globally unique (see newCustomWordId's prefix) and a word
// added before the addCustomWord fix above may still be misfiled under a
// different level than its own `level` field claims.
export function removeCustomWord(id: string): void {
  for (const level of LEVEL_ORDER) {
    const words = getAllCustomWordsForLevel(level);
    if (!(id in words)) continue;
    delete words[id];
    saveAllCustomWordsForLevel(level, words);
    const progress = getAllProgressForLevel(level);
    if (progress[id]) {
      delete progress[id];
      saveAllProgressForLevel(level, progress);
    }
    break;
  }
  notifyProgressChanged();
}

// --- Streak (global — see STREAK_KEY) ---

// One-time backfill for anyone with existing per-level streaks from before
// this became global: takes whichever level's streak was furthest along as
// a reasonable starting point, rather than dropping every existing streak
// back to zero. Best-effort, same spirit as backfillGoalDaysFromHistory.
function backfillStreakFromLevels(): Streak {
  let best: Streak = { lastDate: '', count: 0 };
  for (const level of LEVEL_ORDER) {
    try {
      const raw = localStorage.getItem(namespacedKey(KEYS.streak, level));
      if (!raw) continue;
      const s: Streak = JSON.parse(raw);
      if (s.count > best.count) best = s;
    } catch {
      // skip a corrupt legacy entry
    }
  }
  return best;
}

export function getStreak(): Streak {
  if (typeof window === 'undefined') return { lastDate: '', count: 0 };
  const raw = localStorage.getItem(STREAK_KEY);
  let s: Streak;
  if (raw === null) {
    s = backfillStreakFromLevels();
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  } else {
    try {
      s = JSON.parse(raw) ?? { lastDate: '', count: 0 };
    } catch {
      s = { lastDate: '', count: 0 };
    }
  }
  // A streak only stays alive through today or yesterday — any older
  // lastDate means at least one full day was missed entirely, so it reads
  // as broken (0) right now rather than waiting for the next touchStreak()
  // call to silently correct it (which only happens once the user next
  // completes a goal — until then, the stale nonzero count kept showing).
  // lastDate itself is left untouched (not persisted here) since
  // touchStreak still needs the real value to tell "resuming after exactly
  // a 1-day gap" (count + 1) apart from "resuming after 2+ days" (reset to 1).
  if (s.lastDate !== today() && s.lastDate !== yesterday()) {
    return { lastDate: s.lastDate, count: 0 };
  }
  return s;
}

export function touchStreak(): void {
  const t = today();
  const s = getStreak();
  if (s.lastDate === t) return;
  const newCount = s.lastDate === yesterday() ? s.count + 1 : 1;
  saveStreak({ lastDate: t, count: newCount });
}

export function saveStreak(s: Streak): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STREAK_KEY, JSON.stringify(s));
}

// --- Theme (the app's background/decoration style — a purely visual,
// per-device preference, deliberately NOT level-namespaced (switching
// levels shouldn't change what the app looks like) and NOT synced (unlike
// settings/progress, there's no real expectation that two devices signed
// into the same account share the same background choice). ---
export type Theme = 'forest' | 'stellar' | 'ocean' | 'lavender' | 'sunset' | 'ember' | 'citrus' | 'meadow' | 'bubblegum' | 'vanilla';
const THEME_KEY = 'wb2_theme';
export const THEME_CHANGED_EVENT = 'wb2-theme-changed';
const VALID_THEMES: Theme[] = ['forest', 'stellar', 'ocean', 'lavender', 'sunset', 'ember', 'citrus', 'meadow', 'bubblegum', 'vanilla'];

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'forest';
  const raw = localStorage.getItem(THEME_KEY);
  return (VALID_THEMES as string[]).includes(raw ?? '') ? (raw as Theme) : 'forest';
}

// Dispatches THEME_CHANGED_EVENT so the background (mounted once, high up
// in layout.tsx) picks up the change immediately — same cross-component-
// update pattern as SYNCED_EVENT in lib/sync.ts, just for a purely local
// change with nothing to actually sync.
export function saveTheme(t: Theme): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(THEME_KEY, t);
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}

// --- Font size (same per-device, un-synced, not-level-namespaced shape as
// Theme above — a reading preference has nothing to do with which
// vocabulary level is active, and there's no expectation two devices on
// the same account share it). Applied as a root <html> font-size
// percentage (see FontScaleEffect) rather than per-component classes —
// nearly all of the app's text already goes through Tailwind's rem-based
// text-* utilities, so scaling the root scales the whole app in one
// place. ---
export type FontScale = 'small' | 'default' | 'large';
const FONT_SCALE_KEY = 'wb2_font_scale';
export const FONT_SCALE_CHANGED_EVENT = 'wb2-font-scale-changed';
const VALID_FONT_SCALES: FontScale[] = ['small', 'default', 'large'];

export function getFontScale(): FontScale {
  if (typeof window === 'undefined') return 'default';
  const raw = localStorage.getItem(FONT_SCALE_KEY);
  return (VALID_FONT_SCALES as string[]).includes(raw ?? '') ? (raw as FontScale) : 'default';
}

export function saveFontScale(scale: FontScale): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FONT_SCALE_KEY, scale);
  window.dispatchEvent(new Event(FONT_SCALE_CHANGED_EVENT));
}

// --- Card mode (same per-device, un-synced, not-level-namespaced shape as
// Theme/FontScale above) — 'dark' dims every card's paper surface to a
// warm dark parchment regardless of which background theme is active
// (see AppBackground's own gradientNight for the sky half of this), for
// reading comfortably at night without switching to a whole different
// theme. 'auto' (the default) follows the device's own local clock
// instead of a fixed choice — see resolveCardMode. ---
export type CardMode = 'light' | 'dark' | 'auto';
const CARD_MODE_KEY = 'wb2_card_mode';
export const CARD_MODE_CHANGED_EVENT = 'wb2-card-mode-changed';
const VALID_CARD_MODES: CardMode[] = ['light', 'dark', 'auto'];

export function getCardMode(): CardMode {
  if (typeof window === 'undefined') return 'auto';
  const raw = localStorage.getItem(CARD_MODE_KEY);
  return (VALID_CARD_MODES as string[]).includes(raw ?? '') ? (raw as CardMode) : 'auto';
}

export function saveCardMode(mode: CardMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CARD_MODE_KEY, mode);
  window.dispatchEvent(new Event(CARD_MODE_CHANGED_EVENT));
}

// 'light'/'dark' pass straight through — 'auto' resolves against the
// DEVICE'S OWN local clock (not UTC, not a sunset API — deliberately
// simple: a fixed evening/morning cutoff is what "night" means for a
// study app, not astronomical dusk). 19:00-06:59 reads as night; the
// caller (AppBackground) re-calls this periodically so a session left
// open across one of those boundaries still flips on its own.
export function resolveCardMode(mode: CardMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  const hour = new Date().getHours();
  return (hour >= 19 || hour < 7) ? 'dark' : 'light';
}

// --- Correct-answer chime (same per-device, un-synced, not-level-
// namespaced shape as Theme/FontScale above) — which of lib/sound.ts's
// CHIME_OPTIONS plays on a correct answer. No CHANGED_EVENT of its own
// (unlike Theme/FontScale): nothing needs to react live to a change —
// playCorrectChime() just reads this fresh, by value, every time it's
// about to play. ---
export type SoundChoice = 'soft-two-note' | 'triad-bloom' | 'rising-glow' | 'double-ding' | 'soft-tap';
const SOUND_CHOICE_KEY = 'wb2_sound_choice';
const VALID_SOUND_CHOICES: SoundChoice[] = ['soft-two-note', 'triad-bloom', 'rising-glow', 'double-ding', 'soft-tap'];
// triad-bloom was the only option before this became a Settings picker —
// stays the default so anyone who never opens the new picker hears
// exactly what they already do today.
const DEFAULT_SOUND_CHOICE: SoundChoice = 'triad-bloom';

export function getSoundChoice(): SoundChoice {
  if (typeof window === 'undefined') return DEFAULT_SOUND_CHOICE;
  const raw = localStorage.getItem(SOUND_CHOICE_KEY);
  return (VALID_SOUND_CHOICES as string[]).includes(raw ?? '') ? (raw as SoundChoice) : DEFAULT_SOUND_CHOICE;
}

export function saveSoundChoice(choice: SoundChoice): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_CHOICE_KEY, choice);
}

// --- Local pet identity (same per-device, not-level-namespaced shape as
// Theme/FontScale above) — the signed-out fallback for avatarId/nickname,
// which otherwise live only in the server-side `profiles` table (see
// lib/shop.ts's getMyProfile/setAvatarId/setNickname, all of which no-op
// without a session). Read by lib/shop.ts's getDisplayProfile whenever
// there's no signed-in session, and migrated up to the real profile the
// first time a customized signed-out device signs in (see
// migrateLocalProfileIfNeeded). No CHANGED_EVENT, unlike Theme — only
// Home and the pet/nickname picker ever read these, and both re-read on
// their own mount/save, so there's no other listener that needs to react
// live. ---
const LOCAL_AVATAR_ID_KEY = 'wb2_local_avatar_id';
const LOCAL_NICKNAME_KEY = 'wb2_local_nickname';

export function getLocalAvatarId(): string {
  if (typeof window === 'undefined') return 'dachshund';
  return localStorage.getItem(LOCAL_AVATAR_ID_KEY) || 'dachshund';
}

export function saveLocalAvatarId(avatarId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_AVATAR_ID_KEY, avatarId);
}

// null means "no nickname set" — matches the remote profile's own
// nickname: string | null shape exactly, so callers can treat the two
// interchangeably.
export function getLocalNickname(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(LOCAL_NICKNAME_KEY) || null;
}

export function saveLocalNickname(nickname: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = nickname.trim().slice(0, 24);
  if (trimmed) localStorage.setItem(LOCAL_NICKNAME_KEY, trimmed);
  else localStorage.removeItem(LOCAL_NICKNAME_KEY);
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
  return localStorage.getItem(KEYS.onboardingDone) === '1';
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
  // Only counts as real activity (see PARTIAL_DAYS_KEY) when something
  // was actually studied — the trivial "0 study words today, mark done
  // automatically" path (see DailySessionFlow's mount effect) shouldn't
  // by itself paint a day as partially active if review never happens.
  if (count > 0) touchPartialDaysCounter();
  return stats;
}

// Records that a review batch finished. `count` is added, since a user can
// review multiple batches ("Review more") across the day.
export function markReviewGoalDone(count: number): DailyStats {
  const stats = getDailyStats();
  stats.reviewDone = true;
  stats.reviewedCount += count;
  saveDailyStats(stats);
  if (count > 0) touchPartialDaysCounter();
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
// One guided flow per day: study the day's new words (with a round-1.5
// "what does this word mean?" checkpoint once every word's past round 1),
// a matching-quiz recap at the true end, then the same shape for review
// (its own pre-review MCQ up front, rounds, then its own matching recap).
// `phase` + the queues below capture exactly where the user left off, so
// navigating away and coming back (even the next day, in which case a
// fresh session simply gets started) resumes cleanly. Naturally invalidated
// once the date rolls over, same pattern as DailyStats.
export type SessionPhase =
  | 'study-mcq' | 'study-rounds' | 'study-matching'
  | 'study-done'
  // review-mcq (forward: "which German word means this?") and
  // review-mcq-reversed ("what does this word mean?") are deliberately
  // separate phases, not one mixed-direction batch -- kept apart so a
  // learner always knows which direction they're being asked in (see
  // WordMeaningChoiceCard's own comment on why the two directions get
  // distinct framing at all). review-mcq-reversed is 'short'-stage
  // review's ONLY checkpoint now -- it has no round-ladder step of its
  // own any more (see REVIEW_PLAN), so a correct pick there is what
  // actually advances short -> medium, the same way study-mcq's own
  // reversed checkpoint now completes introduction.
  | 'review-mcq' | 'review-mcq-reversed' | 'review-rounds' | 'review-matching'
  | 'report'
  // The bonus end-of-introduction cloze-paragraph exercise (see
  // buildParagraphBatches/ParagraphExercise in lib/practice.ts) -- reached
  // straight from study-done's Continue button, only when today's batch has
  // enough newly-introduced words for at least one paragraph.
  // study-paragraph-offer is the "do it or skip" choice; study-paragraph is
  // the exercise(s) themselves (one or two, depending on batch size),
  // cycling via paragraphExerciseIndex below. Either path lands on
  // 'congrats' next, same as when there's nothing to offer at all.
  | 'study-paragraph-offer' | 'study-paragraph'
  | 'congrats'
  // The bonus Word Match round after the congrats card, once per day, only
  // reached when there are enough learned words to fill it (see
  // hasEnoughWordsForGame) -- replayable as many times as the learner
  // likes before they quit to 'done'. Skipped straight to 'done' entirely
  // when the word count gate isn't met yet.
  | 'play'
  | 'done';

// A single blank in the bonus paragraph exercise -- see ParagraphExercise.
export interface ParagraphBlank {
  wordId: string;
  answer: string; // exact inflected form the learner must drop here
}

// The bonus end-of-introduction cloze paragraph, already parsed from
// generate-paragraph's raw AI response (see lib/practice.ts's
// parseParagraphResponse) into a shape the UI can render directly.
export interface ParagraphExercise {
  // Paragraph split around its blanks -- segments.length is always
  // blanks.length + 1 (text before the first blank, between each pair, and
  // after the last), so the UI can render segments[0], blank 0,
  // segments[1], blank 1, ... without re-parsing anything.
  segments: string[];
  blanks: ParagraphBlank[];
  // blanks' answers, shuffled -- what the learner actually drags from.
  // Carries wordId alongside each answer (not just the bare string) so
  // the UI can show a "meaning" lookup per tray chip without ambiguity --
  // two different words can coincidentally need the identical inflected
  // form (see parseParagraphResponse's own comment), so matching a tray
  // slot back to its word by STRING equality alone could resolve the
  // wrong one.
  tray: { answer: string; wordId: string }[];
  // The story's full text, already resolved to its correct German
  // (no [[i]] placeholders) and translated into the learner's own
  // language, split into parallel sentence-aligned arrays (sentences[i]
  // translates to translations[i]) — powers the post-check translation
  // panel in ParagraphExerciseCard (click a sentence in either language,
  // its counterpart highlights). Optional so an OLDER cached exercise
  // (persisted before this field existed, or one whose translation
  // generation didn't line up — see generate-paragraph's own comment)
  // still renders fine with no translation panel at all, rather than
  // crashing on a missing field.
  sentences?: string[];
  translations?: string[];
}

export interface DailySession {
  date: string;
  phase: SessionPhase;
  studyWordIds: string[];
  reviewWordIds: string[];
  // Set once the study-mcq checkpoint (every word's had its round-1 pass,
  // then a "what does this word mean?" MCQ, retried until clean — see
  // studyMcqWrongIds) has actually run — keeps it from firing twice if the
  // session is resumed mid-round-2.
  studyMcqDone: boolean;
  studyMcqQueueIds: string[];
  // Wrongly-answered word ids this MCQ pass — once studyMcqQueueIds drains,
  // a non-empty studyMcqWrongIds becomes the next pass (reshuffled), so a
  // wrong pick gets asked again instead of just moving on.
  studyMcqWrongIds: string[];
  // Set once the end-of-study matching-quiz recap has run.
  studyMatchingDone: boolean;
  // Set once the end-of-review matching-quiz recap has run.
  reviewMatchingDone: boolean;
  // Every review-eligible word gets this "what does this word mean?"
  // reminder before its round-ladder continuation, regardless of which
  // milestone (1st/2nd/3rd review) it's on. Same retry-until-clean
  // mechanic as studyMcqWrongIds above.
  reviewMcqQueueIds: string[];
  reviewMcqWrongIds: string[];
  // 'short'-stage review's own reversed-direction checkpoint (see
  // SessionPhase's own comment) — same retry-until-clean mechanic as
  // reviewMcqQueueIds/reviewMcqWrongIds above, just a fully separate
  // queue/phase rather than mixed into that one.
  reviewMcqReversedQueueIds: string[];
  reviewMcqReversedWrongIds: string[];
  // Set the first time the learner taps WordMeaningChoiceCard's own
  // "Can't listen right now? Show the word" fallback — every OTHER
  // audio-first MCQ_reversed question today (study or review) then also
  // starts pre-revealed instead of making them tap that same button
  // again for every single word for the rest of the day. Resets tomorrow
  // like the rest of this session; not a Settings-level permanent
  // preference, since a single noisy moment doesn't mean they never want
  // the audio-first version again.
  mcqReversedRevealed?: boolean;
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
  // A review word steps through several rounds within its own milestone
  // (e.g. a "2nd review" word starts at round 3, can climb toward round 4
  // or get demoted back down on a wrong answer/Hint) — this tracks which
  // round each in-progress review word is CURRENTLY on, keyed by word id.
  // Without persisting it here, it only ever lived in an in-memory ref
  // (DailySessionFlow's reviewRoundsRef), which meant navigating away
  // mid-review and coming back (even just to change a Settings toggle)
  // reset every in-progress review word back to its milestone's starting
  // round — a real, reported "review starts over" bug. Undefined/missing
  // entries fall back to the word's own milestone startRound, same as a
  // genuinely fresh review word.
  reviewRounds?: Record<string, Round>;
  // Which of today's studyWordIds actually needed a round-1 pass TODAY —
  // captured once, at the very first entry into study-rounds, from
  // whichever ones had round 1 (or no progress at all) at that exact
  // moment. A "Continuing" word can arrive in today's batch already past
  // round 1 (started introduction on an earlier day/session, interrupted
  // before reaching a mascot stage) — it still needs its remaining
  // rounds today, but it doesn't need ANOTHER round-1 pass, and critically
  // it should NOT gate/pad the round-1.5 MCQ checkpoint below, which is
  // specifically a comprehension check right after a word's round-1
  // introduction. Without this distinction, the checkpoint's own gate
  // (advanceStudyQueue: every studyWordIds id at round >= 2) could already
  // be satisfied by pre-existing carryover words the moment a single
  // genuinely-new word finishes round 1 — firing the checkpoint (and
  // quizzing on ALL of studyWordIds, carryovers included) before the
  // learner has even reached those other words in today's queue at all.
  // Confirmed real via a direct reproduction: a 5-word batch with 4
  // carryover words + 1 fresh word jumped straight to a 5-word MCQ after
  // only the fresh word's round-1 sentence. Undefined (a session
  // persisted before this field existed) falls back to studyWordIds
  // wholesale — the previous, imperfect behavior — rather than crashing.
  studyRound1NeededIds?: string[];
  // Which paragraph batch (see buildParagraphBatches -- a 6+ word day
  // splits into more than one) is currently showing during
  // 'study-paragraph'. paragraphExercises caches each batch's AI-generated
  // result, keyed by index as a string (plain JSON object keys are always
  // strings), so leaving mid-story and coming back doesn't burn another AI
  // call regenerating the same paragraph. Deliberately NOT persisting the
  // learner's in-progress drag placements themselves -- this is a
  // skippable, unscored bonus, so a refresh mid-drag just restarts that one
  // paragraph rather than needing full resume fidelity.
  paragraphExerciseIndex?: number;
  paragraphExercises?: Record<string, ParagraphExercise>;
  earnedPuppies: number;
  earnedUpgrades: Partial<Record<MascotStageId, number>>;
  isExtra: boolean; // true for a "Study more"/"Review more" bonus round, so
                     // Home keeps showing "Study more" (not "Start") if the
                     // user quits mid-round and comes back.
}

// Backfills any fields a session persisted before they existed would be
// missing (e.g. the MCQ-checkpoint/matching-recap additions) with their
// startDailySession defaults — a session started yesterday, still sitting
// in localStorage, otherwise crashes the moment code that assumes a newer
// field always exists (an array's .length, say) runs against it today.
// `raw` is typed as a Partial here (unlike everywhere else this data is
// handled) specifically because that's the whole point — it documents that
// a real stored session, unlike the DailySession type's own guarantees,
// can genuinely be missing fields added after it was saved.
function normalizeDailySession(raw: Partial<DailySession>): DailySession {
  const normalized = {
    studyMcqDone: false,
    studyMcqQueueIds: [],
    studyMcqWrongIds: [],
    reviewMatchingDone: false,
    reviewMcqWrongIds: [],
    reviewMcqReversedQueueIds: [],
    reviewMcqReversedWrongIds: [],
    reviewRounds: {},
    ...raw,
  } as DailySession;
  // Same round-3 migration as normalizeProgress's own — only ever matters
  // for a session already mid-review, TODAY, at the exact moment this
  // changed (sessions reset daily, so it can't linger past that).
  // Guarded against reviewRounds being present-but-not-a-plain-object (a
  // stray `null` stored explicitly would otherwise survive the `...raw`
  // spread above and override the `{}` default, then throw the moment
  // Object.keys touches it) — belt-and-suspenders after a real "crashes
  // once right after a deploy, fine on reload" report that could fit a
  // bad-stored-session shape as easily as a stale cached bundle.
  if (normalized.reviewRounds && typeof normalized.reviewRounds === 'object') {
    for (const id of Object.keys(normalized.reviewRounds)) {
      if ((normalized.reviewRounds[id] as number) === 3) normalized.reviewRounds[id] = 2;
    }
  } else {
    normalized.reviewRounds = {};
  }
  return normalized;
}

export function getDailySession(): DailySession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(localStorage.getItem(levelKey(KEYS.dailySession)) || 'null') as Partial<DailySession> | null;
    if (raw && raw.date === today()) return normalizeDailySession(raw);
    return null;
  } catch {
    return null;
  }
}

export function saveDailySession(s: DailySession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(levelKey(KEYS.dailySession), JSON.stringify(s));
  notifyProgressChanged();
}

export function startDailySession(studyWordIds: string[], reviewWordIds: string[], isExtra = false): DailySession {
  // Every review-eligible word gets a pre-review MCQ reminder, but which
  // DIRECTION depends on its own current stage (see REVIEW_PLAN/
  // SessionPhase's own comments): puppy/medium still get the forward
  // "which German word means this?" check ahead of their own round-ladder
  // step; short has no round-ladder step at all any more, so its reversed
  // "what does this word mean?" check is the whole thing — kept as a
  // fully separate queue/phase from the forward one, not mixed together,
  // so a learner always knows which direction they're being asked in.
  const allProgress = getAllProgress();
  const isShortStage = (id: string) => allProgress[id]?.mascotStage === 'short';
  const reviewMcqQueueIds = reviewWordIds.filter(id => !isShortStage(id));
  const reviewMcqReversedQueueIds = reviewWordIds.filter(isShortStage);

  const s: DailySession = {
    date: today(),
    // Review runs before study — start the day with the easy stuff (a
    // multiple-choice recall check, then spelling words already learned)
    // before asking the learner to take on new, harder vocabulary. 'report'
    // (review's own results screen) is the universal fallback when there's
    // nothing to study AND nothing to review either — it renders nothing (0
    // upgrades) and immediately cascades into 'congrats', so the
    // streak/congrats bookkeeping still goes through the one code path that
    // owns it.
    phase: reviewMcqQueueIds.length > 0 ? 'review-mcq'
      : reviewMcqReversedQueueIds.length > 0 ? 'review-mcq-reversed'
      : reviewWordIds.length > 0 ? 'review-rounds'
      : studyWordIds.length > 0 ? 'study-rounds' : 'report',
    studyWordIds,
    reviewWordIds,
    studyMcqDone: false,
    studyMcqQueueIds: [],
    studyMcqWrongIds: [],
    studyMatchingDone: false,
    reviewMatchingDone: false,
    reviewMcqQueueIds,
    reviewMcqWrongIds: [],
    reviewMcqReversedQueueIds,
    reviewMcqReversedWrongIds: [],
    matchingQueueIds: [],
    earnedPuppies: 0,
    earnedUpgrades: {},
    isExtra,
  };
  saveDailySession(s);
  return s;
}

// --- Reset ---

export function clearAllProgress(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(levelKey(KEYS.progress));
  // The streak is shared across every level (see STREAK_KEY) — clearing one
  // level's progress shouldn't erase an achievement earned via any level.
  localStorage.removeItem(levelKey(KEYS.dailyStats));
  localStorage.removeItem(levelKey(KEYS.studyBatch));
  localStorage.removeItem(levelKey(KEYS.dailySession));
}

// Wipes every level's progress/streak/settings/session, the lifetime goal-
// days counter, and the onboarding flag — everything a brand-new signed-in
// user would start with. Deliberately leaves the Supabase auth session
// itself untouched (still signed in as the same email) and doesn't touch
// migration flags (one-time, idempotent, irrelevant to "user data"). Caller
// is responsible for pushing this cleared state to remote (see syncNow) —
// same reasoning as clearAllProgress: skipping that would let a later pull
// silently resurrect everything from the still-stale remote row.
export function resetEverything(): void {
  if (typeof window === 'undefined') return;
  for (const level of LEVEL_ORDER) {
    localStorage.removeItem(namespacedKey(KEYS.progress, level));
    localStorage.removeItem(namespacedKey(KEYS.streak, level)); // legacy per-level key, harmless if absent
    localStorage.removeItem(namespacedKey(KEYS.settings, level));
    localStorage.removeItem(namespacedKey(KEYS.settingsUpdatedAt, level));
    localStorage.removeItem(namespacedKey(KEYS.dailyStats, level));
    localStorage.removeItem(namespacedKey(KEYS.studyBatch, level));
    localStorage.removeItem(namespacedKey(KEYS.dailySession, level));
  }
  localStorage.removeItem(GOAL_DAYS_KEY);
  localStorage.removeItem(PARTIAL_DAYS_KEY);
  localStorage.removeItem(DAILY_WORD_LOG_KEY);
  localStorage.removeItem(STREAK_KEY);
  localStorage.removeItem(ACTIVE_LEVEL_KEY);
  localStorage.removeItem(KEYS.onboardingDone);
}
