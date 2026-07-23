'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  getDailySession, saveDailySession, DailySession, SessionPhase,
  getWordProgress, saveWordProgress, getAllProgress, getSettings, today,
  MAX_ROUND, Round, WordProgress, MascotStageId, Settings,
  isStudyGoalDoneToday, isReviewGoalDoneToday, markStudyGoalDone, markReviewGoalDone,
  touchStreak, markCongratsShown, getDailyStats,
} from '../lib/storage';
import {
  wordsById, generateHint, checkAnswer, applyResult, applyReviewResult, REVIEW_BASE_ROUND,
  allClearedRoundOne, buildMcqChoices, buildMatchingPages, buildRedoPages,
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

const ROUND_LABELS: Record<Round, string> = {
  1: 'Round 1 — copy the word',
  2: 'Round 2 — half the letters hinted',
  3: 'Round 3 — first letter hint',
  4: 'Round 4 — no hints',
  5: 'Round 5 — no hints',
};

const STAGE_ORDER: MascotStageId[] = ['puppy', 'short', 'medium', 'long-crowned'];

type RoundMode = 'study' | 'review';

function isRoundsDone(id: string, mode: RoundMode): boolean {
  const p = getWordProgress(id);
  if (mode === 'study') return p.round >= MAX_ROUND;
  return !!(p.nextReviewDue && p.nextReviewDue > today());
}

export default function DailySessionFlow() {
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

  const [interruptMcq, setInterruptMcq] = useState<{ word: Word; choices: string[] } | null>(null);
  // Bumped on every matching-quiz page completion so MatchingQuizPage always
  // remounts fresh, even when a redo pass reuses the exact same word ids
  // (which would otherwise collide on a content-based key and keep stale
  // "already paired" state from the previous page).
  const [matchingPageKey, setMatchingPageKey] = useState(0);
  const [mcqCurrent, setMcqCurrent] = useState<{ word: Word; choices: string[] } | null>(null);
  const [showCongrats, setShowCongrats] = useState(false);

  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const letterRowRef = useRef<LetterInputRowHandle | null>(null);
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
    if (round === 1 && getSettings().autoPlayAudio) speakWord(w);
  };

  function enterRoundsPhase(ds: DailySession, mode: RoundMode) {
    const ids = mode === 'study' ? ds.studyWordIds : ds.reviewWordIds;
    const pending = ids.filter(id => !isRoundsDone(id, mode));
    const words = wordsById(pending);
    setQueue(words);
    setTotalWords(ids.length);
    reviewRoundsRef.current = {};
    setInterruptMcq(null);
    if (words.length > 0) {
      loadCurrent(words[0], mode);
    } else if (mode === 'study') {
      finishStudyRounds(ds);
    } else {
      finishReviewRounds(ds);
    }
  }

  function enterMcqPhase(ds: DailySession) {
    if (ds.mcqQueueIds.length === 0) {
      const next: DailySession = { ...ds, phase: 'study-rounds' };
      persistSession(next);
      enterRoundsPhase(next, 'study');
      return;
    }
    const w = wordsById([ds.mcqQueueIds[0]])[0];
    if (!w) {
      const next: DailySession = { ...ds, mcqQueueIds: ds.mcqQueueIds.slice(1) };
      persistSession(next);
      enterMcqPhase(next);
      return;
    }
    const progress = getWordProgress(w.id);
    const { choices } = buildMcqChoices(w, progress.mcqSeenChoices);
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

  const submitResult = (correct: boolean) => {
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
      }
    } else {
      const updated = applyResult(progress, correct);
      const completed = progress.round === MAX_ROUND && correct;
      const earnedBadge = updated.studiedTimes > progress.studiedTimes;

      saveWordProgress(updated);
      scheduleSync();
      setFeedback(correct);
      setJustCompleted(completed);

      if (earnedBadge) {
        persistSession({ ...session, earnedPuppies: session.earnedPuppies + 1 });
      }
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
  const handleGiveUp = () => submitResult(false);

  function finishStudyRounds(ds: DailySession) {
    persistSession({ ...ds, phase: 'study-matching', matchingQueueIds: [...ds.studyWordIds], matchingWrongIds: [] });
  }
  function finishReviewRounds(ds: DailySession) {
    persistSession({ ...ds, phase: 'review-matching', matchingQueueIds: [...ds.reviewWordIds], matchingWrongIds: [] });
  }

  function resumeAfterInterrupt() {
    if (!session) return;
    enterRoundsPhase(session, 'study');
  }

  function handleInterruptMcqAnswer(correct: boolean) {
    if (!session || !interruptMcq) return;
    const progress = getWordProgress(interruptMcq.word.id);
    let updated: WordProgress;
    if (correct) {
      updated = { ...progress, mcqPending: false, mcqNextRound: undefined };
    } else {
      const nextCheck = (progress.mcqNextRound ?? 2) + 1;
      updated = nextCheck > 5
        ? { ...progress, mcqPending: false, mcqNextRound: undefined }
        : { ...progress, mcqPending: true, mcqNextRound: nextCheck as Round };
    }
    saveWordProgress(updated);
    setInterruptMcq(null);
    resumeAfterInterrupt();
  }

  function handleMcqBatchAnswer(correct: boolean) {
    if (!session || !mcqCurrent) return;
    const progress = getWordProgress(mcqCurrent.word.id);
    const seen = [...(progress.mcqSeenChoices ?? []), ...mcqCurrent.choices];
    const updated: WordProgress = correct
      ? { ...progress, mcqPending: false, mcqNextRound: undefined, mcqSeenChoices: seen }
      : { ...progress, mcqPending: true, mcqNextRound: 3, mcqSeenChoices: seen };
    saveWordProgress(updated);
    const next: DailySession = { ...session, mcqQueueIds: session.mcqQueueIds.slice(1) };
    setMcqCurrent(null);
    persistSession(next);
    enterMcqPhase(next);
  }

  function advanceStudyQueue() {
    if (!session) return;
    const rest = queue.slice(1);
    if (!justCompleted) rest.push(queue[0]);
    setQueue(rest);

    if (session.mcqQueueIds.length > 0 && allClearedRoundOne(session.studyWordIds, getAllProgress())) {
      const next: DailySession = { ...session, phase: 'study-mcq' };
      persistSession(next);
      enterMcqPhase(next);
      return;
    }

    if (rest.length > 0) loadCurrent(rest[0], 'study');
    else finishStudyRounds(session);
  }

  function advanceReviewQueue() {
    if (!session) return;
    const rest = queue.slice(1);
    if (!justCompleted) rest.push(queue[0]);
    setQueue(rest);
    if (rest.length > 0) loadCurrent(rest[0], 'review');
    else finishReviewRounds(session);
  }

  const handleNext = () => {
    if (!session || !word) return;
    if (roundMode === 'review') {
      advanceReviewQueue();
      return;
    }
    const freshProgress = getWordProgress(word.id);
    if (freshProgress.mcqPending && freshProgress.mcqNextRound === freshProgress.round) {
      const { choices } = buildMcqChoices(word, freshProgress.mcqSeenChoices);
      saveWordProgress({ ...freshProgress, mcqSeenChoices: [...(freshProgress.mcqSeenChoices ?? []), ...choices] });
      setInterruptMcq({ word, choices });
      return;
    }
    advanceStudyQueue();
  };
  handleNextRef.current = handleNext;

  function currentMatchingPage(ds: DailySession): Word[] {
    const pages = buildMatchingPages(ds.matchingQueueIds);
    return pages.length > 0 ? wordsById(pages[0]) : [];
  }

  function handleMatchingPageComplete(wrongIds: string[]) {
    if (!session) return;
    setMatchingPageKey(k => k + 1);
    const pages = buildMatchingPages(session.matchingQueueIds);
    const thisPage = pages[0] ?? [];
    const remainingQueue = session.matchingQueueIds.slice(thisPage.length);
    const wrongSoFar = [...session.matchingWrongIds, ...wrongIds];

    if (remainingQueue.length > 0) {
      persistSession({ ...session, matchingQueueIds: remainingQueue, matchingWrongIds: wrongSoFar });
      return;
    }

    if (wrongSoFar.length === 0) {
      finishMatchingPhase(session);
      return;
    }
    const allIds = session.phase === 'study-matching' ? session.studyWordIds : session.reviewWordIds;
    const redoPages = buildRedoPages(wrongSoFar, allIds);
    persistSession({ ...session, matchingQueueIds: redoPages.flat(), matchingWrongIds: [] });
  }

  function finishMatchingPhase(ds: DailySession) {
    if (ds.phase === 'study-matching') {
      markStudyGoalDone(ds.studyWordIds.length);
      persistSession({ ...ds, phase: 'study-done' });
    } else {
      markReviewGoalDone(ds.reviewWordIds.length);
      persistSession({ ...ds, phase: 'report' });
    }
  }

  function handleContinueToReview() {
    if (!session) return;
    if (session.reviewWordIds.length > 0) {
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
  }

  // Enter advances past feedback; a correct answer also auto-advances. Only
  // live during the actual round-ladder screens — otherwise a stale
  // `feedback` left over from the round just before an MCQ/matching phase
  // started would fire handleNext (built for the round queue) into a screen
  // it knows nothing about. Re-evaluated on phase/interrupt changes too, so
  // a phase change on its own (without `feedback` changing) still clears
  // any pending auto-advance timer from the round that just ended.
  const isRoundScreen = !interruptMcq && (session?.phase === 'study-rounds' || session?.phase === 'review-rounds');
  useEffect(() => {
    if (feedback === null || !isRoundScreen) return;
    let armed = false;
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Enter') armed = true; };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter' && armed) handleNextRef.current(); };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onKeyDown);
    const timer = feedback === true ? setTimeout(() => handleNextRef.current(), 1500) : undefined;
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

  if (interruptMcq) {
    return <TranslationChoiceCard key={`interrupt-${interruptMcq.word.id}`} word={interruptMcq.word} choices={interruptMcq.choices} onAnswer={handleInterruptMcqAnswer} />;
  }

  if (session.phase === 'study-mcq') {
    if (!mcqCurrent) return null;
    return <TranslationChoiceCard key={`batch-${mcqCurrent.word.id}`} word={mcqCurrent.word} choices={mcqCurrent.choices} onAnswer={handleMcqBatchAnswer} />;
  }

  if (session.phase === 'study-matching' || session.phase === 'review-matching') {
    const page = currentMatchingPage(session);
    if (page.length === 0) return null;
    return <MatchingQuizPage key={matchingPageKey} words={page} onComplete={handleMatchingPageComplete} />;
  }

  if (session.phase === 'study-done') {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          Study complete!
        </h2>
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
        <div className="text-5xl mb-4">⬆️</div>
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          {total} upgraded today!
        </h2>
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
    const totalUpgrades = Object.values(session.earnedUpgrades).reduce((a, b) => a + (b ?? 0), 0);
    const earnedContent = session.earnedPuppies === 0 && totalUpgrades === 0 ? undefined : (
      <span className="inline-flex items-center gap-2 flex-wrap justify-center">
        {session.earnedPuppies > 0 && (
          <span className="inline-flex items-center gap-1">
            <DachshundMascot stage="puppy" className="w-6 h-6" /> {session.earnedPuppies} new
          </span>
        )}
        {totalUpgrades > 0 && (
          <span className="inline-flex items-center gap-1">
            {STAGE_ORDER.filter(s => session.earnedUpgrades[s]).map(s => (
              <DachshundMascot key={s} stage={s} className="w-6 h-6" />
            ))}
            {totalUpgrades} upgraded
          </span>
        )}
      </span>
    );
    return (
      <CongratsModal
        studiedCount={session.studyWordIds.length}
        reviewedCount={session.reviewWordIds.length}
        language="German"
        onClose={handleCloseCongrats}
        earnedContent={earnedContent}
      />
    );
  }

  if (session.phase === 'done') {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          All done for today!
        </h2>
        <Link href="/" className="text-amber-200 underline">Back to Home</Link>
      </div>
    );
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
          <div className="text-sm font-medium text-indigo-600 mb-1">{ROUND_LABELS[currentRound]}</div>
          <div className="flex gap-1">
            {([1, 2, 3, 4, 5] as Round[]).map(n => (
              <div key={n} className={`h-2 flex-1 rounded-full ${n <= currentRound ? 'bg-indigo-500' : 'bg-indigo-100'}`} />
            ))}
          </div>
        </div>

        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">English</div>
          <div className="text-2xl font-semibold text-slate-700">{word.en}</div>
        </div>

        {currentRound === 1 && (
          <div className="text-center -mt-1">
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Copy this word</div>
            <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide">
              {word.article ? `${word.article} ` : ''}{word.de} <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
            </div>
          </div>
        )}

        {word.type === 'noun' && word.article && (
          needsArticle ? (
            <div className="text-center -mb-2">
              <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Article — der / die / das</div>
              <LetterInputRow
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
            <button onClick={handleGiveUp} className="w-full text-slate-400 py-1 text-sm font-medium hover:text-slate-600 transition-colors">
              I don't remember
            </button>
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
      </div>

      {word.category && <div className="text-center text-emerald-100/60 text-xs">{word.category}</div>}
    </div>
  );
}
