'use client';

import { WORDS, Word, wordsForLevel, Level } from './words';
import {
  getAllProgress, getSettings, today, Round, WordProgress, MascotStageId,
  getDailySession, saveDailySession, SessionPhase, getWordProgress, saveWordProgress,
  getMergedProgressAcrossLevels,
} from './storage';
import { recordMilestonePass, REVIEW_PLAN, MASTERY_DAYS_AFTER_INTRODUCTION } from './srs';

export function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Word Match game unlock threshold (see app/game/page.tsx) — below this
// many learned words, there simply isn't enough vocabulary to fill even
// one round's board. Shared here (rather than a constant local to
// app/game/page.tsx) so StudyRoadmap can hide its "Play" stage under the
// exact same condition that actually locks the game page, instead of
// advertising a destination a new learner (most commonly an A1 learner in
// their first day or two, before they've reached 5 learned words at all)
// can't actually reach yet.
export const GAME_MIN_WORDS_REQUIRED = 5;

// A learner-recognizable word: reached its first mascot stage (puppy) or
// beyond, across EVERY level (not just the currently active one) — same
// definition app/game/page.tsx's own getLearnedWords uses, just a count
// rather than the full Word[] list (StudyRoadmap only needs to know
// whether the game is unlocked, not which words would fill it).
export function hasEnoughWordsForGame(): boolean {
  const progress = getMergedProgressAcrossLevels();
  let count = 0;
  for (const w of WORDS) {
    if (progress[w.id]?.mascotStage && ++count >= GAME_MIN_WORDS_REQUIRED) return true;
  }
  return false;
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

// A handful of small, closed vocabularies where a beginner benefits from
// meeting them in their real-world order rather than randomly shuffled —
// confirmed real: "dreizehn" (thirteen) could be served before "eins"
// (one) purely by shuffle luck, since nothing previously distinguished a
// sequence word from any other fresh word. Each inner array's own order
// IS the natural order; a word's German form just needs to appear in it
// somewhere. Deliberately NOT relying on corpus array order (unlike
// numbers, which happen to already be listed eins->zehn->...->vierzehn in
// lib/words.ts, weekdays and months are NOT stored in calendar order
// there) — matching by the actual German text is correct regardless of
// how the corpus happens to be authored.
const NATURAL_SEQUENCES: string[][] = [
  [
    'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn',
    'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn',
    'neunzehn', 'zwanzig', 'einundzwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig',
    'siebzig', 'achtzig', 'neunzig', 'hundert', 'tausend', 'Million', 'Milliarde',
  ],
  ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
  ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
];

// Shuffles as usual, then — for each sequence above — finds whichever
// array POSITIONS happen to land a matching word after the shuffle, and
// re-fills just those same positions with that sequence's members in
// their real order. This keeps the overall pacing/randomness of everything
// else untouched (sequence membership doesn't change WHEN a learner starts
// seeing numbers/weekdays/months, only what order they see them in once
// they do) — a full re-sort or clustering them at the front would be a
// bigger, more disruptive change than this narrow fix calls for.
function withNaturalSequenceOrder(words: Word[]): Word[] {
  const result = shuffled(words);
  for (const seq of NATURAL_SEQUENCES) {
    const positions: number[] = [];
    const matches: Word[] = [];
    result.forEach((w, i) => {
      if (seq.includes(w.de)) { positions.push(i); matches.push(w); }
    });
    if (matches.length < 2) continue;
    const sorted = [...matches].sort((a, b) => seq.indexOf(a.de) - seq.indexOf(b.de));
    positions.forEach((pos, idx) => { result[pos] = sorted[idx]; });
  }
  return result;
}

// Study pool: brand-new words, plus words that have started introduction
// (round 1/2) but haven't finished it yet — i.e. no mascotStage assigned.
// Once a word passes round 2 for the first time (mascotStage set), it's
// done with Study for good and moves to the review pool instead, however
// many further reviews it still owes. Words already in progress (abandoned
// mid-introduction) are prioritized over brand-new ones, so an unfinished
// word gets picked up again before more new words are introduced.
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
    else if (!p.mascotStage) inProgress.push(w);
  }

  let freshOrdered: Word[];
  if (settings.level === 'A1') {
    // The ~220 curated high-frequency words (see lib/words.ts's
    // `highFrequency` field) always come before any other fresh A1 word —
    // they use the old copy-the-word round 1 (see isBootstrapCopyWord)
    // rather than the AI translation exercise, so a true beginner learns
    // this core vocabulary before being asked to translate sentences.
    //
    // Both the short-word-first grace period AND natural-sequence
    // ordering apply to EACH pool independently (previously only
    // freshOther got either treatment at all — confirmed real: "dreizehn"
    // is itself high-frequency, so it could be served as literally a
    // learner's first-ever word, 8 letters and out of counting order,
    // with nothing in the high-frequency pool's pure shuffle to prevent
    // it).
    const introducedCount = wordsForLevel('A1').filter(w => allProgress[w.id]).length;
    const inNaturalSequence = (w: Word) => NATURAL_SEQUENCES.some(seq => seq.includes(w.de));
    const orderPool = (pool: Word[]): Word[] => {
      const ordered = withNaturalSequenceOrder(pool);
      if (introducedCount >= SHORT_WORD_GRACE_COUNT) return ordered;
      // Sequence members are exempt from the length split entirely, rather
      // than just sorted within whichever half they land in — confirmed
      // real: splitting still put months out of calendar order (Februar
      // alone is 7 characters, so März..August — all ≤6 — landed BEFORE
      // it even though sequence-ordering had already sorted Februar
      // correctly relative to the rest). Staying in recognizable order
      // matters more for a small curated set like this than strict
      // shortness, so the whole sequence rides with the short words
      // regardless of a member's actual length.
      const short = ordered.filter(w => inNaturalSequence(w) || [...w.de].length <= SHORT_WORD_MAX_LENGTH);
      const long = ordered.filter(w => !inNaturalSequence(w) && [...w.de].length > SHORT_WORD_MAX_LENGTH);
      return [...short, ...long];
    };
    freshOrdered = [
      ...orderPool(fresh.filter(w => w.highFrequency)),
      ...orderPool(fresh.filter(w => !w.highFrequency)),
    ];
  } else {
    freshOrdered = shuffled(fresh);
  }

  return [...shuffled(inProgress), ...freshOrdered].slice(0, limit);
}

