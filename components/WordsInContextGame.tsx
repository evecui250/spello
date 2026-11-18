'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Word } from '../lib/words';
import { getAllProgress, getSettings, ParagraphExercise } from '../lib/storage';
import { allWordsForLevel, buildWordsInContextBatches, hasEnoughWordsForParagraph, WORDS_IN_CONTEXT_MIN_WORDS_REQUIRED } from '../lib/practice';
import { generateWordsInContextExercise } from '../lib/wordsInContext';
import { AIUnreachableError, DailyLimitReachedError } from '../lib/ai';
import { getOrCreateDeviceId } from '../lib/telemetry';
import { supabase } from '../lib/supabase';
import ParagraphExerciseCard from './ParagraphExerciseCard';
import { PointsIcon } from './icons';

// Words in Context as one of the bonus games (see GamePicker): a short
// AI-written German text with a blank for each of a few recently learned
// words — tap each word into its blank. It used to be an offer at the end
// of every day's study; as a game it's optional and the day stays short.
// Each finished text is one game_plays row ('words_in_context'), +1 coin
// for a signed-in learner, same as a Wortpaare or Artikel Blitz round.

// The most recently practiced learned words of this book — today's new
// words first, since they're what a learner most wants to see used.
function recentLearnedWords(): Word[] {
  const progress = getAllProgress();
  const when = (w: Word) => progress[w.id]?.lastReviewedAt ?? progress[w.id]?.lastPracticed ?? '';
  return allWordsForLevel(getSettings().level)
    .filter(w => !!progress[w.id]?.mascotStage)
    .sort((a, b) => when(b).localeCompare(when(a)))
    .slice(0, 12);
}

type Phase = 'loading' | 'not-enough' | 'error' | 'limit-reached' | 'unreachable' | 'playing' | 'done';

export default function WordsInContextGame({ source, onQuit, onChooseGame }: {
  source: 'settings_preview' | 'daily_flow';
  onQuit?: () => void;
  onChooseGame?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState(0);
  const [exercise, setExercise] = useState<{ words: Word[]; ex: ParagraphExercise } | null>(null);
  const [earnedPoint, setEarnedPoint] = useState(false);

  useEffect(() => {
    if (!hasEnoughWordsForParagraph()) { setPhase('not-enough'); return; }
    const settings = getSettings();
    const batch = buildWordsInContextBatches(recentLearnedWords(), settings.level)[0];
    if (!batch) { setPhase('not-enough'); return; }
    let cancelled = false;
    setPhase('loading');
    setEarnedPoint(false);
    generateWordsInContextExercise(batch, settings.level, settings.nativeLanguage, new Set(batch.map(w => w.id)))
      .then(ex => {
        if (cancelled) return;
        if (!ex) { setPhase('error'); return; }
        setExercise({ words: batch, ex });
        setPhase('playing');
      })
      .catch(e => {
        if (cancelled) return;
        setPhase(e instanceof AIUnreachableError ? 'unreachable' : e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
      });
    return () => { cancelled = true; };
  }, [round]);

  async function handleComplete() {
    setPhase('done');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user.id) setEarnedPoint(true);
      await supabase.from('game_plays').insert({
        device_id: getOrCreateDeviceId(),
        user_id: session?.user.id ?? null,
        source,
        game: 'words_in_context',
      });
    } catch {
      // best-effort, same as the other games
    }
  }

  const message = (text: string) => (
    <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 text-center text-ink-soft text-sm">
      {text}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span />
        <h1 className="text-2xl font-bold text-on-bg text-center" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Words in Context</h1>
        {onQuit ? (
          <button type="button" onClick={onQuit} className="justify-self-end text-right text-sm font-semibold text-on-bg/80 hover:text-on-bg underline">
            Finish for today →
          </button>
        ) : (
          <Link href="/" className="justify-self-end text-right text-sm font-semibold text-on-bg/80 hover:text-on-bg underline">
            ← Home
          </Link>
        )}
      </div>

      {phase === 'loading' && <p className="text-on-bg/80 text-sm text-center py-10">Writing a short text with your recent words…</p>}
      {phase === 'not-enough' && message(`Unlocks once you've learned ${WORDS_IN_CONTEXT_MIN_WORDS_REQUIRED} words — keep going!`)}
      {phase === 'error' && message("Couldn't put a text together right now. Try again in a moment.")}
      {phase === 'limit-reached' && message("You've used up today's AI exercises — come back tomorrow!")}
      {phase === 'unreachable' && message("Couldn't reach the server. Check your connection and try again.")}

      {phase === 'playing' && exercise && (
        <ParagraphExerciseCard key={round} exercise={exercise.ex} words={exercise.words} onComplete={handleComplete} />
      )}

      {phase === 'done' && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col items-center gap-3 text-center">
          <h2 className="text-lg font-bold text-ink">Nice reading!</h2>
          {earnedPoint && (
            <div className="flex items-center gap-1 text-label font-mono font-bold text-sm">
              <PointsIcon className="w-4 h-4" /> +1
            </div>
          )}
        </div>
      )}

      {phase !== 'loading' && phase !== 'playing' && (
        <div className="flex flex-col items-center gap-2">
          {onQuit && (
            <button
              type="button"
              onClick={onQuit}
              className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all"
              style={{ backgroundImage: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)' }}
            >
              Finish
            </button>
          )}
          {onChooseGame && (
            <button type="button" onClick={onChooseGame} className="text-on-bg/80 hover:text-on-bg text-sm font-medium underline">
              Choose another game
            </button>
          )}
          {phase !== 'not-enough' && (
            <button type="button" onClick={() => setRound(r => r + 1)} className="text-on-bg/80 hover:text-on-bg text-sm font-medium underline">
              {phase === 'done' ? 'Another text' : 'Try again'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
