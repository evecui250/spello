'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getDailySession, saveDailySession, DailySession, SessionPhase,
  getWordProgress, saveWordProgress, getAllProgress, getSettings, today,
  MAX_ROUND, Round, WordProgress, MascotStageId, Settings,
  isStudyGoalDoneToday, isReviewGoalDoneToday, markStudyGoalDone, markReviewGoalDone,
  touchStreak, markCongratsShown, getDailyStats, addEarnedPuppy, addEarnedUpgrade,
} from '../lib/storage';
import {
  wordsById, generateHint, checkAnswer, applyResult, applyReviewResult, requestHint, REVIEW_BASE_ROUND,
  allAttemptedRound, buildMcqChoices, buildMatchingPages,
} from '../lib/practice';
import { Word } from '../lib/words';
import LetterInputRow, { LetterInputRowHandle } from './LetterInputRow';
import SpecialCharButtons from './SpecialCharButtons';
import SpeakerButton from './SpeakerButton';
import TranslationChoiceCard from './TranslationChoiceCard';
import MatchingQuizPage from './MatchingQuizPage';
import DachshundMascot from './Mascot';
import CongratsModal from './CongratsModal';
import { speakWord } from '../lib/speech';
import { scheduleSync } from '../lib/sync';
import { correctSentence } from '../lib/ai';

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// Locates wordForm inside sentence (case-insensitive) so callers can
// highlight/blank it — used by both BlankedSentence (rounds 2+/review) and
// the round-1 corrected-sentence display (underlines the target word).
function splitOnWordForm(sentence: string, wordForm: string): { before: string; match: string; after: string } | null {
  const idx = sentence.toLowerCase().indexOf(wordForm.toLowerCase());
  if (idx === -1) return null;
  return {
    before: sentence.slice(0, idx),
    match: sentence.slice(idx, idx + wordForm.length),
    after: sentence.slice(idx + wordForm.length),
  };
}

const ROUND_LABELS: Record<Round, string> = {
  1: 'Round 1 — use it in a sentence',
  2: 'Round 2 — half the letters hinted',
  3: 'Round 3 — first letter hint',
  4: 'Round 4 — no hints',
};

const STAGE_ORDER: MascotStageId[] = ['puppy', 'short', 'medium', 'long-crowned'];

type RoundMode = 'study' | 'review';

// Round 1: instead of copying the word, the learner invents their own
// sentence using it — wrong grammar/English mixed in is expected — and an
// AI correction becomes the word's permanent example sentence (shown on
// Word List and, blanked out, on later rounds — see BlankedSentence below).
// Requires sign-in (enforced app-wide by AuthGate, see app/layout.tsx),
// since the AI call needs a real user to log usage against.
// Shown above both the input step and the result step (see the parent's
// currentRound === 1 branch) so the word stays visible throughout — the
// correction lands on the same card instead of swapping to what reads as a
// different screen. No "New word" caption here: the New/Continuing/Review
// badge already at the top of the card says that.
function SentenceWordHeader({ word }: { word: Word }) {
  return (
    <div className="text-center -mt-1">
      <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide">
        {word.article ? `${word.article} ` : ''}{word.de}{' '}
        <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
      </div>
    </div>
  );
}

