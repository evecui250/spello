'use client';

import { WORDS, Word, wordsForLevel, Level, glossFor } from './words';
import {
  getAllProgress, getSettings, today, Round, WordProgress, MascotStageId,
  getDailySession, saveDailySession, SessionPhase, getWordProgress, saveWordProgress,
  getMergedProgressAcrossLevels, ParagraphBlank, ParagraphExercise,
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

// Later stage = more mature = reviewed first when due dates tie (see
// buildReviewWords' own comment) — a word one review away from being
// fully mastered clears out of the pool for good on a pass, while an
// earlier-stage word just cycles back into a future review regardless,
// so finishing the near-done ones first actually shrinks the backlog
// instead of leaving them to keep losing the daily-cap lottery to a
// constant stream of earlier-stage words.
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
  // Most overdue first, then most-mature-stage first (see STAGE_RANK's
  // own comment) when due dates tie.
  pool.sort((a, b) => {
    const dueA = allProgress[a.id].nextReviewDue ?? t;
    const dueB = allProgress[b.id].nextReviewDue ?? t;
    return dueA.localeCompare(dueB) || STAGE_RANK[allProgress[b.id].mascotStage!] - STAGE_RANK[allProgress[a.id].mascotStage!];
  });
  return pool.slice(0, limit);
}

// Punctuation within a word (e.g. the hyphen in "Start-up") isn't something
// to test recall of — it's always shown, never a blank tile to fill in,
// regardless of round.
function isLetter(ch: string): boolean {
  return /[a-zA-ZäöüÄÖÜß]/.test(ch);
}

// Closed lists of genuine, unambiguous German word-formation prefixes,
// checked longest-first so e.g. "zurück" wins over any shorter coincidental
// overlap. Deliberately excludes short 2-letter prefixes (be-, er-, an-,
// zu-) even though they're real — at 2 letters they're too likely to
// coincidentally match the START of a monomorphemic word that just isn't
// prefixed at all (e.g. "bellen" starts with "be" but isn't be- + "llen").
// The 3+-letter ones here are genuine, closed word-formation classes with
// far lower collision risk: German verbs really do draw their prefixes
// from this specific list, not from arbitrary syllables.
const VERB_PREFIXES = [
  'auseinander', 'hinterher', 'entgegen', 'zusammen',
  'zurück', 'wieder', 'weiter',
  'durch', 'unter', 'über', 'wider', 'hinter', 'miss',
  'auf', 'aus', 'bei', 'ein', 'mit', 'vor', 'weg', 'los', 'hin', 'her', 'zer', 'ver', 'ent', 'emp', 'um',
].sort((a, b) => b.length - a.length);

// Same idea for the small closed set of quantity words German uses to
// build compound-style adjectives/nouns (einseitig = ein+seitig,
// mehrsprachig = mehr+sprachig) — not verbs, so kept separate.
const QUANTITY_PREFIXES = ['ein', 'zwei', 'drei', 'vier', 'fünf', 'mehr', 'viel', 'wenig', 'halb', 'ganz', 'gleich']
  .sort((a, b) => b.length - a.length);

// Every corpus word's lowercased form, 3+ letters — built once, lazily,
// and reused as the "is this a recognizable standalone word?" check for
// compound splitting below. Not level-filtered: a simpler word from ANY
// level (even one the learner hasn't studied yet) still being a real,
// nameable German word is exactly what makes a compound's first half
// recognizable, so restricting this to "already-known" words would make
// the hint worse, not more honest.
let corpusWordSet: Set<string> | null = null;
function getCorpusWordSet(): Set<string> {
  if (!corpusWordSet) {
    corpusWordSet = new Set(WORDS.map(w => w.de.toLowerCase()).filter(w => w.length >= 3));
  }
  return corpusWordSet;
}

// A few common linking fragments German inserts between compound parts
// (Verkehrsmittel = Verkehr+s+Mittel, Tageszeitung = Tag+es+Zeitung) —
// tried after a recognized head word, longest first.
const LINKING_FRAGMENTS = ['es', 'en', 's', 'n', 'e', ''];

