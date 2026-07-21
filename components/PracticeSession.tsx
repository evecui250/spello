'use client';

import { useEffect, useRef, useState } from 'react';
import {
  buildStudyWords, buildReviewWords, generateHint, checkAnswer, applyResult,
  applyReviewResult, REVIEW_BASE_ROUND, wordsById,
} from '../lib/practice';
import {
  getWordProgress, saveWordProgress, getSettings, touchStreak, markStudyGoalDone,
  takeExtraStudyLimit, takeExtraReviewLimit, isStudyGoalDoneToday, isReviewGoalDoneToday,
  markReviewGoalDone, getDailyStats, markCongratsShown, getTodayStudyBatch, saveTodayStudyBatch,
  MAX_ROUND, Round, Settings,
} from '../lib/storage';
import { Word } from '../lib/words';
import SpecialCharButtons from './SpecialCharButtons';
import LetterInputRow, { LetterInputRowHandle } from './LetterInputRow';
import SpeakerButton from './SpeakerButton';
import CongratsModal from './CongratsModal';
import NextSectionPrompt from './NextSectionPrompt';
import { speakWord } from '../lib/speech';
import { scheduleSync } from '../lib/sync';
import Link from 'next/link';

const LANG_NAMES: Record<string, string> = { de: 'German' };

const ROUND_LABELS: Record<Round, string> = {
  1: 'Round 1 — copy the word',
  2: 'Round 2 — half the letters hinted',
  3: 'Round 3 — first letter hint',
  4: 'Round 4 — no hints',
  5: 'Round 5 — no hints',
};

interface Props {
  mode: 'study' | 'review';
}

