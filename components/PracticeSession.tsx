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
  MAX_ROUND, Round, Settings, MascotStageId, WordProgress,
} from '../lib/storage';
import { Word } from '../lib/words';
import SpecialCharButtons from './SpecialCharButtons';
import LetterInputRow, { LetterInputRowHandle } from './LetterInputRow';
import SpeakerButton from './SpeakerButton';
import CongratsModal from './CongratsModal';
import NextSectionPrompt from './NextSectionPrompt';
import DachshundMascot from './Mascot';
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

const STAGE_ORDER: MascotStageId[] = ['puppy', 'short', 'medium', 'long-crowned'];

interface Props {
  mode: 'study' | 'review';
}

// One answered word, kept so the Back button can redisplay it read-only.
interface HistoryEntry {
  id: string;
  article?: string;
  de: string;
  en: string;
  correct: boolean;
  earnedBadge: boolean;
  beforeStage: MascotStageId;
  mascotStage: MascotStageId;
}

export default function PracticeSession({ mode }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);

  // Study mode: a queue of words to cycle through until every one reaches round 5.
  const [queue, setQueue] = useState<Word[]>([]);
  const [totalStudyWords, setTotalStudyWords] = useState(0);

  // Review mode: a queue too, so a wrong answer requeues the word instead of
  // letting it pass — every word in the batch ends the session fully reviewed,
  // not just "attempted once."
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
  const [articleValues, setArticleValues] = useState<string[]>(['', '', '']);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);

  // Every answered word this session, so the Back button can redisplay one —
  // and the completion screen can tally dachshunds earned by stage.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const letterRowRef = useRef<LetterInputRowHandle | null>(null);
  const handleNextRef = useRef<() => void>(() => {});
  // Review mode only: which rung a word should resume at when it comes back
  // around in the queue after a mistake (round 4) or a recovery pass that
  // isn't the final one yet (back up to round 5). Session-local — it's never
  // persisted, since the stored round always stays at MAX_ROUND for review
  // eligibility (see buildReviewWords).
  const reviewRoundsRef = useRef<Record<string, Round>>({});

  const word = mode === 'study' ? queue[0] ?? null : words[0] ?? null;
  const needsArticle = !!(settings?.requireArticle && word?.type === 'noun' && word?.article);
  const completedCount = mode === 'study' ? totalStudyWords - queue.length : totalReviewWords - words.length;
  const completedTotal = mode === 'study' ? totalStudyWords : totalReviewWords;
  const progressPct = completedTotal > 0 ? Math.min(100, Math.round((completedCount / completedTotal) * 100)) : 0;

  const loadCurrent = (w: Word) => {
    const progress = getWordProgress(w.id);
    // Reviews start from the review baseline — the word isn't new, so round
    // 1 would be too easy — unless it's coming back around after a mistake
    // this session, in which case it resumes at whatever rung it fell to.
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
            checkNudge();
          }
          checkForCongrats();
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

  // The letter tiles being full is enough to enable Check — same for the
  // article blanks when required, so there's no separate reminder step.
  const articleComplete = !needsArticle || articleValues.every(v => !!v);
  const wordComplete = hint.length > 0 && hint.every((h, i) => !h || !!values[i]) && articleComplete;

  const submitResult = (correct: boolean) => {
    if (!word || !settings || feedback !== null) return;
    const progress = getWordProgress(word.id);
    let updated: WordProgress;
    let completed: boolean;
    let earnedBadge: boolean;

    if (mode === 'review') {
      const outcome = applyReviewResult(progress, correct, currentRound);
      updated = outcome.progress;
      completed = outcome.isFinal;
      earnedBadge = outcome.isFinal && outcome.scored && correct;
      if (outcome.isFinal) {
        delete reviewRoundsRef.current[word.id];
      } else {
        // Stays in the queue for another try — remember which rung to
        // resume at (round 4 after a mistake, or back up to 5 to finish).
        reviewRoundsRef.current[word.id] = outcome.nextRound;
      }
    } else {
      updated = applyResult(progress, correct);
      // Study: only "done" the first time this ladder climb reaches round 5.
      completed = progress.round === MAX_ROUND && correct;
      earnedBadge = updated.studiedTimes > progress.studiedTimes;
    }

    saveWordProgress(updated);
    scheduleSync();
    setFeedback(correct);
    setJustCompleted(completed);
    setHistory(h => [...h, {
      id: word.id, article: word.article, de: word.de, en: word.en,
      correct, earnedBadge, beforeStage: progress.mascotStage, mascotStage: updated.mascotStage,
    }]);
    if (settings.autoPlayAudio) {
      speakWord(word);
    }
  };

  const handleSubmit = () => {
    if (!word || !wordComplete) return;
    const wordRight = checkAnswer(word.de, values.join(''));
    const articleGuess = articleValues.join('').toLowerCase();
    const articleRight = !needsArticle || articleGuess === word.article;
    submitResult(wordRight && articleRight);
  };

  const handleGiveUp = () => submitResult(false);

  // Congrats + streak: re-checked after EVERY session that finishes,
  // including "extra" ones — not just the first regular completion of the
  // day. That's deliberate: it's the only way to reliably catch "both goals
  // are now done" regardless of which order they finished in or whether the
  // second one happened to be an extra/bonus session. Guarded internally
  // (congratsShown) so it only ever actually fires once per day.
  const checkForCongrats = () => {
    const stats = getDailyStats();
    if (stats.studyDone && stats.reviewDone && !stats.congratsShown) {
      touchStreak();
      markCongratsShown();
      setShowCongrats(true);
    }
  };

  // Nudge toward the other section — only on the transition to "just
  // finished this one for the first time today", so it doesn't pop up
  // again on every subsequent extra session.
  const checkNudge = () => {
    const stats = getDailyStats();
    if (stats.studyDone && stats.reviewDone) return; // checkForCongrats handles this case
    if (stats.studyDone) setNudge('review');
    else if (stats.reviewDone) setNudge('study');
  };

  const handleNext = () => {
    if (mode === 'study') {
      const rest = queue.slice(1);
      if (!justCompleted) rest.push(queue[0]);
      setQueue(rest);
      if (rest.length === 0) {
        setSessionDone(true);
        scheduleSync();
        if (!isExtraRef.current) {
          const wasDone = goalDoneAtStartRef.current;
          markStudyGoalDone(totalStudyWords);
          if (!wasDone) checkNudge();
        }
        checkForCongrats();
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
        scheduleSync();
        if (!isExtraReviewRef.current) {
          const wasDone = reviewGoalDoneAtStartRef.current;
          markReviewGoalDone(totalReviewWords);
          if (!wasDone) checkNudge();
        }
        checkForCongrats();
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
  // doesn't have to press anything to keep moving. None of this should fire
  // while the user is browsing history via the Back button.
  useEffect(() => {
    if (feedback === null || historyIndex !== null) return;
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
  }, [feedback, historyIndex]);

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
    // Study: every completed word is a brand-new puppy (mascotStage only
    // ever starts there). Review: most successful reviews don't move the
    // needle enough to cross into a new stage — only count (and show) the
    // ones that actually did.
    const earned = mode === 'study'
      ? history.filter(h => h.earnedBadge)
      : history.filter(h => h.earnedBadge && h.beforeStage !== h.mascotStage);
    const stageCounts: Partial<Record<MascotStageId, number>> = {};
    for (const e of earned) stageCounts[e.mascotStage] = (stageCounts[e.mascotStage] ?? 0) + 1;
    // The modals below pop up immediately and cover this screen, so they
    // need their own copy of the tally — otherwise a user who taps the
    // modal's CTA right away never sees it. Shown with the mascot image
    // itself rather than the word "dachshund".
    const earnedContent = earned.length === 0 ? undefined : mode === 'study' ? (
      <span className="inline-flex items-center gap-1.5">
        <DachshundMascot stage="puppy" className="w-7 h-7" />
        {earned.length} pupp{earned.length === 1 ? 'y' : 'ies'} earned today!
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 flex-wrap justify-center">
        {STAGE_ORDER.filter(s => stageCounts[s]).map(s => (
          <DachshundMascot key={s} stage={s} className="w-7 h-7" />
        ))}
        {earned.length} upgraded today!
      </span>
    );

    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-amber-50 mb-2" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          {mode === 'study' ? 'Study session complete!' : 'Batch complete!'}
        </h2>
        <p className="text-emerald-100/70 mb-4">
          {mode === 'study'
            ? `You brought ${totalStudyWords} word${totalStudyWords === 1 ? '' : 's'} to round 5 today.`
            : `You reviewed ${totalReviewWords} word${totalReviewWords === 1 ? '' : 's'}.`}
        </p>

        {mode === 'study' && earned.length > 0 && (
          <div className="mx-auto mb-6 max-w-xs bg-amber-50/75 backdrop-blur-sm border border-amber-100/50 rounded-2xl px-5 py-4 flex flex-col items-center gap-1.5">
            <DachshundMascot stage="puppy" className="w-20 h-20" />
            <p className="text-slate-700 font-semibold">
              {earned.length} pupp{earned.length === 1 ? 'y' : 'ies'} earned today!
            </p>
          </div>
        )}

        {mode === 'review' && earned.length > 0 && (
          <div className="mx-auto mb-6 max-w-xs bg-amber-50/75 backdrop-blur-sm border border-amber-100/50 rounded-2xl px-5 py-4 flex flex-col items-center gap-3">
            <p className="text-slate-700 font-semibold">
              {earned.length} upgraded today
            </p>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
              {STAGE_ORDER.filter(s => stageCounts[s]).map(s => (
                <div key={s} className="flex items-center gap-1.5">
                  <DachshundMascot stage={s} className="w-11 h-11" />
                  <span className="text-slate-600 font-medium text-sm">× {stageCounts[s]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
            earnedContent={earnedContent}
          />
        )}
        {nudge && (
          <NextSectionPrompt section={nudge} onDismiss={() => setNudge(null)} earnedContent={earnedContent} />
        )}
      </div>
    );
  }

  if (!word) return null;

  // --- Browsing a past word via the Back button: a read-only recap, no
  // inputs, with its own Back/Next pair that never touches the live queue. ---
  if (historyIndex !== null) {
    const h = history[historyIndex];
    return (
      <div className="flex flex-col gap-5">
        <div className="text-xs text-emerald-100/70 text-center">
          Previous word {historyIndex + 1} / {history.length}
        </div>
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5">
          <div className="text-center">
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">English</div>
            <div className="text-2xl font-semibold text-slate-700">{h.en}</div>
          </div>
          <div className="text-center">
            <span className="font-mono text-2xl font-bold text-indigo-800">
              {h.article ? `${h.article} ` : ''}{h.de}
            </span>
          </div>
          <div className={`text-center py-3 rounded-xl font-semibold text-lg ${h.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {h.correct ? '✓ Correct' : '✗ Incorrect'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setHistoryIndex(i => (i !== null && i > 0 ? i - 1 : i))}
              disabled={historyIndex === 0}
              className="flex-1 bg-amber-50/60 text-indigo-600 border-2 border-indigo-200 py-3 rounded-xl font-semibold disabled:opacity-40 hover:border-indigo-400 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setHistoryIndex(i => (i !== null && i < history.length - 1 ? i + 1 : null))}
              className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const chars = [...word.de];

  return (
    <div className="flex flex-col gap-5">
      {/* Session progress — a plain bar, no more per-word coin tally */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-emerald-100/70">
            {mode === 'study'
              ? `${completedCount} / ${completedTotal} words learned today`
              : `${completedCount} / ${completedTotal} words reviewed`}
          </div>
          {history.length > 0 && (
            <button
              onClick={() => setHistoryIndex(history.length - 1)}
              className="text-xs text-amber-200 hover:text-amber-100 underline shrink-0"
            >
              ← Back
            </button>
          )}
        </div>
        <div className="h-2 w-full bg-white/15 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5">

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

        {currentRound === 1 && (
          <div className="text-center -mt-1">
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Copy this word</div>
            <div className="text-2xl font-mono font-bold text-indigo-800 tracking-wide">
              {word.article ? `${word.article} ` : ''}{word.de} <SpeakerButton word={word} className="align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
            </div>
          </div>
        )}

        {/* Article for nouns — a fixed chip, or typed blanks (der/die/das
            are all 3 letters, so they slot in as their own tile row) when
            requireArticle is on. Sits directly above the word blanks, right
            where the article goes when reading the answer left to right. */}
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
              <span className="bg-indigo-100 text-indigo-700 font-bold px-4 py-1 rounded-full text-lg">
                {word.article}
              </span>
            </div>
          )
        )}

        {/* Letter tiles — locked hints or editable blanks. German nouns are
            always capitalized, so the first editable letter auto-uppercases
            as the user types instead of making them reach for Shift. */}
        <LetterInputRow
          ref={letterRowRef}
          chars={chars}
          hint={hint}
          values={values}
          onChange={next => setValues(
            word.type === 'noun' && next[0]
              ? [next[0].toUpperCase(), ...next.slice(1)]
              : next
          )}
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