// The ~220 curated high-frequency A1 words (see lib/words.ts) always use
// the old copy-the-word round 1, never the AI translation exercise —
// checked independently of progress, since it's the same rule whether this
// is the word's first pass or a Hint-triggered demotion back to round 1.
export function isBootstrapCopyWord(word: Word): boolean {
  return word.level === 'A1' && !!word.highFrequency;
}

// Which levels' full vocabulary counts as "already known" for a given
// level's translation-exercise sentences — full CEFR progression, not
// "everything earlier in LEVEL_ORDER" (C1/C2 have no words yet but are
// listed for completeness).
const PREREQUISITE_LEVELS: Record<Level, Level[]> = {
  A1: [],
  A2: ['A1'],
  B1: ['A1', 'A2'],
  B2: ['A1', 'A2', 'B1'],
  C1: ['A1', 'A2', 'B1', 'B2'],
  C2: ['A1', 'A2', 'B1', 'B2', 'C1'],
};

// Vocabulary the AI-generated sentence (see lib/ai.ts's generateSentence)
// is allowed to use: every word in a lower CEFR level (assumed known
// outright, full list) plus, for A1 only, its own ~220 high-frequency
// baseline. Deliberately NOT gated by any individual learner's own
// in-level progress — this is the same guaranteed-safe baseline used to
// pre-generate most words' exercisePrompt (see lib/words.ts), so the rare
// live fallback stays consistent with the pre-generated majority rather
// than mixing two different vocabulary definitions. Returns deduped
// English glosses (what the AI actually needs — the learner has to know
// the English concept to translate it into German).
export function getKnownVocabulary(level: Level): string[] {
  const lowerWords = PREREQUISITE_LEVELS[level].flatMap(l => wordsForLevel(l));
  const baseline = level === 'A1' ? wordsForLevel('A1').filter(w => w.highFrequency) : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of [...lowerWords, ...baseline]) {
    const key = w.en.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(w.en);
    }
  }
  return result;
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
// Scoped to study-rounds only — a size change made while the mid-Day-1
// matching quiz is on-screen just takes effect on the next visit instead.
const RESIZABLE_STUDY_PHASES: SessionPhase[] = ['study-rounds'];