export default function PracticeSession({ mode }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);

  // Study mode: a queue of words to cycle through until every one reaches round 5.
  const [queue, setQueue] = useState<Word[]>([]);
  const [totalStudyWords, setTotalStudyWords] = useState(0);

  // Review mode: a queue too, so a wrong answer requeues the word instead of
  // letting it pass — every word in the batch ends the session with one more
  // coin, not just "attempted once."
  const [words, setWords] = useState<Word[]>([]);
  const [totalReviewWords, setTotalReviewWords] = useState(0);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [hasMoreReview, setHasMoreReview] = useState(false);

  const [sessionDone, setSessionDone] = useState(false);
  const [showCongrats, setShowCongrats] = useState(false);
  const [nudge, setNudge] = useState<'study' | 'review' | null>(null);
  const isExtraRef = useRef(false);
  const goalDoneAtStartRef = useRef(true);
  const reviewGoalDoneAtStartRef = useRef(true);
  const isExtraReviewRef = useRef(false);

  const [currentRound, setCurrentRound] = useState<Round>(1);
  const [hint, setHint] = useState<boolean[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [articleGuess, setArticleGuess] = useState<string | null>(null);
  const [articleReminder, setArticleReminder] = useState(false);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [coinEarned, setCoinEarned] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);

  const [flyingCoin, setFlyingCoin] = useState<{ from: DOMRect; to: DOMRect } | null>(null);
  const [pulseIdx, setPulseIdx] = useState<number | null>(null);
  const cardCoinRef = useRef<HTMLSpanElement | null>(null);
  const nextCoinRef = useRef<HTMLSpanElement | null>(null);

  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const letterRowRef = useRef<LetterInputRowHandle | null>(null);
  const handleNextRef = useRef<() => void>(() => {});

  const word = mode === 'study' ? queue[0] ?? null : words[0] ?? null;
  const needsArticle = !!(settings?.requireArticle && word?.type === 'noun' && word?.article);
  const completedCount = mode === 'study' ? totalStudyWords - queue.length : totalReviewWords - words.length;
  const completedTotal = mode === 'study' ? totalStudyWords : totalReviewWords;

  const loadCurrent = (w: Word) => {
    const progress = getWordProgress(w.id);
    // Reviews always start from the review baseline — the word isn't new,
    // so round 1 would be too easy — regardless of its stored round.
    const round = mode === 'review' ? REVIEW_BASE_ROUND : progress.round;
    setCurrentRound(round);
    const h = generateHint(w.de, round);
    const chars = [...w.de];
    setHint(h);
    setValues(chars.map((c, i) => (h[i] ? '' : c)));
    setArticleGuess(null);
    setArticleReminder(false);
    setFeedback(null);
    setJustCompleted(false);
    setCoinEarned(false);
    setAttemptKey(k => k + 1);
    if (round === 1 && getSettings().autoPlayAudio) {
      speakWord(w);
    }
  };

  // Load settings + first batch on mount.
  useEffect(() => {
    const s = getSettings();
    setSettings(s);
    if (mode === 'study') {
      const extra = takeExtraStudyLimit();
      if (extra != null) {
        // A supplementary session on top of the daily goal — always a fresh
        // pull, not part of today's persisted primary batch.
        isExtraRef.current = true;
        const batch = buildStudyWords(extra);
        setQueue(batch);
        setTotalStudyWords(batch.length);
        if (batch.length) loadCurrent(batch[0]);
      } else {
        // The primary daily batch — fixed for the day so navigating away
        // and back resumes the same words instead of drawing new ones.
        isExtraRef.current = false;
        goalDoneAtStartRef.current = isStudyGoalDoneToday();
        let batchIds = getTodayStudyBatch();
        if (!batchIds) {
          batchIds = buildStudyWords(s.studyBatchSize).map(w => w.id);
          saveTodayStudyBatch(batchIds);
        }
        const remaining = wordsById(batchIds).filter(w => getWordProgress(w.id).round < MAX_ROUND);
        setQueue(remaining);
        setTotalStudyWords(batchIds.length);
        if (remaining.length) {
          loadCurrent(remaining[0]);
        } else if (batchIds.length > 0) {
          // Today's batch was already fully completed in an earlier visit.
          // handleNext normally marks the goal done when a session finishes
          // interactively — that never ran this time, so do it here too,
          // otherwise the goal silently never gets marked and Home is stuck
          // showing "nothing new" instead of the Study Extra flow.
          setSessionDone(true);
          if (!goalDoneAtStartRef.current) {
            markStudyGoalDone(batchIds.length);
            checkDailyCompletion();
          }
        }
      }
    } else {
      const extra = takeExtraReviewLimit();
      isExtraReviewRef.current = extra != null;
      reviewGoalDoneAtStartRef.current = isReviewGoalDoneToday();
      const batch = buildReviewWords(extra ?? s.dailyReview, new Set(), isExtraReviewRef.current);
      setWords(batch);
      setTotalReviewWords(batch.length);
      setDoneIds(new Set(batch.map(w => w.id)));
      if (batch.length) loadCurrent(batch[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The letter tiles being full is enough to enable Check — a missing
  // article guess (when required) surfaces its own reminder instead of just
  // leaving the button inertly disabled with no explanation.
  const wordComplete = hint.length > 0 && hint.every((h, i) => !h || !!values[i]);

  const submitResult = (correct: boolean) => {
    if (!word || !settings || feedback !== null) return;
    const progress = getWordProgress(word.id);
    const updated = mode === 'review'
      ? applyReviewResult(progress, correct, settings.masteryThreshold)
      : applyResult(progress, correct, settings.masteryThreshold);
    // applyReviewResult returns the same object, unchanged, when a word that
    // already banked its coin today gets reviewed again (only reachable via
    // "Review Extra") — that's bonus practice, not a real pass/fail.
    const noOpReviewPractice = mode === 'review' && updated === progress;
    saveWordProgress(updated);
    scheduleSync();
    setFeedback(correct);
    // Study: only "done" the first time this ladder climb reaches round 5.
    // Review: any correct answer clears it, however many requeues it took —
    // applyReviewResult already handles the round/coin bookkeeping correctly
    // regardless of prior attempts this session.
    setJustCompleted(
      noOpReviewPractice ? true : mode === 'review' ? correct : (progress.round === MAX_ROUND && correct)
    );
    setCoinEarned(updated.studiedTimes > progress.studiedTimes);
    if (settings.autoPlayAudio) {
      speakWord(word);
    }
  };

  const handleSubmit = () => {
    if (!word || !wordComplete) return;
    if (needsArticle && articleGuess === null) {
      setArticleReminder(true);
      return;
    }
    const wordRight = checkAnswer(word.de, values.join(''));
    const articleRight = !needsArticle || articleGuess === word.article;
    submitResult(wordRight && articleRight);
  };

  const handleGiveUp = () => submitResult(false);

  // Once a section (study or review) finishes for the first time today,
  // either celebrate (if the other section is also done) or nudge the user
  // toward it. Repeat completions the same day (extra study, review more)
  // don't retrigger this.
  const checkDailyCompletion = () => {
    const stats = getDailyStats();
    if (stats.studyDone && stats.reviewDone) {
      if (!stats.congratsShown) {
        markCongratsShown();
        setShowCongrats(true);
      }
    } else if (stats.studyDone) {
      setNudge('review');
    } else if (stats.reviewDone) {
      setNudge('study');
    }
  };

  const handleNext = () => {
    if (mode === 'study') {
      const rest = queue.slice(1);
      if (!justCompleted) rest.push(queue[0]);
      setQueue(rest);
      if (rest.length === 0) {
        setSessionDone(true);
        touchStreak();
        scheduleSync();
        if (!isExtraRef.current) {
          const wasDone = goalDoneAtStartRef.current;
          markStudyGoalDone(totalStudyWords);
          if (!wasDone) checkDailyCompletion();
        }
      } else {
        loadCurrent(rest[0]);
      }
    } else {
      const rest = words.slice(1);
      if (!justCompleted) rest.push(words[0]);
      setWords(rest);
      if (rest.length === 0) {
        setHasMoreReview(buildReviewWords(1, doneIds, isExtraReviewRef.current).length > 0);
        setSessionDone(true);
        touchStreak();
        scheduleSync();
        if (!isExtraReviewRef.current) {
          const wasDone = reviewGoalDoneAtStartRef.current;
          markReviewGoalDone(totalReviewWords);
          if (!wasDone) checkDailyCompletion();
        }
      } else {
        loadCurrent(rest[0]);
      }
    }
  };
  handleNextRef.current = handleNext;

  const handleReviewMore = () => {
    if (!settings) return;
    const next = buildReviewWords(settings.dailyReview, doneIds, isExtraReviewRef.current);
    setDoneIds(prev => new Set([...prev, ...next.map(w => w.id)]));
    setWords(next);
    setTotalReviewWords(next.length);
    setSessionDone(false);
    if (next.length) loadCurrent(next[0]);
  };

  // Enter key advances past the feedback screen too. Requires the Enter key
  // to be released first, so the same keypress that submitted the answer
  // (and any OS key-repeat while it's held) can't also skip past the feedback.
  // A correct answer also auto-advances after a short pause, so the user
  // doesn't have to press anything to keep moving.
  useEffect(() => {
    if (feedback === null) return;
    let armed = false;
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Enter') armed = true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && armed) handleNextRef.current();
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onKeyDown);

    const timer = feedback === true ? setTimeout(() => handleNextRef.current(), 1500) : undefined;

    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('keydown', onKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [feedback]);

  // On a correct round-5 answer that actually earns a coin, fly it from the
  // card up to its slot in the top coin bar, so collecting one more coin is
  // visible, not just a number changing.
  useEffect(() => {
    if (feedback === true && coinEarned && cardCoinRef.current && nextCoinRef.current) {
      const from = cardCoinRef.current.getBoundingClientRect();
      const to = nextCoinRef.current.getBoundingClientRect();
      setFlyingCoin({ from, to });
      setPulseIdx(completedCount);
      const flightTimer = setTimeout(() => setFlyingCoin(null), 800);
      const pulseTimer = setTimeout(() => setPulseIdx(null), 1300);
      return () => {
        clearTimeout(flightTimer);
        clearTimeout(pulseTimer);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, coinEarned]);

  // --- Empty / done screens ---

  const initiallyEmpty = mode === 'study' ? totalStudyWords === 0 : totalReviewWords === 0;

  if (settings && initiallyEmpty && !sessionDone) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          {mode === 'study' ? 'Nothing to study!' : 'Nothing to review!'}
        </h2>
        <p className="text-emerald-100/70 mb-6">
          {mode === 'study'
            ? "You've mastered or graduated every word for now."
            : 'No words have graduated from study yet — come back after a study session.'}
        </p>
        <Link href="/" className="text-amber-200 underline">Back to Home</Link>
      </div>
    );
  }

  if (sessionDone) {
    const dailyStats = showCongrats ? getDailyStats() : null;
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          {mode === 'study' ? 'Study session complete!' : 'Batch complete!'}
        </h2>
        <p className="text-emerald-100/70 mb-6">
          {mode === 'study'
            ? `You brought ${totalStudyWords} word${totalStudyWords === 1 ? '' : 's'} to round 5 today.`
            : `You reviewed ${totalReviewWords} word${totalReviewWords === 1 ? '' : 's'}.`}
        </p>
        <div className="flex flex-col items-center gap-3">
          {mode === 'review' && hasMoreReview && (
            <button
              onClick={handleReviewMore}
              className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700"
            >
              Review more →
            </button>
          )}
          <Link href="/" className="text-amber-200 underline">Back to Home</Link>
        </div>
        {showCongrats && dailyStats && (
          <CongratsModal
            studiedCount={dailyStats.studiedCount}
            reviewedCount={dailyStats.reviewedCount}
            language={LANG_NAMES[settings?.language ?? 'de'] ?? 'German'}
            onClose={() => setShowCongrats(false)}
          />
        )}
        {nudge && (
          <NextSectionPrompt section={nudge} onDismiss={() => setNudge(null)} />
        )}
      </div>
    );
  }

  if (!word) return null;

  const chars = [...word.de];

  return (
    <div className="flex flex-col gap-5">
      {/* Words completed today — a general, cross-word coin tally */}
      <div className="flex flex-col gap-1">
        <div className="text-xs text-emerald-100/70 text-center">
          {mode === 'study'
            ? `${completedCount} / ${completedTotal} words learned today`
            : `${completedCount} / ${completedTotal} words reviewed`}
        </div>
        <div className="flex flex-wrap gap-1 justify-center">
          {Array.from({ length: completedTotal }, (_, i) => (
            <span
              key={i}
              ref={i === completedCount ? nextCoinRef : undefined}
              className={`text-lg transition-transform ${i < completedCount ? '' : 'opacity-20 grayscale'} ${i === pulseIdx ? 'animate-coin-pop' : ''}`}
            >
              🪙
            </span>
          ))}
        </div>
      </div>
      {flyingCoin && <FlyingCoin from={flyingCoin.from} to={flyingCoin.to} />}

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-50 p-6 flex flex-col gap-5">

        {/* This word's level, 1-5 — specific to the current word */}
        <div>
          <div className="text-sm font-medium text-indigo-600 mb-1">{ROUND_LABELS[currentRound]}</div>
          <div className="flex gap-1">
            {([1, 2, 3, 4, 5] as Round[]).map(n => (
              <div
                key={n}
                className={`h-2 flex-1 rounded-full ${n <= currentRound ? 'bg-indigo-500' : 'bg-indigo-100'}`}
              />
            ))}
          </div>
        </div>

        {/* English translation — always visible */}
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">English</div>
          <div className="text-2xl font-semibold text-slate-700">{word.en}</div>
        </div>

        {/* Article for nouns — a fixed chip, or a der/die/das guess when requireArticle is on */}
        {word.type === 'noun' && word.article && (
          <div className="flex justify-center gap-2">
            {needsArticle ? (
              (['der', 'die', 'das'] as const).map(a => (
                <button
                  key={a}
                  type="button"
                  disabled={feedback !== null}
                  onClick={() => {
                    setArticleGuess(a);
                    setArticleReminder(false);
                    letterRowRef.current?.focusFirstEmpty();
                  }}
                  className={`px-4 py-1.5 rounded-full text-lg font-bold border-2 transition-colors disabled:opacity-60 ${
                    articleGuess === a
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-indigo-200 text-indigo-600 hover:border-indigo-400'
                  }`}
                >
                  {a}
                </button>
              ))
            ) : (
              <span className="bg-indigo-100 text-indigo-700 font-bold px-4 py-1 rounded-full text-lg">
                {word.article}
              </span>
            )}
          </div>
        )}
        {needsArticle && articleReminder && (
          <p className="text-center text-red-500 text-sm -mt-3">Choose der / die / das first.</p>
        )}

        {currentRound === 1 && (
          <div className="text-center -mt-1">
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Copy this word</div>
            <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide">
              {word.article ? `${word.article} ` : ''}{word.de} <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
            </div>
          </div>
        )}

        {currentRound === 5 && (
          <div className="flex justify-center -mt-1">
            <span ref={cardCoinRef} className="text-3xl">🪙</span>
          </div>
        )}

        {/* Letter tiles — locked hints or editable blanks */}
        <LetterInputRow
          ref={letterRowRef}
          chars={chars}
          hint={hint}
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          disabled={feedback !== null}
          activeInputRef={activeInputRef}
          resetFocusKey={`${word.id}-${attemptKey}`}
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
            <button
              onClick={handleGiveUp}
              className="w-full text-slate-400 py-1 text-sm font-medium hover:text-slate-600 transition-colors"
            >
              I don't remember
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className={`text-center py-3 rounded-xl font-semibold text-lg ${feedback ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {feedback ? '✓ Correct!' : (
                <>
                  ✗ The answer is:{' '}
                  <span className="font-mono">
                    {word.article ? `${word.article} ` : ''}{word.de}
                  </span>
                  {' '}
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

      {word.category && (
        <div className="text-center text-emerald-100/60 text-xs">{word.category}</div>
      )}
    </div>
  );
}

// A coin that visually travels from its start position to its end position
// (both captured via getBoundingClientRect) and fades out on arrival —
// two-phase inline styles plus a CSS transition, so no per-instance keyframes
// or custom properties are needed.
function FlyingCoin({ from, to }: { from: DOMRect; to: DOMRect }) {
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    // A single rAF can land in the same paint as the initial styles, so the
    // transition never has a "before" frame to animate from — it just snaps
    // straight to the end state. Waiting a second frame guarantees a real
    // paint happens in between.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  const dx = to.left - from.left;
  const dy = to.top - from.top;

  return (
    <span
      className="fixed z-50 text-2xl pointer-events-none transition-all duration-700 ease-out"
      style={{
        left: from.left,
        top: from.top,
        transform: arrived ? `translate(${dx}px, ${dy}px) scale(0.5)` : 'translate(0, 0) scale(1)',
        opacity: arrived ? 0 : 1,
      }}
    >
      🪙
    </span>
  );
}