function SentenceExercise({
  word, level, onCorrected,
}: {
  word: Word;
  level: string;
  onCorrected: (correction: { sentence: string; wordForm: string }) => void;
}) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'not-used'>('idle');

  async function handleSubmit() {
    if (!input.trim() || status === 'loading') return;
    setStatus('loading');
    try {
      const result = await correctSentence(word.id, word.de, level, input.trim());
      if (!result.used) {
        setStatus('not-used');
        return;
      }
      onCorrected(result);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SentenceWordHeader word={word} />
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Create your own sentence!</div>
        <textarea
          value={input}
          onChange={e => { setInput(e.target.value); if (status === 'not-used') setStatus('idle'); }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={status === 'loading'}
          placeholder="Don't worry about grammar — mixing in English is fine too, we'll turn it into correct German."
          rows={2}
          className="w-full border-2 border-indigo-100 rounded-xl px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-indigo-300 resize-none disabled:opacity-60"
        />
      </div>
      {status === 'not-used' && (
        <p className="text-amber-700 text-sm text-center">
          Try to actually use "{word.de}" somewhere in your sentence (any form is fine).
        </p>
      )}
      {status === 'error' && (
        <p className="text-red-600 text-sm text-center">Couldn't get a correction — check your connection and try again.</p>
      )}
      <button
        onClick={handleSubmit}
        disabled={!input.trim() || status === 'loading'}
        className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
      >
        {status === 'loading' ? 'Checking…' : 'Check'}
      </button>
    </div>
  );
}

// Extra reinforcement on rounds 2-4 / review (never touches scoring): shows
// the AI-corrected example sentence from this word's round 1, with the word
// itself blanked out until the round is answered. wordForm is the exact
// inflected substring the AI reported using, so the blank lines up with
// however the word actually appears in the sentence (which may differ from
// its dictionary form, e.g. plural/case endings).
function BlankedSentence({ example, revealed }: { example: { sentence: string; wordForm: string }; revealed: boolean }) {
  const parts = splitOnWordForm(example.sentence, example.wordForm);
  if (!parts) {
    if (!revealed) return null;
    return (
      <div className="text-center bg-indigo-50 rounded-xl px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1">Your sentence</div>
        <div className="text-stone-700 italic">{example.sentence}</div>
      </div>
    );
  }
  return (
    <div className="text-center bg-indigo-50 rounded-xl px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1">Your sentence</div>
      <div className="text-stone-700 italic">
        {parts.before}
        <span className={revealed ? 'font-bold text-indigo-700 not-italic' : 'inline-block bg-indigo-200 text-transparent rounded select-none'}>
          {revealed ? parts.match : ' '.repeat(Math.max(parts.match.length, 3))}
        </span>
        {parts.after}
      </div>
    </div>
  );
}

function isRoundsDone(id: string, mode: RoundMode): boolean {
  const p = getWordProgress(id);
  if (mode === 'study') return p.round >= MAX_ROUND;
  return !!(p.nextReviewDue && p.nextReviewDue > today());
}

export default function DailySessionFlow() {
  const router = useRouter();
  const [session, setSession] = useState<DailySession | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ready, setReady] = useState(false);

  const [queue, setQueue] = useState<Word[]>([]);
  const [totalWords, setTotalWords] = useState(0);
  const reviewRoundsRef = useRef<Record<string, Round>>({});

  const [currentRound, setCurrentRound] = useState<Round>(1);
  const [hint, setHint] = useState<boolean[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [articleValues, setArticleValues] = useState<string[]>(['', '', '']);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);

  // Bumped on every matching-quiz page completion so MatchingQuizPage always
  // remounts fresh for the next page.
  const [matchingPageKey, setMatchingPageKey] = useState(0);
  const [mcqCurrent, setMcqCurrent] = useState<{ word: Word; choices: string[] } | null>(null);
  // The current word's saved example sentence (round 2+/review only — see
  // BlankedSentence), and the just-produced correction for the round-1
  // sentence exercise (shown in place of the generic "✓ Correct!" banner).
  const [exampleSentence, setExampleSentence] = useState<{ sentence: string; wordForm: string } | null>(null);
  const [sentenceResult, setSentenceResult] = useState<{ sentence: string; wordForm: string } | null>(null);
  // "Review" = already fully learned, back for spaced repetition. "New" =
  // never touched before today. "Continuing" = mid-ladder from a PREVIOUS
  // day (not brand new, hasn't reached round 4 yet either) — this is the
  // one that looks confusingly like "new" without a label, since it still
  // shows up in the study queue and can start anywhere from round 2-4.
  const [wordStatus, setWordStatus] = useState<'New' | 'Continuing' | 'Review'>('New');
  // Choices already shown per word this round-1.5 pass, in-memory only (a
  // retry within the redo loop should get fresh distractors; losing this on
  // a reload is a harmless cosmetic detail, not a correctness issue).
  const mcqSeenRef = useRef<Record<string, string[]>>({});
  const [showCongrats, setShowCongrats] = useState(false);

  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const letterRowRef = useRef<LetterInputRowHandle | null>(null);
  const articleRowRef = useRef<LetterInputRowHandle | null>(null);
  const handleNextRef = useRef<() => void>(() => {});

  const roundMode: RoundMode = session?.phase === 'review-rounds' ? 'review' : 'study';
  const word = queue[0] ?? null;
  const needsArticle = !!(settings?.requireArticle && word?.type === 'noun' && word?.article);

  function persistSession(next: DailySession) {
    setSession(next);
    saveDailySession(next);
  }

  const loadCurrent = (w: Word, mode: RoundMode) => {
    const progress = getWordProgress(w.id);
    const round = mode === 'review' ? (reviewRoundsRef.current[w.id] ?? REVIEW_BASE_ROUND) : progress.round;
    setCurrentRound(round);
    const h = generateHint(w.de, round);
    const chars = [...w.de];
    setHint(h);
    setValues(chars.map((c, i) => (h[i] ? '' : c)));
    setArticleValues(['', '', '']);
    setFeedback(null);
    setJustCompleted(false);
    setAttemptKey(k => k + 1);
    setExampleSentence(progress.exampleSentence ?? null);
    setSentenceResult(null);
    setWordStatus(mode === 'review' ? 'Review' : (progress.lastPracticed && progress.lastPracticed !== today() ? 'Continuing' : 'New'));
    if (round === 1 && getSettings().autoPlayAudio) speakWord(w);
  };

  function enterRoundsPhase(ds: DailySession, mode: RoundMode) {
    const ids = mode === 'study' ? ds.studyWordIds : ds.reviewWordIds;
    // Resume the exact in-session order if one was already persisted (see
    // studyQueueIds/reviewQueueIds); only the very first entry into this
    // phase this session falls back to computing it fresh from `ids`.
    const persistedQueueIds = mode === 'study' ? ds.studyQueueIds : ds.reviewQueueIds;
    const sourceIds = persistedQueueIds !== undefined ? persistedQueueIds : ids;
    const pending = sourceIds.filter(id => !isRoundsDone(id, mode));
    const words = wordsById(pending);
    setQueue(words);
    setTotalWords(ids.length);
    reviewRoundsRef.current = {};
    const withQueue: DailySession = mode === 'study'
      ? { ...ds, studyQueueIds: pending }
      : { ...ds, reviewQueueIds: pending };
    persistSession(withQueue);
    if (words.length > 0) {
      loadCurrent(words[0], mode);
    } else if (mode === 'study') {
      finishStudyRounds(withQueue);
    } else {
      finishReviewRounds(withQueue);
    }
  }

  // Round 1.5: every word in mcqQueueIds gets asked once; wrong ones queue
  // up in mcqWrongIds and get redone (with fresh choices) as soon as this
  // pass finishes — repeating until a full pass is clean, then back to the
  // round ladder for round 2 onward.
  function enterMcqPhase(ds: DailySession) {
    if (ds.mcqQueueIds.length === 0) {
      if (ds.mcqWrongIds.length === 0) {
        const next: DailySession = { ...ds, phase: 'study-rounds' };
        persistSession(next);
        enterRoundsPhase(next, 'study');
        return;
      }
      const next: DailySession = { ...ds, mcqQueueIds: shuffled(ds.mcqWrongIds), mcqWrongIds: [] };
      persistSession(next);
      enterMcqPhase(next);
      return;
    }
    const w = wordsById([ds.mcqQueueIds[0]])[0];
    if (!w) {
      const next: DailySession = { ...ds, mcqQueueIds: ds.mcqQueueIds.slice(1) };
      persistSession(next);
      enterMcqPhase(next);
      return;
    }
    const { choices } = buildMcqChoices(w, mcqSeenRef.current[w.id] ?? []);
    mcqSeenRef.current[w.id] = [...(mcqSeenRef.current[w.id] ?? []), ...choices];
    setMcqCurrent({ word: w, choices });
  }

  // Round 2.5 — same idea as round 1.5 above, fired again once every word's
  // had its first attempt at round 2, using the parallel mcq2* fields so it
  // doesn't interfere with checkpoint 1's own (already-drained) queue.
  function enterMcq2Phase(ds: DailySession) {
    if (ds.mcq2QueueIds.length === 0) {
      if (ds.mcq2WrongIds.length === 0) {
        const next: DailySession = { ...ds, phase: 'study-rounds' };
        persistSession(next);
        enterRoundsPhase(next, 'study');
        return;
      }
      const next: DailySession = { ...ds, mcq2QueueIds: shuffled(ds.mcq2WrongIds), mcq2WrongIds: [] };
      persistSession(next);
      enterMcq2Phase(next);
      return;
    }
    const w = wordsById([ds.mcq2QueueIds[0]])[0];
    if (!w) {
      const next: DailySession = { ...ds, mcq2QueueIds: ds.mcq2QueueIds.slice(1) };
      persistSession(next);
      enterMcq2Phase(next);
      return;
    }
    const { choices } = buildMcqChoices(w, mcqSeenRef.current[w.id] ?? []);
    mcqSeenRef.current[w.id] = [...(mcqSeenRef.current[w.id] ?? []), ...choices];
    setMcqCurrent({ word: w, choices });
  }

  // Pre-review reminder for a word's first or second review (see
  // reviewMcqQueueIds) — a single pass, no retry-until-clean loop, since
  // this is a warmup nudge before the recall test, not a mastery gate.
  function enterReviewMcqPhase(ds: DailySession) {
    if (ds.reviewMcqQueueIds.length === 0) {
      const next: DailySession = { ...ds, phase: 'review-rounds' };
      persistSession(next);
      enterRoundsPhase(next, 'review');
      return;
    }
    const w = wordsById([ds.reviewMcqQueueIds[0]])[0];
    if (!w) {
      const next: DailySession = { ...ds, reviewMcqQueueIds: ds.reviewMcqQueueIds.slice(1) };
      persistSession(next);
      enterReviewMcqPhase(next);
      return;
    }
    const { choices } = buildMcqChoices(w, mcqSeenRef.current[w.id] ?? []);
    mcqSeenRef.current[w.id] = [...(mcqSeenRef.current[w.id] ?? []), ...choices];
    setMcqCurrent({ word: w, choices });
  }

  // --- Mount: load today's session (Home always creates one before routing
  // here) and resume at whatever phase it's at. ---
  useEffect(() => {
    const s = getSettings();
    setSettings(s);
    const ds = getDailySession();
    if (!ds) { setReady(true); return; }

    // Idempotent: a batch that was empty from the very start still needs its
    // goal marked done, since its phase never visits the normal completion
    // transition that would otherwise do this.
    if (ds.studyWordIds.length === 0 && !isStudyGoalDoneToday()) markStudyGoalDone(0);
    if (ds.reviewWordIds.length === 0 && !isReviewGoalDoneToday()) markReviewGoalDone(0);

    setSession(ds);
    if (ds.phase === 'study-rounds') enterRoundsPhase(ds, 'study');
    else if (ds.phase === 'study-mcq') enterMcqPhase(ds);
    else if (ds.phase === 'study-mcq-2') enterMcq2Phase(ds);
    else if (ds.phase === 'review-mcq') enterReviewMcqPhase(ds);
    else if (ds.phase === 'review-rounds') enterRoundsPhase(ds, 'review');
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- report phase: auto-skip straight to congrats when nothing upgraded ---
  useEffect(() => {
    if (!session || session.phase !== 'report') return;
    const total = Object.values(session.earnedUpgrades).reduce((a, b) => a + (b ?? 0), 0);
    if (total === 0) persistSession({ ...session, phase: 'congrats' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.phase]);

  // --- congrats phase: fire streak/congrats bookkeeping once, then show the modal ---
  useEffect(() => {
    if (!session || session.phase !== 'congrats') return;
    const stats = getDailyStats();
    if (stats.studyDone && stats.reviewDone && !stats.congratsShown) {
      touchStreak();
      markCongratsShown();
    }
    setShowCongrats(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.phase]);

  const submitResult = (correct: boolean, extra?: Partial<WordProgress>) => {
    if (!session || !word || !settings || feedback !== null) return;
    const progress = getWordProgress(word.id);
    const beforeStage = progress.mascotStage;

    if (roundMode === 'review') {
      const outcome = applyReviewResult(progress, correct, currentRound);
      if (outcome.isFinal) delete reviewRoundsRef.current[word.id];
      else reviewRoundsRef.current[word.id] = outcome.nextRound;

      saveWordProgress(outcome.progress);
      scheduleSync();
      setFeedback(correct);
      setJustCompleted(outcome.isFinal);

      if (outcome.isFinal && outcome.scored && correct && beforeStage !== outcome.progress.mascotStage) {
        const stage = outcome.progress.mascotStage;
        persistSession({
          ...session,
          earnedUpgrades: { ...session.earnedUpgrades, [stage]: (session.earnedUpgrades[stage] ?? 0) + 1 },
        });
        addEarnedUpgrade(stage);
      }
    } else {
      const roundBefore = progress.round;
      const updated = { ...applyResult(progress, correct), ...extra };
      const completed = progress.round === MAX_ROUND && correct;
      const earnedBadge = updated.studiedTimes > progress.studiedTimes;

      saveWordProgress(updated);
      scheduleSync();
      setFeedback(correct);
      setJustCompleted(completed);

      // Record this word's first attempt at round 1 (resp. round 2) whether
      // it was right or wrong — see allAttemptedRound: a wrong answer that
      // leaves the word at the same round must still let the checkpoint
      // arrive once every word's had its shot, not wait for every word to
      // eventually answer correctly.
      let nextSession = session;
      if (roundBefore === 1 && !session.round1AttemptedIds.includes(word.id)) {
        nextSession = { ...nextSession, round1AttemptedIds: [...nextSession.round1AttemptedIds, word.id] };
      } else if (roundBefore === 2 && !session.round2AttemptedIds.includes(word.id)) {
        nextSession = { ...nextSession, round2AttemptedIds: [...nextSession.round2AttemptedIds, word.id] };
      }
      if (earnedBadge) {
        nextSession = { ...nextSession, earnedPuppies: nextSession.earnedPuppies + 1 };
      }
      if (nextSession !== session) persistSession(nextSession);
      if (earnedBadge) addEarnedPuppy();
    }

    if (settings.autoPlayAudio) speakWord(word);
  };

  const handleSubmit = () => {
    if (!word || !wordComplete) return;
    const wordRight = checkAnswer(word.de, values.join(''));
    const articleGuess = articleValues.join('').toLowerCase();
    const articleRight = !needsArticle || articleGuess === word.article;
    submitResult(wordRight && articleRight);
  };
  // A deliberate "give me more help" request — demotes one round (more
  // scaffolding) instead of retrying the same round the way a wrong typed
  // answer does. Not available at round 1 (nothing lower to demote to); the
  // button itself is hidden then. Counts as a mistake for SRS purposes, same
  // as a wrong answer, since the learner didn't recall it unaided.
  const handleHint = () => {
    if (!word || feedback !== null || currentRound <= 1) return;
    const progress = getWordProgress(word.id);
    const { progress: updated, nextRound } = requestHint(progress, currentRound);
    const finalProgress = roundMode === 'study' ? { ...updated, round: nextRound } : updated;
    saveWordProgress(finalProgress);
    scheduleSync();
    if (roundMode === 'review') reviewRoundsRef.current[word.id] = nextRound;

    setCurrentRound(nextRound);
    const h = generateHint(word.de, nextRound);
    const chars = [...word.de];
    setHint(h);
    setValues(chars.map((c, i) => (h[i] ? '' : c)));
    setArticleValues(['', '', '']);
    setAttemptKey(k => k + 1);
  };

  function finishStudyRounds(ds: DailySession) {
    // Pages are fully padded to 5 (or fewer, only if the whole batch is
    // under 5) up front, so the queue is just consumed 5 at a time — see
    // currentMatchingPage/handleMatchingPageComplete.
    persistSession({ ...ds, phase: 'study-matching', matchingQueueIds: buildMatchingPages(ds.studyWordIds).flat() });
  }
  function finishReviewRounds(ds: DailySession) {
    persistSession({ ...ds, phase: 'review-matching', matchingQueueIds: buildMatchingPages(ds.reviewWordIds).flat() });
  }

  function handleMcqBatchAnswer(correct: boolean) {
    if (!session || !mcqCurrent) return;
    if (session.phase === 'study-mcq-2') {
      const rest = session.mcq2QueueIds.slice(1);
      const wrong = correct ? session.mcq2WrongIds : [...session.mcq2WrongIds, mcqCurrent.word.id];
      const next: DailySession = { ...session, mcq2QueueIds: rest, mcq2WrongIds: wrong };
      setMcqCurrent(null);
      persistSession(next);
      enterMcq2Phase(next);
      return;
    }
    const rest = session.mcqQueueIds.slice(1);
    const wrong = correct ? session.mcqWrongIds : [...session.mcqWrongIds, mcqCurrent.word.id];
    const next: DailySession = { ...session, mcqQueueIds: rest, mcqWrongIds: wrong };
    setMcqCurrent(null);
    persistSession(next);
    enterMcqPhase(next);
  }

  // Pre-review reminder: just moves on regardless of right/wrong — see
  // enterReviewMcqPhase.
  function handleReviewMcqAnswer() {
    if (!session || !mcqCurrent) return;
    const next: DailySession = { ...session, reviewMcqQueueIds: session.reviewMcqQueueIds.slice(1) };
    setMcqCurrent(null);
    persistSession(next);
    enterReviewMcqPhase(next);
  }

  function advanceStudyQueue() {
    if (!session) return;
    const rest = queue.slice(1);
    if (!justCompleted) rest.push(queue[0]);
    setQueue(rest);
    const restIds = rest.map(w => w.id);

    const progress = getAllProgress();
    if (session.mcqQueueIds.length > 0 && allAttemptedRound(session.studyWordIds, progress, 1, session.round1AttemptedIds)) {
      const next: DailySession = { ...session, phase: 'study-mcq', studyQueueIds: restIds };
      persistSession(next);
      enterMcqPhase(next);
      return;
    }
    // Checkpoint 2 only becomes reachable once checkpoint 1 has fully
    // drained — its own gate can't be satisfied before checkpoint 1's
    // anyway (round 2 needs round 1 first), but this keeps the two in their
    // natural order rather than relying on that alone.
    if (session.mcqQueueIds.length === 0 && session.mcq2QueueIds.length > 0
      && allAttemptedRound(session.studyWordIds, progress, 2, session.round2AttemptedIds)) {
      const next: DailySession = { ...session, phase: 'study-mcq-2', studyQueueIds: restIds };
      persistSession(next);
      enterMcq2Phase(next);
      return;
    }

    const next: DailySession = { ...session, studyQueueIds: restIds };
    persistSession(next);
    if (rest.length > 0) loadCurrent(rest[0], 'study');
    else finishStudyRounds(next);
  }

  function advanceReviewQueue() {
    if (!session) return;
    const rest = queue.slice(1);
    if (!justCompleted) rest.push(queue[0]);
    setQueue(rest);
    const next: DailySession = { ...session, reviewQueueIds: rest.map(w => w.id) };
    persistSession(next);
    if (rest.length > 0) loadCurrent(rest[0], 'review');
    else finishReviewRounds(next);
  }

  const handleNext = () => {
    if (!session || !word) return;
    if (roundMode === 'review') {
      advanceReviewQueue();
      return;
    }
    advanceStudyQueue();
  };
  handleNextRef.current = handleNext;

  function currentMatchingPage(ds: DailySession): Word[] {
    return wordsById(ds.matchingQueueIds.slice(0, 5));
  }

  function handleMatchingPageComplete() {
    if (!session) return;
    setMatchingPageKey(k => k + 1);
    const remainingQueue = session.matchingQueueIds.slice(5);

    if (remainingQueue.length > 0) {
      persistSession({ ...session, matchingQueueIds: remainingQueue });
      return;
    }
    finishMatchingPhase(session);
  }

  function finishMatchingPhase(ds: DailySession) {
    if (ds.phase === 'study-matching') {
      markStudyGoalDone(ds.studyWordIds.length);
      if (ds.reviewWordIds.length === 0) {
        // Nothing to review today — skip the "Continue to review" interim
        // screen entirely and go straight toward the congrats card (via
        // 'report', which itself auto-skips to 'congrats' if there's
        // nothing to show there either).
        markReviewGoalDone(0);
        persistSession({ ...ds, phase: 'report' });
      } else {
        persistSession({ ...ds, phase: 'study-done' });
      }
    } else {
      markReviewGoalDone(ds.reviewWordIds.length);
      persistSession({ ...ds, phase: 'report' });
    }
  }

  function handleContinueToReview() {
    if (!session) return;
    if (session.reviewMcqQueueIds.length > 0) {
      const next: DailySession = { ...session, phase: 'review-mcq' };
      persistSession(next);
      enterReviewMcqPhase(next);
    } else if (session.reviewWordIds.length > 0) {
      const next: DailySession = { ...session, phase: 'review-rounds' };
      persistSession(next);
      enterRoundsPhase(next, 'review');
    } else {
      markReviewGoalDone(0);
      persistSession({ ...session, phase: 'report' });
    }
  }

  function handleContinueFromReport() {
    if (!session) return;
    persistSession({ ...session, phase: 'congrats' });
  }

  function handleCloseCongrats() {
    setShowCongrats(false);
    if (session) persistSession({ ...session, phase: 'done' });
    router.push('/');
  }

  // Enter advances past feedback; a correct answer also auto-advances. Only
  // live during the actual round-ladder screens — otherwise a stale
  // `feedback` left over from the round just before an MCQ/matching phase
  // started would fire handleNext (built for the round queue) into a screen
  // it knows nothing about. Re-evaluated on phase changes too, so a phase
  // change on its own (without `feedback` changing) still clears any
  // pending auto-advance timer from the round that just ended.
  const isRoundScreen = session?.phase === 'study-rounds' || session?.phase === 'review-rounds';
  useEffect(() => {
    if (feedback === null || !isRoundScreen) return;
    let armed = false;
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Enter') armed = true; };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter' && armed) handleNextRef.current(); };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onKeyDown);
    // Suppressed for the round-1 sentence exercise — the corrected sentence
    // needs a moment to actually read, not a fixed 1.5s flash, so that case
    // waits for the learner's own "Next" click instead.
    const isSentenceRoundDone = currentRound === 1 && roundMode === 'study' && sentenceResult !== null;
    const timer = feedback === true && !isSentenceRoundDone ? setTimeout(() => handleNextRef.current(), 1500) : undefined;
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keydown', onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [feedback, isRoundScreen]);

  const articleComplete = !needsArticle || articleValues.every(v => !!v);
  const wordComplete = hint.length > 0 && hint.every((h, i) => !h || !!values[i]) && articleComplete;
  const completedCount = totalWords - queue.length;
  const progressPct = totalWords > 0 ? Math.min(100, Math.round((completedCount / totalWords) * 100)) : 0;

  if (!ready || !settings) return null;

  if (!session) {
    return (
      <div className="text-center py-16">
        <p className="text-emerald-100/70 mb-6">No session started yet today.</p>
        <Link href="/" className="text-amber-200 underline">Back to Home</Link>
      </div>
    );
  }

  if (session.phase === 'study-mcq' || session.phase === 'study-mcq-2') {
    if (!mcqCurrent) return null;
    return <TranslationChoiceCard key={mcqCurrent.word.id} word={mcqCurrent.word} choices={mcqCurrent.choices} onAnswer={handleMcqBatchAnswer} />;
  }

  if (session.phase === 'review-mcq') {
    if (!mcqCurrent) return null;
    return <TranslationChoiceCard key={mcqCurrent.word.id} word={mcqCurrent.word} choices={mcqCurrent.choices} onAnswer={handleReviewMcqAnswer} />;
  }

  if (session.phase === 'study-matching' || session.phase === 'review-matching') {
    const page = currentMatchingPage(session);
    if (page.length === 0) return null;
    return <MatchingQuizPage key={matchingPageKey} words={page} onComplete={handleMatchingPageComplete} />;
  }

  if (session.phase === 'study-done') {
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          Study complete!
        </h2>
        <p className="text-amber-100/80 mb-6">
          Today {session.studyWordIds.length} word{session.studyWordIds.length === 1 ? '' : 's'} learned.
        </p>
        {session.earnedPuppies > 0 && (
          <div className="mx-auto mb-6 max-w-xs bg-amber-50/75 backdrop-blur-sm border border-amber-100/50 rounded-2xl px-5 py-4 flex flex-col items-center gap-1.5">
            <DachshundMascot stage="puppy" className="w-20 h-20" />
            <p className="text-slate-700 font-semibold">
              {session.earnedPuppies} pupp{session.earnedPuppies === 1 ? 'y' : 'ies'} earned today!
            </p>
          </div>
        )}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleContinueToReview}
            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Continue to review →
          </button>
          <Link href="/" className="text-amber-200 underline text-sm">Back to Home</Link>
        </div>
      </div>
    );
  }

  if (session.phase === 'report') {
    const total = Object.values(session.earnedUpgrades).reduce((a, b) => a + (b ?? 0), 0);
    if (total === 0) return null;
    return (
      <div className="text-center py-16">
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          Today {session.reviewWordIds.length} word{session.reviewWordIds.length === 1 ? '' : 's'} reviewed
        </h2>
        <p className="text-amber-100/80 mb-6">
          Among them, {total} {total === 1 ? 'was' : 'were'} upgraded to the next level.
        </p>
        <div className="mx-auto mb-6 max-w-xs bg-amber-50/75 backdrop-blur-sm border border-amber-100/50 rounded-2xl px-5 py-4 flex flex-wrap justify-center gap-x-5 gap-y-2">
          {STAGE_ORDER.filter(s => session.earnedUpgrades[s]).map(s => (
            <div key={s} className="flex items-center gap-1.5">
              <DachshundMascot stage={s} className="w-11 h-11" />
              <span className="text-slate-600 font-medium text-sm">× {session.earnedUpgrades[s]}</span>
            </div>
          ))}
        </div>
        <button
          onClick={handleContinueFromReport}
          className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
        >
          Continue →
        </button>
      </div>
    );
  }

  if (session.phase === 'congrats') {
    if (!showCongrats) return null;
    const dailyStats = getDailyStats();
    return (
      <CongratsModal
        studiedCount={dailyStats.studiedCount}
        reviewedCount={dailyStats.reviewedCount}
        language="German"
        level={settings?.level}
        onClose={handleCloseCongrats}
      />
    );
  }

  if (session.phase === 'done') {
    // Closing the congrats card already navigates to Home directly (see
    // handleCloseCongrats) — this only renders in the brief instant before
    // that push resolves, or if the phase is reached some other way.
    return null;
  }

  // --- study-rounds / review-rounds: the shared spelling-round card ---
  if (!word) return null;
  const chars = [...word.de];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="text-xs text-emerald-100/70">
          {roundMode === 'study'
            ? `${completedCount} / ${totalWords} new words learned today`
            : `${completedCount} / ${totalWords} words reviewed`}
        </div>
        <div className="h-2 w-full bg-white/15 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-medium text-indigo-600">{ROUND_LABELS[currentRound]}</div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              wordStatus === 'Review' ? 'bg-emerald-100 text-emerald-700'
                : wordStatus === 'Continuing' ? 'bg-amber-100 text-amber-700'
                  : 'bg-indigo-100 text-indigo-700'
            }`}
            >
              {wordStatus}
            </span>
          </div>
          <div className="flex gap-1">
            {([1, 2, 3, 4] as Round[]).map(n => (
              <div key={n} className={`h-2 flex-1 rounded-full ${n <= currentRound ? 'bg-indigo-500' : 'bg-indigo-100'}`} />
            ))}
          </div>
        </div>

        <div className="text-center">
          <div className="text-2xl font-semibold text-slate-700">{word.en}</div>
        </div>

        {currentRound === 1 && roundMode === 'study' ? (
          feedback === null ? (
            <SentenceExercise
              key={word.id}
              word={word}
              level={settings.level}
              onCorrected={correction => {
                setSentenceResult(correction);
                submitResult(true, { exampleSentence: correction });
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <SentenceWordHeader word={word} />
              <div className="text-center py-3 rounded-xl font-semibold bg-green-50 border border-green-200 px-4">
                <div className="text-xs uppercase tracking-wide text-green-600 mb-1 font-medium">Here's a natural way to say it</div>
                <div className="text-lg text-green-800">
                  {(() => {
                    if (!sentenceResult) return null;
                    const parts = splitOnWordForm(sentenceResult.sentence, sentenceResult.wordForm);
                    if (!parts) return sentenceResult.sentence;
                    return (
                      <>
                        {parts.before}
                        <span className="underline decoration-2 underline-offset-2">{parts.match}</span>
                        {parts.after}
                      </>
                    );
                  })()}
                </div>
              </div>
              <button
                onClick={handleNext}
                className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Next →
              </button>
            </div>
          )
        ) : (
          <>
            {exampleSentence && (
              <BlankedSentence example={exampleSentence} revealed={feedback !== null} />
            )}

            {word.type === 'noun' && word.article && (
              needsArticle ? (
                <div className="text-center -mb-2">
                  <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Article — der / die / das</div>
                  <LetterInputRow
                    ref={articleRowRef}
                    chars={['_', '_', '_']}
                    hint={[true, true, true]}
                    values={articleValues}
                    onChange={setArticleValues}
                    onSubmit={handleSubmit}
                    disabled={feedback !== null}
                    activeInputRef={activeInputRef}
                    resetFocusKey={`article-${word.id}-${attemptKey}`}
                    autoFocus
                    onFilled={() => letterRowRef.current?.focusFirstEmpty()}
                  />
                </div>
              ) : (
                <div className="flex justify-center gap-2">
                  <span className="bg-indigo-100 text-indigo-700 font-bold px-4 py-1 rounded-full text-lg">{word.article}</span>
                </div>
              )
            )}

            <LetterInputRow
              ref={letterRowRef}
              chars={chars}
              hint={hint}
              values={values}
              onChange={next => setValues(word.type === 'noun' && next[0] ? [next[0].toUpperCase(), ...next.slice(1)] : next)}
              onSubmit={handleSubmit}
              disabled={feedback !== null}
              activeInputRef={activeInputRef}
              resetFocusKey={`${word.id}-${attemptKey}`}
              autoFocus={!needsArticle}
              onBackspaceAtStart={needsArticle ? () => {
                setArticleValues(v => v.map((c, i) => (i === v.length - 1 ? '' : c)));
                articleRowRef.current?.focusLast();
              } : undefined}
            />

            {feedback === null ? (
              <div className="flex flex-col gap-3">
                <SpecialCharButtons inputRef={activeInputRef} />
                <button
                  onClick={handleSubmit}
                  disabled={!wordComplete}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
                >
                  Check
                </button>
                {currentRound > 1 && (
                  <button onClick={handleHint} className="w-full text-slate-400 py-1 text-sm font-medium hover:text-slate-600 transition-colors">
                    Hint
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className={`text-center py-3 rounded-xl font-semibold text-lg ${feedback ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {feedback ? '✓ Correct!' : (
                    <>
                      ✗ The answer is:{' '}
                      <span className="font-mono">{word.article ? `${word.article} ` : ''}{word.de}</span>{' '}
                      <SpeakerButton word={word} className="align-middle text-red-600 hover:text-red-800 transition-colors" />
                    </>
                  )}
                </div>
                <button
                  onClick={handleNext}
                  className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