export function resizeTodayStudyBatch(newSize: number): void {
  const session = getDailySession();
  if (!session || !RESIZABLE_STUDY_PHASES.includes(session.phase)) return;

  const allProgress = getAllProgress();
  const isDone = (id: string) => !!allProgress[id]?.mascotStage;
  const existing = session.studyWordIds;
  const doneIds = existing.filter(isDone);
  const pendingIds = existing.filter(id => !isDone(id));
  const targetSize = Math.max(newSize, doneIds.length);

  if (targetSize > existing.length) {
    const extra = buildStudyWords(targetSize - existing.length, new Set(existing));
    session.studyWordIds = [...existing, ...extra.map(w => w.id)];
    // Keep the live round-ladder queue (see DailySessionFlow) in step too —
    // without this it goes stale and the progress bar's "done / total" count
    // can go negative or otherwise stop matching the resized batch.
    if (session.studyQueueIds) session.studyQueueIds = [...session.studyQueueIds, ...extra.map(w => w.id)];
    saveDailySession(session);
  } else if (targetSize < existing.length) {
    const keepPending = pendingIds.slice(0, targetSize - doneIds.length);
    session.studyWordIds = [...doneIds, ...keepPending];
    const kept = new Set(session.studyWordIds);
    if (session.studyQueueIds) session.studyQueueIds = session.studyQueueIds.filter(id => kept.has(id));
    saveDailySession(session);
  }
}

// Earlier stage = less mature = reviewed first when due dates tie.
const STAGE_RANK: Record<MascotStageId, number> = { puppy: 0, short: 1, medium: 2, 'long-crowned': 3 };

// Review pool: words that have finished introduction (mascotStage set) and
// aren't fully mastered yet — regardless of which of the 3 review
// milestones they're on. By default, only words actually due (today >=
// nextReviewDue) are eligible. Pass `includeToday` to bypass the schedule
// for early bonus practice (the "Review Extra" flow); those attempts don't
// affect the schedule (see applyReviewResult). `excludeIds` lets a session
// pull additional batches via "Review more".
export function buildReviewWords(
  limit = getSettings().dailyReview,
  excludeIds: Set<string> = new Set(),
  includeToday = false,
): Word[] {
  const allProgress = getAllProgress();
  const t = today();
  const pool = wordsForLevel(getSettings().level).filter(w => {
    const p = allProgress[w.id];
    if (!p || !p.mascotStage || p.fullyMastered) return false;
    if (excludeIds.has(w.id)) return false;
    if (!includeToday && p.nextReviewDue && p.nextReviewDue > t) return false;
    return true;
  });
  // Most overdue first, then earliest-stage (least mature) first.
  pool.sort((a, b) => {
    const dueA = allProgress[a.id].nextReviewDue ?? t;
    const dueB = allProgress[b.id].nextReviewDue ?? t;
    return dueA.localeCompare(dueB) || STAGE_RANK[allProgress[a.id].mascotStage!] - STAGE_RANK[allProgress[b.id].mascotStage!];
  });
  return pool.slice(0, limit);
}

// Punctuation within a word (e.g. the hyphen in "Start-up") isn't something
// to test recall of — it's always shown, never a blank tile to fill in,
// regardless of round.
function isLetter(ch: string): boolean {
  return /[a-zA-ZäöüÄÖÜß]/.test(ch);
}

// Returns hint pattern: true = hidden (user must type it), false = revealed (locked, pre-filled).
// Round 1: nothing revealed in the tiles (the word is shown separately as reference text).
// Round 2: ~50% of letters revealed, always including the first letter.
// Round 3: only the first letter revealed.
// Round 4: no hints — full recall.
export function generateHint(word: string, round: Round): boolean[] {
  const chars = [...word];
  const n = chars.length;
  const letterIndices = chars.map((c, i) => (isLetter(c) ? i : -1)).filter(i => i !== -1);

  let base: boolean[];
  if (round === 1 || round === 4) {
    base = Array.from({ length: n }, () => true);
  } else if (round === 3) {
    base = Array.from({ length: n }, (_, i) => i !== letterIndices[0]);
  } else {
    // round 2 — reveal the first half of the word's LETTERS (not a random
    // half, and not a raw character-count split, so a hyphen or similar
    // never eats into the allowance — it's revealed unconditionally below
    // anyway). A real prefix is a much stronger recall cue than scattered
    // random letters, and being deterministic means recomputing this (e.g.
    // after switching tabs and back) always reproduces the exact same
    // reveal instead of a fresh random draw that reads as a different card.
    const revealCount = Math.max(1, Math.round(letterIndices.length / 2));
    const revealed = new Set(letterIndices.slice(0, revealCount));
    base = Array.from({ length: n }, (_, i) => !revealed.has(i));
  }

  return base.map((h, i) => (isLetter(chars[i]) ? h : false));
}

