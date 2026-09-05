'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Word, glossFor } from '../lib/words';
import {
  getWordProgressForLevel, saveWordProgressForLevel, getSettings, WordProgress,
} from '../lib/storage';
import {
  GAME_MIN_WORDS_REQUIRED, articleCandidateWords, articleFamiliarity, ArticleFamiliarity,
  recordArticleMistake, recordArticleRecall,
} from '../lib/practice';
import { speakWord } from '../lib/speech';
import { getOrCreateDeviceId } from '../lib/telemetry';
import { supabase } from '../lib/supabase';
import { getDisplayProfile, heroImageFor } from '../lib/shop';
import { PointsIcon } from './icons';

// A 60-second der/die/das drill, sitting alongside WordMatchGame
// ("Wortpaare") in the post-goal bonus round -- same overall shape
// (intro -> playing -> over, game_plays insert, onQuit/onChooseGame) so
// the two games feel like siblings, not two unrelated features bolted
// together. Doubles as the untimed "Practice Articles" mode reachable
// from the Mistake Notebook's Articles tab (mode="practice") -- same
// noun/button/feedback/speech mechanics, just a different word source
// and end condition, rather than a whole separate component.

const GAME_DURATION = 60;
const FAMILIARITY_WEIGHT: Record<ArticleFamiliarity, number> = {
  mistake: 100, learning: 40, mastered: 12, unseen: 3,
};
// How many of the most-recently-shown words are excluded from the next
// weighted pick, so an easy/high-weight word can't repeat back to back.
const RECENT_WINDOW = 4;

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

type Phase = 'intro' | 'playing' | 'over';
type Article = 'der' | 'die' | 'das';

interface Props {
  mode?: 'timed' | 'practice';
  // Required for mode="timed" -- tags the game_plays row (see that
  // migration's `game` column) the same way WordMatchGame's own `source`
  // does. Practice mode never records a play/point (same reasoning as
  // MistakeRedoCard's own redo flow -- remedial practice, not a game).
  source?: 'settings_preview' | 'daily_flow';
  onQuit?: () => void;
  onChooseGame?: () => void;
  homeHref?: string;
  homeLabel?: string;
  quitLabel?: string;
}