// The closed-list half of splitMorphemePrefix — a verb prefix, or (for a
// NOUN too, not just verbs themselves) the exact same prefix a nominalized
// verb keeps (Aufforderung <- auffordern, Entwicklung <- entwickeln,
// Verständnis <- verstehen...), or a quantity prefix on an adjective/noun.
// Kept separate from the generic corpus-word search below so callers can
// tell a curated, low-false-positive match apart from a coincidental one
// (see generateHint's own tiering).
function frontClosedPrefixLen(word: Word): number | null {
  const lower = word.de.toLowerCase();

  if (word.type === 'verb') {
    for (const p of VERB_PREFIXES) {
      if (lower.startsWith(p) && lower.length - p.length >= 2) return p.length;
    }
    return null;
  }
  for (const p of QUANTITY_PREFIXES) {
    if (lower.startsWith(p) && lower.length - p.length >= 3) return p.length;
  }
  return null;
}

// The fuzzy half: is some other whole corpus word recognizable at the
// START of this one (optionally followed by a linking fragment)? Prone to
// coincidental false positives (Qualifikation -> "Qual", Klavier ->
// "vier") in a way the closed lists above aren't, since it'll match ANY
// real word regardless of whether it's actually functioning as a prefix
// here — kept as the lower-trust fallback tier in generateHint rather
// than an equal alternative.
function frontGenericHeadLen(word: Word): number | null {
  const lower = word.de.toLowerCase();
  const candidates = getCorpusWordSet();
  const maxHeadLen = Math.min(lower.length - 3, 14);
  // 4, not 3 -- a real audit against the whole corpus found 3-letter
  // "head" words (gar, nie, eng, wer, man, fan...) coincidentally
  // matching the start of a totally unrelated loanword often enough to
  // matter (Qualifikation -> "Qual", Garderobe -> "Gar", Niederlage ->
  // "Nie") -- a wrong-looking hint is worse than the plain half-split
  // fallback it would otherwise get, so this trades away a few
  // legitimate short matches (Fuß, Rad) to cut that false-positive rate
  // way down.
  for (let len = maxHeadLen; len >= 4; len--) {
    const head = lower.slice(0, len);
    if (!candidates.has(head)) continue;
    for (const link of LINKING_FRAGMENTS) {
      const cut = len + link.length;
      if (lower.length - cut < 3) continue;
      if (lower.slice(len, cut) === link) return cut;
    }
  }
  return null;
}

// Finds a linguistically real place to split `word.de`'s FIRST chunk off
// for round 2's hint, rather than an arbitrary letter-count half. Returns
// the character length of that first chunk, or null when nothing reliable
// is found — callers fall back to the plain half-letter split for those.
// Used as-is for verbs/adjectives/etc.; nouns go through generateHint's
// own finer-grained tiering instead (see there for why).
function splitMorphemePrefix(word: Word): number | null {
  return frontClosedPrefixLen(word) ?? frontGenericHeadLen(word);
}

// Closed list of common German noun-forming SUFFIXES -- grammatical
// endings that (unlike a genuine compound tail, see NOUN_COMPOUND_TAILS
// below) aren't standalone words on their own, so the "is this a real
// word?" corpus search further down can never catch them. Kept to
// suffixes that are reliably THIS suffix whenever a word happens to end
// in them, same bar VERB_PREFIXES/QUANTITY_PREFIXES hold their own closed
// lists to -- no "-e"/"-er"/"-in"-style 1-2 letter endings, which are far
// too common as ordinary word endings to mean anything on their own.
const NOUN_SUFFIXES = ['schaft', 'ismus', 'heit', 'keit', 'chen', 'lein', 'ling', 'tät', 'ung', 'nis', 'tum', 'anz', 'enz', 'sal', 'ion']
  .sort((a, b) => b.length - a.length);