// Suggests a daily review count. Each word needs exactly 3 reviews after
// introduction to retire (at +1, +4, and +9 days, per the fixed schedule in
// lib/srs.ts) — so once the pace has been running long enough for all three
// cohorts to be active simultaneously, steady-state daily review load
// converges to 3x the study pace (three cohorts' worth of words landing on
// any given day).
export function recommendedDailyReview(studyBatchSize: number): number {
  return Math.max(1, Math.min(100, Math.round(studyBatchSize * 3)));
}

export interface ProgressForecast {
  wordsRemaining: number;
  daysToMasterAll: number; // total days from today until every word is fully mastered — already includes however long introducing the remaining words themselves takes, not on top of it
}

// Forecast for the Settings/Welcome "at this pace" display: how many days,
// at the given pace, until every word is fully mastered. Baseline is the
// fixed schedule's own runway (MASTERY_DAYS_AFTER_INTRODUCTION — 9 days,
// on-schedule) — the last word introduced still needs this full runway
// after it's introduced; earlier words mature in parallel alongside it, so
// this is the last word's finish line, not a sum of everyone's individual
// runways. Comparing dailyReview against the steady-state load this study
// pace eventually produces (recommendedDailyReview) stretches that runway
// proportionally if the review cap is underprovisioned, so moving the
// review slider actually moves this number instead of assuming unlimited
// review capacity.
export function estimateProgressForecast(studyBatchSize: number, dailyReview: number): ProgressForecast {
  const allProgress = getAllProgress();
  const levelWords = wordsForLevel(getSettings().level);
  let introduced = 0;
  for (const w of levelWords) {
    if (allProgress[w.id]) introduced++;
  }

  const wordsRemaining = levelWords.length - introduced;
  const daysToIntroduceAll = studyBatchSize > 0 ? Math.ceil(wordsRemaining / studyBatchSize) : Infinity;

  const neededReviewCapacity = recommendedDailyReview(studyBatchSize);
  const bottleneckFactor = dailyReview > 0 ? Math.max(1, neededReviewCapacity / dailyReview) : Infinity;
  const daysToMasterAll = daysToIntroduceAll + MASTERY_DAYS_AFTER_INTRODUCTION * bottleneckFactor;

  return { wordsRemaining, daysToMasterAll };
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

// Wrong answer or an explicit Hint request both demote one round for more
// scaffolding (never below round 1 — round 1 is the sentence exercise,
// which is exempt from ever being retriggered by a wrong round-2 answer;
// see the caller in components/DailySessionFlow.tsx, which shows the old
// copy-the-word tiles instead when a word demoted to round 1 already has
// an exampleSentence).
function demoteRound(currentRound: Round, floor: Round = 1): Round {
  return Math.max(floor, currentRound - 1) as Round;
}

// Round 1 (the sentence exercise) always "passes" on submit — this only
// ever runs with progress.round already at 1 (promote to 2) or 2 (a real
// test: wrong demotes to round 1, correct completes introduction).
export function applyResult(progress: WordProgress, correct: boolean): WordProgress {
  const lastPracticed = today();

  if (!correct) {
    return { ...progress, round: demoteRound(progress.round), lastPracticed };
  }
  if (progress.round < 2) {
    return { ...progress, round: (progress.round + 1) as Round, lastPracticed };
  }
  return recordMilestonePass({ ...progress, lastPracticed }, 'puppy', lastPracticed);
}

// A learner-requested hint: explicitly demotes one round for more
// scaffolding, same demotion a wrong answer now causes — a proactive ask
// instead of a reactive one. Not available at round 1 (nothing lower to
// go — the button itself is hidden then).
export function requestHint(progress: WordProgress, currentRound: Round): { progress: WordProgress; nextRound: Round } {
  return {
    progress: { ...progress, lastPracticed: today() },
    nextRound: demoteRound(currentRound),
  };
}

export interface ReviewOutcome {
  progress: WordProgress;
  // The round to show next time this word comes up in this session — only
  // meaningful when `isFinal` is false (isFinal means it's leaving the queue).
  nextRound: Round;
  // True once this word's review episode is over: either a clean pass at
  // its milestone's cap round, or a one-shot "Review Extra" practice attempt.
  isFinal: boolean;
  // True if this attempt actually happened on-schedule and can affect
  // mastery — false for "Review Extra" bonus practice on a not-yet-due word.
  scored: boolean;
}

// Review scoring: each of the 3 review milestones (1st/2nd/3rd) has its own
// start round and cap round, derived from the word's CURRENT mascotStage
// (see lib/srs.ts's REVIEW_PLAN) — a word can only ever be on the one
// milestone that stage implies. Correct at the cap round completes that
// milestone (recordMilestonePass advances the stage and reschedules).
// Correct below the cap promotes one round, same visit. Wrong now demotes
// one round (same as Hint), floored at this milestone's own start round —
// it can't drop back into a PREVIOUS milestone's territory.
export function applyReviewResult(progress: WordProgress, correct: boolean, currentRound: Round): ReviewOutcome {
  const t = today();

  // Not actually due yet — only reachable via "Review Extra" pulling in a
  // word early. That's bonus practice: gives feedback, but doesn't touch
  // the schedule or round, since reviewing early doesn't tell us anything
  // about long-term recall the way an on-schedule review does.
  if (progress.nextReviewDue && progress.nextReviewDue > t) {
    return { progress, nextRound: currentRound, isFinal: true, scored: false };
  }

  const stage = (progress.mascotStage ?? 'puppy') as 'puppy' | 'short' | 'medium';
  const plan = REVIEW_PLAN[stage];

  if (correct) {
    if (currentRound >= plan.capRound) {
      return { progress: recordMilestonePass(progress, plan.nextStage, t), nextRound: plan.capRound, isFinal: true, scored: true };
    }
    return { progress: { ...progress, lastPracticed: t }, nextRound: (currentRound + 1) as Round, isFinal: false, scored: true };
  }

  return { progress: { ...progress, lastPracticed: t }, nextRound: demoteRound(currentRound, plan.startRound), isFinal: false, scored: true };
}

// Same "der/die/das X" form spoken and shown everywhere else a bare German
// word appears standalone (round cards, Word List) — used here so the MCQ's
// German choices carry their article too, not just the noun stem.
function germanForm(word: Word): string {
  return word.article ? `${word.article} ${word.de}` : word.de;
}

// Picks 3 wrong German choices for `word`, always from the SAME LEVEL (a
// distractor the learner hasn't studied yet would be unrecognizable, not a
// meaningful test) — preferring words that share BOTH `category` and
// `type`; falling back to just the same `type` (part of speech) within the
// level when there's no category or too few same-type members in it; and
// finally to any other same-level word if even that pool is too small.
// Category alone is deliberately never enough on its own: categories are
// thematic groupings ("Zeit", "Politik", etc.), not grammatical ones — most
// span nouns, verbs, adjectives, AND adverbs all mixed together, so
// matching on category without ALSO requiring the same type routinely
// produced word-class-mismatched choices (a noun distractor next to a verb
// target), which made the wrong answers trivially easy to spot by shape
// alone rather than by actually knowing the word's meaning.
// `seen` (choices already shown to this word this session — tracked
// in-memory by the caller) is excluded so a retry after a wrong answer gets
// genuinely different distractors, degrading gracefully to repeats only if
// the pool is exhausted.
export function buildMcqChoices(word: Word, seen: string[] = []): { correct: string; choices: string[] } {
  const correctForm = germanForm(word);
  const excluded = new Set([word.de.toLowerCase(), ...seen.map(s => s.toLowerCase())]);
  const picked = new Set<string>();
  const wrongChoices: string[] = [];

  const addFrom = (pool: Word[]) => {
    for (const w of shuffled(pool)) {
      if (wrongChoices.length >= 3) break;
      const key = w.de.toLowerCase();
      if (excluded.has(key) || picked.has(key)) continue;
      picked.add(key);
      wrongChoices.push(germanForm(w));
    }
  };

  const sameLevel = WORDS.filter(w => w.id !== word.id && w.level === word.level);
  if (word.category) {
    addFrom(sameLevel.filter(w => w.category === word.category && w.type === word.type));
  }
  if (wrongChoices.length < 3) {
    addFrom(sameLevel.filter(w => w.type === word.type));
  }
  if (wrongChoices.length < 3) {
    addFrom(sameLevel);
  }

  return { correct: correctForm, choices: shuffled([correctForm, ...wrongChoices]) };
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