export default function ArtikelBlitzGame({
  mode = 'timed', source, onQuit, onChooseGame,
  homeHref = '/', homeLabel = '← Home', quitLabel = 'Finish for today',
}: Props) {
  const [phase, setPhase] = useState<Phase>(mode === 'practice' ? 'playing' : 'intro');
  const [pool, setPool] = useState<Word[]>([]);
  const [current, setCurrent] = useState<Word | null>(null);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [timerStarted, setTimerStarted] = useState(false);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [earnedPoint, setEarnedPoint] = useState(false);
  const [avatarId, setAvatarId] = useState('dachshund');
  const [petReaction, setPetReaction] = useState<'happy' | 'sad' | null>(null);
  const [answerState, setAnswerState] = useState<{ chosen: Article; correct: boolean } | null>(null);
  const [feedback, setFeedback] = useState<{ article: Article; de: string; en: string; correct: boolean } | null>(null);
  const [disabled, setDisabled] = useState(false);

  const nativeLanguage = getSettings().nativeLanguage;

  // The live word queue and per-word progress cache are refs, not state
  // -- pure bookkeeping the render never needs to react to directly (only
  // `current` does), same reasoning as WordMatchGame's own usedIdsRef.
  const queueRef = useRef<Word[]>([]);
  const recentIdsRef = useRef<string[]>([]);
  const progressRef = useRef<Record<string, WordProgress>>({});

  useEffect(() => {
    getDisplayProfile().then(profile => setAvatarId(profile.avatarId));
  }, []);

  function progressFor(w: Word): WordProgress {
    if (!progressRef.current[w.id]) {
      progressRef.current[w.id] = getWordProgressForLevel(w.level, w.id);
    }
    return progressRef.current[w.id];
  }

  function weightFor(w: Word): number {
    return FAMILIARITY_WEIGHT[articleFamiliarity(progressFor(w))];
  }

  function pickNext(source: Word[]): Word {
    const candidates = source.filter(w => !recentIdsRef.current.includes(w.id));
    const usable = candidates.length > 0 ? candidates : source;
    const weights = usable.map(weightFor);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < usable.length; i++) {
      r -= weights[i];
      if (r <= 0) return usable[i];
    }
    return usable[usable.length - 1];
  }

  function enqueueNext(source: Word[]) {
    const w = pickNext(source);
    queueRef.current.push(w);
    recentIdsRef.current.push(w.id);
    if (recentIdsRef.current.length > RECENT_WINDOW) recentIdsRef.current.shift();
  }

  // A wrong answer reappears 5-10 words later, not immediately -- long
  // enough that it isn't rote short-term repetition, short enough that
  // it comes back well within the same round.
  function requeueWrong(w: Word) {
    const delay = 5 + Math.floor(Math.random() * 6);
    const pos = Math.min(queueRef.current.length, delay);
    queueRef.current.splice(pos, 0, w);
  }

  function nextWord() {
    if (mode === 'timed') {
      if (queueRef.current.length < 3) enqueueNext(pool);
      setCurrent(queueRef.current.shift() ?? null);
    } else {
      const w = queueRef.current.shift();
      if (!w) { setPhase('over'); return; }
      setCurrent(w);
    }
    setFeedback(null);
    setAnswerState(null);
    setDisabled(false);
  }

  function startTimed() {
    const words = articleCandidateWords();
    setPool(words);
    progressRef.current = {};
    for (const w of words) progressFor(w); // warm the cache once up front
    queueRef.current = [];
    recentIdsRef.current = [];
    setScore(0); setAnswered(0); setCorrectCount(0); setEarnedPoint(false);
    setTimeLeft(GAME_DURATION); setTimerStarted(false);
    setPhase('playing');
    for (let i = 0; i < 3; i++) enqueueNext(words);
    setCurrent(queueRef.current.shift() ?? null);
    setFeedback(null); setAnswerState(null); setDisabled(false);
  }

  // Practice mode: draws only from words with an active article mistake,
  // right when this mounts (the "Practice Articles" button itself is the
  // start action -- no separate intro screen, matching MistakeRedoCard's
  // own "tap it and you're straight into the content" pattern).
  useEffect(() => {
    if (mode !== 'practice') return;
    const words = articleCandidateWords();
    progressRef.current = {};
    const withMistake = words.filter(w => { progressFor(w); return !!progressRef.current[w.id].articleMistake; });
    setPool(withMistake);
    queueRef.current = shuffled(withMistake);
    setAnswered(0); setCorrectCount(0);
    const w = queueRef.current.shift();
    setCurrent(w ?? null);
    if (!w) setPhase('over');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Countdown -- starts only once the first answer lands (see answer()),
  // same "no free thinking time" reasoning validated in the preview.
  useEffect(() => {
    if (mode !== 'timed' || phase !== 'playing' || !timerStarted) return;
    if (timeLeft <= 0) { setPhase('over'); return; }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [mode, phase, timerStarted, timeLeft]);

  // Records one completed timed round the moment it ends -- best-effort,
  // exactly like WordMatchGame's own game_plays insert. Practice mode
  // never reaches here (no timer to run out, and its own queue-exhausted
  // path below doesn't set earnedPoint).
  useEffect(() => {
    if (mode !== 'timed' || phase !== 'over') return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user.id) setEarnedPoint(true);
        await supabase.from('game_plays').insert({
          device_id: getOrCreateDeviceId(),
          user_id: session?.user.id ?? null,
          source,
          game: 'artikel_blitz',
          words_answered: answered,
          correct_count: correctCount,
        });
      } catch {
        // best-effort, same as WordMatchGame
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, phase]);

  function answer(chosen: Article) {
    if (!current || disabled) return;
    if (mode === 'timed' && !timerStarted) setTimerStarted(true);
    setDisabled(true);
    const w = current;
    const correct = chosen === w.article;
    setAnswered(a => a + 1);

    const p = progressFor(w);
    const nextP = correct ? recordArticleRecall(p) : recordArticleMistake(p);
    progressRef.current[w.id] = nextP;
    saveWordProgressForLevel(w.level, nextP);

    if (correct) {
      setCorrectCount(c => c + 1);
      setScore(s => s + 1);
      setPetReaction('happy');
    } else {
      requeueWrong(w);
      setPetReaction('sad');
    }
    setAnswerState({ chosen, correct });
    setFeedback({ article: w.article as Article, de: w.de, en: glossFor(w, nativeLanguage), correct });
    speakWord(w);
    setTimeout(() => setPetReaction(null), 450);

    // If the countdown reaches 0 in the meantime, its own effect flips
    // phase to 'over' -- nextWord() still runs here regardless (harmless;
    // the 'over' screen doesn't read current/feedback), simpler than
    // trying to race-check the timer from inside this closure.
    setTimeout(nextWord, correct ? 550 : 900);
  }

  // Only computed for the intro screen (mode="timed", phase="intro") --
  // no need to re-scan the whole corpus on every render once playing.
  const eligibleLearnedCount = mode === 'timed' && phase === 'intro'
    ? articleCandidateWords().filter(w => !!getWordProgressForLevel(w.level, w.id).mascotStage).length
    : 0;
  const canPlay = eligibleLearnedCount >= GAME_MIN_WORDS_REQUIRED;

  const petImg = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${heroImageFor(avatarId)}`;

  return (
    <div className="flex flex-col gap-5">
      {mode === 'timed' && (
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Artikel Blitz</h1>
          {onQuit ? (
            <button type="button" onClick={onQuit} className="text-sm font-semibold text-on-bg/80 hover:text-on-bg underline">
              {quitLabel} →
            </button>
          ) : (
            <Link href={homeHref} className="text-sm font-semibold text-on-bg/80 hover:text-on-bg underline">
              {homeLabel}
            </Link>
          )}
        </div>
      )}

      {phase === 'intro' && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-4 items-center text-center">
          <h2 className="text-lg font-bold text-ink">der / die / das, against the clock</h2>
          {canPlay ? (
            <>
              <p className="text-ink-soft text-xs">{GAME_DURATION}s · as many nouns as you can</p>
              <button
                type="button"
                onClick={startTimed}
                className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all"
                style={{ backgroundImage: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)' }}
              >
                Start
              </button>
            </>
          ) : (
            <p className="text-label bg-paper-dim/70 rounded-xl px-4 py-3 text-sm">
              Learn at least {GAME_MIN_WORDS_REQUIRED} nouns first to unlock this game — you have {eligibleLearnedCount} so far.
            </p>
          )}
        </div>
      )}

      {phase === 'playing' && current && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5 flex flex-col items-center gap-7">
          {mode === 'timed' && (
            <div className="w-full flex items-center justify-between">
              <span className="font-mono font-medium text-sm text-ink-soft/80">{timerStarted ? `${timeLeft}s` : `${GAME_DURATION}s`}</span>
              <span className="font-mono font-medium text-sm text-ink-soft/80">{score} pts</span>
            </div>
          )}

          <img
            src={petImg}
            alt=""
            className={`h-14 w-auto object-contain drop-shadow-md ${petReaction === 'happy' ? 'animate-pet-happy' : petReaction === 'sad' ? 'animate-pet-sad' : ''}`}
          />

          <div className="text-center min-h-[80px] flex flex-col justify-center">
            {feedback ? (
              <>
                <div className={`text-lg font-bold ${feedback.correct ? 'text-good-deep' : 'text-clay'}`}>
                  {feedback.article} {feedback.de}{feedback.correct ? ' ✓' : ''}
                </div>
                <div className="text-ink-soft text-sm mt-1">{feedback.en}</div>
              </>
            ) : (
              <div className="text-5xl font-bold text-ink" style={{ textWrap: 'balance' }}>{current.de}</div>
            )}
          </div>

          <div className="flex gap-3 w-full max-w-[340px]">
            {(['der', 'die', 'das'] as Article[]).map(a => {
              let cls = 'border-2 border-accent/30 bg-paper/80 text-ink hover:border-accent/70';
              if (answerState?.chosen === a) {
                cls = answerState.correct
                  ? 'border-2 border-good-deep bg-good/25 text-good-deep animate-pet-happy'
                  : 'border-2 border-clay bg-clay/20 text-clay animate-shake';
              } else if (answerState && !answerState.correct && current.article === a) {
                cls = 'border-2 border-good-deep bg-good/25 text-good-deep';
              }
              return (
                <button
                  key={a}
                  onClick={() => answer(a)}
                  disabled={disabled}
                  className={`flex-1 py-5 rounded-xl font-extrabold text-xl tracking-wide transition-colors ${cls} disabled:pointer-events-none`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-3 items-center text-center">
          <h2 className="text-lg font-bold text-ink">{mode === 'practice' ? 'All caught up!' : "Time's up!"}</h2>
          {answered > 0 ? (
            <div className="flex gap-6">
              <div>
                <div className="text-2xl font-extrabold text-label">{answered > 0 ? Math.round((correctCount / answered) * 100) : 0}%</div>
                <div className="text-ink-soft text-xs uppercase tracking-wide">Accuracy</div>
              </div>
              <div>
                <div className="text-2xl font-extrabold text-label">{answered}</div>
                <div className="text-ink-soft text-xs uppercase tracking-wide">Answered</div>
              </div>
            </div>
          ) : (
            <p className="text-ink-soft text-sm">No active article mistakes right now — nice work.</p>
          )}
          {earnedPoint && (
            <div className="flex items-center gap-1 text-label font-mono font-bold text-sm">
              <PointsIcon className="w-4 h-4" /> +1
            </div>
          )}
          {mode === 'timed' && (
            <button
              type="button"
              onClick={startTimed}
              className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all mt-2"
              style={{ backgroundImage: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)' }}
            >
              Play again
            </button>
          )}
          {onChooseGame && (
            <button
              type="button"
              onClick={onChooseGame}
              className="text-ink-soft hover:text-ink text-sm font-medium underline transition-colors"
            >
              Choose a game
            </button>
          )}
          {onQuit && (
            <button
              type="button"
              onClick={onQuit}
              className="text-ink-soft hover:text-ink text-sm font-medium underline transition-colors"
            >
              {mode === 'practice' ? 'Back to notebook' : quitLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