// A small closed list of ordinary, high-frequency German nouns that very
// commonly sit as the RIGHT-hand half of a compound (Freitag, Geburtstag,
// Schulzeit, Ehemann...) -- real words, so in principle the generic
// corpus-word search below would eventually find them too, but several
// (tag, ort, amt, weg) are exactly the 3-letter length that search
// deliberately excludes (see splitMorphemePrefix's own comment on why:
// 3-letter matches false-positive too often across the WHOLE corpus to
// trust blindly). These specific ones are curated and safe at 3 letters
// precisely because they're being checked as compound TAILS, not heads --
// a word ending in "...tag" is far more reliably "some noun + Tag" than a
// word merely starting with "gar" is reliably "gar + something".
const NOUN_COMPOUND_TAILS = [
  'tag', 'jahr', 'zeit', 'mann', 'frau', 'kind', 'haus', 'wort', 'werk',
  'welt', 'land', 'stadt', 'raum', 'platz', 'stück', 'teil', 'punkt',
  'grund', 'kraft', 'macht', 'recht', 'wert', 'form', 'stelle', 'seite',
  'mittel', 'woche', 'monat', 'stunde', 'minute', 'amt', 'weg',
  // Deliberately NOT 'ort' despite being just as common a compound tail
  // (Vorort, Wohnort, Standort) -- a real corpus audit found it
  // false-positives on loanwords ending in "-port"/"-fort" purely by
  // coincidence (Export, Import, Transport, Komfort all end in "ort"
  // without being "Ex/Im/Trans/Kom" + "Ort" at all), a worse hit rate
  // than the false-positive bar the rest of this list clears.
].sort((a, b) => b.length - a.length);

// Mirror of frontClosedPrefixLen, but for the END of a NOUN — a curated
// compound-tail word (Tag, Jahr, Zeit, Haus...). German compounds put
// their semantic HEAD on the right (a "Haustür" is a kind of Tür, not a
// kind of Haus), so this is a genuinely common, low-false-positive
// pattern in its own right, same trust tier as a closed prefix list.
function backStrongTailLen(word: Word): number | null {
  const lower = word.de.toLowerCase();
  const n = lower.length;
  for (const t of NOUN_COMPOUND_TAILS) {
    if (lower.endsWith(t) && n - t.length >= 3) return t.length;
  }
  return null;
}

// Mirror of frontGenericHeadLen, but for the END — is some other whole
// corpus word recognizable at the END of this one (optionally preceded by
// a linking fragment)? Same coincidental-false-positive risk as the front
// version (Transport -> "sport", by sheer luck "Sport" is a real word) --
// lower-trust fallback tier, same reasoning.
function backGenericTailLen(word: Word): number | null {
  const lower = word.de.toLowerCase();
  const n = lower.length;
  const candidates = getCorpusWordSet();
  const maxTailLen = Math.min(n - 3, 14);
  for (let len = maxTailLen; len >= 4; len--) {
    const tail = lower.slice(n - len);
    if (!candidates.has(tail)) continue;
    for (const link of LINKING_FRAGMENTS) {
      const cut = len + link.length;
      if (n - cut < 3) continue;
      if (lower.slice(n - cut, n - len) === link) return cut;
    }
  }
  return null;
}

// The WEAKEST tier: a bare grammatical noun-forming suffix (-heit, -ung,
// -nis...) with no standalone meaning of its own — unlike a genuine
// compound tail (backStrongTailLen) or an actual recognizable word
// (backGenericTailLen), this carries almost no word-specific information,
// so generateHint only reaches for it once NEITHER side of the word has
// anything better to offer (a real audit found the opposite priority
// produces bad splits on long words -- "Arbeitserlaubnis" as
// "_____________nis", blanking 13 letters, when "Arbeits________" was
// sitting right there via the front side instead).
function backWeakSuffixLen(word: Word): number | null {
  const lower = word.de.toLowerCase();
  const n = lower.length;
  for (const s of NOUN_SUFFIXES) {
    if (lower.endsWith(s) && n - s.length >= 3) return s.length;
  }
  return null;
}

// A cheap, well-distributed-enough string hash (FNV-1a) -- not for
// anything security-sensitive, just needs to be STABLE across renders/
// reloads for the same word, which a real Math.random() seed can't be.
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A tiny deterministic PRNG seeded from that hash -- the same word always
// produces the same shuffle, so recomputing this (switching tabs and
// back, any other re-render) always reproduces the exact same reveal
// instead of a fresh draw that reads as a different card each time.
function seededRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Reveals `revealCount` letters scattered across the word instead of a
// contiguous front-or-back chunk -- used only when no confident morpheme
// boundary was found at all (see generateHint's own comment on why a
// contiguous fallback routinely left nothing but a generic grammatical
// ending to type). The first letter is always one of the revealed ones,
// same anchor guarantee the old contiguous fallback gave for free by
// always starting from position 0.
function scatteredReveal(word: string, letterIndices: number[], revealCount: number): Set<number> {
  if (letterIndices.length === 0) return new Set();
  const anchor = letterIndices[0];
  const rest = [...letterIndices.slice(1)];
  const rand = seededRandom(hashString(word));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const revealed = new Set(rest.slice(0, Math.max(0, revealCount - 1)));
  revealed.add(anchor);
  return revealed;
}

// How many of a word's LETTERS (not raw characters) fall inside a
// `morphemeLen`-character chunk at the given end.
function revealCountFor(morphemeLen: number, fromEnd: boolean, letterIndices: number[], n: number): number {
  return fromEnd
    ? letterIndices.filter(i => i >= n - morphemeLen).length
    : letterIndices.filter(i => i < morphemeLen).length;
}

// Picks between a front candidate and a back candidate for round 2's
// reveal, when both are at the same trust tier — whichever leaves the
// more balanced (closest to half the word's letters) reveal wins. An
// exact tie favors the back candidate: German compounds put their
// semantic head on the right (see backStrongTailLen's own comment), so
// that's this app's default direction when the two are otherwise
// indistinguishable (this is what keeps "Freitag" revealing "tag" rather
// than "frei", even though both are equally valid matches there).
function pickFrontOrBack(
  word: Word, frontLen: number | null, backLen: number | null, letterIndices: number[], n: number,
): { morphemeLen: number; fromEnd: boolean } | null {
  if (frontLen === null && backLen === null) return null;
  if (frontLen === null) return { morphemeLen: backLen!, fromEnd: true };
  if (backLen === null) return { morphemeLen: frontLen, fromEnd: false };

  // Before falling back to raw balance, check whether one direction
  // leaves the LOSING side looking like a genuine word while the other
  // wouldn't. A linking fragment absorbed by the winning side (see
  // LINKING_FRAGMENTS) effectively steals a letter from whatever's on the
  // other side -- confirmed real: "Landschaft"'s front match ("Lands",
  // absorbing the linking "s") was one letter narrower than "schaft" by
  // raw balance, so it won, but that left "chaft" (not a word) blanked
  // instead of "Land" (a word) -- one bare letter-count away from a much
  // cleaner split the other direction already had on offer. This check
  // catches that directly rather than trying to out-guess it via balance
  // math alone.
  const lower = word.de.toLowerCase();
  const candidates = getCorpusWordSet();
  const frontWinBlankIsWord = candidates.has(lower.slice(frontLen));
  const backWinBlankIsWord = candidates.has(lower.slice(0, n - backLen));
  if (frontWinBlankIsWord && !backWinBlankIsWord) return { morphemeLen: frontLen, fromEnd: false };
  if (backWinBlankIsWord && !frontWinBlankIsWord) return { morphemeLen: backLen, fromEnd: true };

  const target = letterIndices.length / 2;
  const frontDiff = Math.abs(revealCountFor(frontLen, false, letterIndices, n) - target);
  const backDiff = Math.abs(revealCountFor(backLen, true, letterIndices, n) - target);
  return backDiff <= frontDiff ? { morphemeLen: backLen, fromEnd: true } : { morphemeLen: frontLen, fromEnd: false };
}

// Returns hint pattern: true = hidden (user must type it), false = revealed (locked, pre-filled).
// Round 1: nothing revealed in the tiles (the word is shown separately as reference text).
// Round 2: reveal a real morpheme boundary when one is found with
// confidence, otherwise ~50% of letters as a plain fallback. For a NOUN,
// two trust tiers are tried in order, front OR back candidates competing
// within each tier (see pickFrontOrBack) before ever dropping to the
// next: (1) closed-list prefixes/compound-tails; (2) either a
// recognizable whole word at either edge, or (only on the back side, as
// its own fallback within this same tier) a bare grammatical suffix
// (-heit, -ung, -nis...) — see backWeakSuffixLen's own comment for why
// that one only competes here rather than going first. Non-nouns keep
// the front-only treatment. Whichever side wins is the one exception to
// "always includes the first letter" below — a back-side reveal's whole
// point is blanking the root, which usually starts at position 0.
// Round 4: no hints — full recall. (Round 3 — first-letter-only — was
// removed entirely; see Round's own comment.)
export function generateHint(word: Word, round: Round): boolean[] {
  const chars = [...word.de];
  const n = chars.length;
  const letterIndices = chars.map((c, i) => (isLetter(c) ? i : -1)).filter(i => i !== -1);

  let base: boolean[];
  if (round === 1 || round === 4) {
    base = Array.from({ length: n }, () => true);
  } else {
    // round 2 — see this function's own doc comment for the tiering.
    // Being fully deterministic means recomputing this (e.g. after
    // switching tabs and back) always reproduces the exact same reveal
    // instead of a fresh random draw that reads as a different card.
    let picked: { morphemeLen: number; fromEnd: boolean } | null = null;
    if (word.type === 'noun') {
      // Tier 2's back side folds the bare grammatical suffix in as its
      // own fallback (rather than a separate, subordinate tier 3) -- a
      // real audit found the strict-tiers version left "Freundschaft"
      // revealing "Freunds" and blanking the non-word fragment "chaft",
      // when the -schaft suffix match (revealing "schaft", blanking the
      // complete word "Freund") was sitting right there but never got a
      // turn to compete because tier 2's front-generic match had already
      // resolved things first.
      picked = pickFrontOrBack(word, frontClosedPrefixLen(word), backStrongTailLen(word), letterIndices, n)
        ?? pickFrontOrBack(word, frontGenericHeadLen(word), backGenericTailLen(word) ?? backWeakSuffixLen(word), letterIndices, n);
    } else {
      const frontLen = splitMorphemePrefix(word);
      if (frontLen !== null) picked = { morphemeLen: frontLen, fromEnd: false };
    }

    let revealed: Set<number>;
    if (picked !== null) {
      const revealCount = revealCountFor(picked.morphemeLen, picked.fromEnd, letterIndices, n);
      revealed = new Set(
        picked.fromEnd
          ? (revealCount > 0 ? letterIndices.slice(-revealCount) : [])
          : letterIndices.slice(0, revealCount),
      );
    } else {
      // No confident morpheme boundary anywhere in the word (mostly
      // verbs/adjectives/adverbs, which never get a noun's compound-tail
      // treatment) -- a real audit found the OLD plain front-half reveal
      // routinely left nothing but the grammatical ending to actually
      // type ("kümmern" -> "kümm___", "möchten" -> "möch___",
      // "trocken" -> "troc___"), which tests recall of a generic suffix
      // dozens of other words share, not the word itself. Scattering
      // which half is revealed instead of always the front forces
      // recall of the word as a whole.
      revealed = scatteredReveal(word.de, letterIndices, Math.max(1, Math.round(letterIndices.length / 2)));
    }
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
// go — the button itself is hidden then). STUDY only now — a review word
// demoting needs the stage-aware demoteReviewRound below instead, since
// round 3's removal means "one step back" no longer means the same thing
// for every stage (see its own comment).
export function requestHint(progress: WordProgress, currentRound: Round): { progress: WordProgress; nextRound: Round } {
  return {
    progress: { ...progress, lastPracticed: today() },
    nextRound: demoteRound(currentRound),
  };
}

// The review-side equivalent of requestHint/a wrong answer's demotion,
// used by BOTH applyReviewResult's own wrong branch and the round-ladder's
// Hint button in review mode. Round 3 no longer exists, so "one step
// back" can't just be currentRound-1 any more: puppy has only the one
// rung (round 2 — also its own REVIEW_PLAN.startRound, so "demoted" and
// "fresh" coincide there); medium's own fresh start is round 4 directly
// now (see REVIEW_PLAN), so its demotion target is NOT plan.startRound —
// a miss there is an explicit jump to round 2, a full extra round of
// scaffolding rather than a one-step demotion, since missing the
// near-mastery blind-recall test deserves more help, not less (explicit
// owner call). Both stages land on round 2 either way, just for
// different reasons — hardcoded rather than derived from REVIEW_PLAN so
// a future change to medium's own startRound can't silently change what
// a miss demotes to.
export function demoteReviewRound(stage: 'puppy' | 'medium'): Round {
  return 2;
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

// Review scoring for the two stages that still use the round-ladder at
// all (puppy and medium — see REVIEW_PLAN's own comment for why 'short'
// isn't handled here; it goes through the reversed-MCQ batch instead,
// see DailySessionFlow's handleReviewMcqReversedAnswer). On a fresh,
// never-demoted visit each stage has exactly ONE round to pass (puppy:
// round 2, medium: round 4), so a correct answer usually completes the
// milestone outright. The one exception: after a medium-stage miss
// demotes to round 2 (see demoteReviewRound), a correct round-2 retry
// only climbs BACK to round 4 rather than completing the milestone from
// there — passing the easier scaffolded round isn't the same as passing
// the actual no-hint test, so the word still has to clear round 4 for
// real before it's mastered.
export function applyReviewResult(progress: WordProgress, correct: boolean, currentRound: Round): ReviewOutcome {
  const t = today();

  // Not actually due yet — only reachable via "Review Extra" pulling in a
  // word early. That's bonus practice: gives feedback, but doesn't touch
  // the schedule or round, since reviewing early doesn't tell us anything
  // about long-term recall the way an on-schedule review does.
  if (progress.nextReviewDue && progress.nextReviewDue > t) {
    return { progress, nextRound: currentRound, isFinal: true, scored: false };
  }

  const stage = (progress.mascotStage === 'medium' ? 'medium' : 'puppy') as 'puppy' | 'medium';
  const plan = REVIEW_PLAN[stage];

  if (correct) {
    if (currentRound >= plan.capRound) {
      return { progress: recordMilestonePass(progress, plan.nextStage, t), nextRound: plan.capRound, isFinal: true, scored: true };
    }
    // Only medium can be "correct but below cap" now (a post-demotion
    // round-2 retry climbing back toward round 4) — puppy's single rung
    // IS its cap round, so it always takes the branch above instead.
    // Rounds no longer form a contiguous ladder (3 is gone), so this is
    // a direct jump to capRound, not a "+1".
    return { progress: { ...progress, lastPracticed: t }, nextRound: plan.capRound, isFinal: false, scored: true };
  }

  return { progress: { ...progress, lastPracticed: t }, nextRound: demoteReviewRound(stage), isFinal: false, scored: true };
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

// Splits a gloss like "recipe / prescription" or "caregiver, supervisor"
// into its individual meanings, lowercased and trimmed — both shapes are
// real (see lib/words.ts), and buildReverseMcqChoices below needs to spot
// a PARTIAL overlap between two words' glosses, not just an exact
// full-string duplicate.
function glossTokens(gloss: string): string[] {
  return gloss.toLowerCase().split(/[/,]/).map(s => s.trim()).filter(Boolean);
}

// The reverse direction of buildMcqChoices: the German word is shown, the
// learner picks its MEANING (in nativeLanguage) from 4 choices. Same
// same-category+type -> same-type -> same-level fallback pool as
// buildMcqChoices, for the same reason (a distractor from outside the
// word's own level/word-class is either unrecognizable or trivially easy
// to rule out by shape alone) — but with one extra exclusion that
// direction never needed: two DIFFERENT German words routinely share the
// exact same translation (a real corpus audit found 59 such pairs at the
// same level+type — "Kellner"/"Ober" both gloss "waiter", "Arzt"/"Doktor"
// both "doctor"), which would show that translation as both the correct
// answer AND a wrong choice — confusing at best, genuinely unresolvable
// at worst. Checked via glossTokens so a partial overlap (one word's
// gloss is "prescription", another's is "recipe / prescription") is
// caught too, not just an exact match.
export function buildReverseMcqChoices(
  word: Word, nativeLanguage: 'en' | 'zh', seen: string[] = [],
): { correct: string; choices: string[] } {
  const correctGloss = glossFor(word, nativeLanguage);
  const correctTokens = glossTokens(correctGloss);
  const seenTokens = new Set(seen.flatMap(glossTokens));
  const picked = new Set<string>();
  const wrongChoices: string[] = [];

  const addFrom = (pool: Word[]) => {
    for (const w of shuffled(pool)) {
      if (wrongChoices.length >= 3) break;
      const gloss = glossFor(w, nativeLanguage);
      const key = gloss.toLowerCase();
      if (picked.has(key)) continue;
      const tokens = glossTokens(gloss);
      if (tokens.some(t => correctTokens.includes(t) || seenTokens.has(t))) continue;
      picked.add(key);
      wrongChoices.push(gloss);
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

  return { correct: correctGloss, choices: shuffled([correctGloss, ...wrongChoices]) };
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

// The end-of-introduction bonus: an AI-written German paragraph using every
// word in a batch (see buildParagraphBatches), each blanked out and dragged
// back in by meaning — see generate-paragraph's own comment for the full
// generation contract. Optional/skippable, never touches mastery/growth
// scoring, same reinforcement-only status as the matching-quiz recap.
export const MIN_PARAGRAPH_WORDS = 3;
export const MAX_PARAGRAPH_WORDS = 5;

// Splits a day's newly-introduced words into paragraph-sized batches: at
// most MAX_PARAGRAPH_WORDS each (a paragraph naturally sized for a
// learner's level starts feeling stuffed well before 6+ blanks — see the
// per-level word-count caps in generate-paragraph), any remainder batch
// under MIN_PARAGRAPH_WORDS dropped entirely rather than forced into its
// own too-thin paragraph. A 5-word day is one exercise; a 6-word day is a
// 5 + a dropped leftover 1 (not a strained 6-blank paragraph, not a padded
// second exercise); an 8-word day is 5 + 3.
export function buildParagraphBatches(words: Word[]): Word[][] {
  const batches: Word[][] = [];
  for (let i = 0; i < words.length; i += MAX_PARAGRAPH_WORDS) {
    batches.push(words.slice(i, i + MAX_PARAGRAPH_WORDS));
  }
  return batches.filter(b => b.length >= MIN_PARAGRAPH_WORDS);
}

// If every word in a batch shares the same corpus `category`, surfaced as a
// hint the AI is encouraged (not required) to build its scene around —
// most batches won't have this (only ~28% of the corpus has a category
// tagged at all), so the generator has to be robust to a themeless mix
// anyway; this just makes the easy case easier when it happens to line up.
export function sharedCategoryHint(words: Word[]): string | undefined {
  const first = words[0]?.category;
  if (!first) return undefined;
  return words.every(w => w.category === first) ? first : undefined;
}

// Parses generate-paragraph's raw `{paragraph, answers}` response (see that
// function's own comment) into the segments/blanks shape the UI wants, and
// validates it's actually usable: exactly one `[[i]]` placeholder per word,
// no duplicates, no gaps. Returns null on anything malformed rather than
// throwing -- a bad AI response should read as "couldn't build today's
// story" (skippable, see DailySessionFlow), not crash the session.
export function parseParagraphResponse(paragraph: string, answers: string[], words: Word[]): ParagraphExercise | null {
  if (!paragraph || !Array.isArray(answers) || answers.length !== words.length) return null;
  const placeholder = /\[\[(\d+)\]\]/g;
  const seen = new Set<number>();
  const segments: string[] = [];
  const blanks: ParagraphBlank[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = placeholder.exec(paragraph))) {
    const idx = Number(match[1]);
    if (idx < 0 || idx >= words.length || seen.has(idx)) return null;
    seen.add(idx);
    segments.push(paragraph.slice(lastEnd, match.index));
    blanks.push({ wordId: words[idx].id, answer: answers[idx] });
    lastEnd = match.index + match[0].length;
  }
  segments.push(paragraph.slice(lastEnd));
  if (seen.size !== words.length) return null;
  return { segments, blanks, tray: shuffled(answers) };
}
