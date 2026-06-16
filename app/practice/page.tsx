'use client';

import { useEffect, useRef, useState } from 'react';
import { buildSessionWords, generateHint, checkAnswer, applyResult } from '../../lib/practice';
import { getWordProgress, saveWordProgress, saveSession, getSession, touchStreak } from '../../lib/storage';
import { Word } from '../../lib/words';
import SpecialCharButtons from '../../components/SpecialCharButtons';
import Link from 'next/link';

const ROUND_LABELS: Record<number, string> = {
  0: 'Round 1 of 3 — one letter hint',
  1: 'Round 2 of 3 — first letter hint',
  2: 'Round 3 of 3 — no hints',
};

export default function PracticePage() {
  const [words, setWords] = useState<Word[]>([]);
  const [round, setRound] = useState<0 | 1 | 2>(0);
  const [wordIdx, setWordIdx] = useState(0);
  const [hint, setHint] = useState<boolean[]>([]);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [roundDone, setRoundDone] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load words on mount
  useEffect(() => {
    const w = buildSessionWords();
    setWords(w);
    const s = getSession();
    saveSession({ ...s, total: w.length * 3 });
  }, []);

  const word = words[wordIdx] ?? null;

  // Regenerate hint whenever word or round changes
  useEffect(() => {
    if (!word) return;
    setHint(generateHint(word.de, round));
    setAnswer('');
    setFeedback(null);
  }, [wordIdx, round, word?.id]);

  // Focus input when entering input phase
  useEffect(() => {
    if (feedback === null && !roundDone && !done && words.length > 0) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [wordIdx, round, feedback, roundDone, done, words.length]);

  const handleSubmit = () => {
    if (!word || !answer.trim()) return;
    const correct = checkAnswer(word.de, answer);
    const progress = getWordProgress(word.id);
    const updated = applyResult(progress, round, correct);
    saveWordProgress(updated);
    touchStreak();
    setFeedback(correct);
    const s = getSession();
    saveSession({ ...s, done: round * words.length + wordIdx + 1 });
  };

  const handleNext = () => {
    const nextIdx = wordIdx + 1;
    if (nextIdx >= words.length) {
      if (round === 2) {
        setDone(true);
      } else {
        setRoundDone(true);
      }
    } else {
      setWordIdx(nextIdx);
    }
  };

  const handleNextRound = () => {
    setRoundDone(false);
    setRound((r) => (r + 1) as 0 | 1 | 2);
    setWordIdx(0);
  };

  // --- Empty / done screens ---

  if (words.length === 0 && !done) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-indigo-700 mb-2">All caught up!</h2>
        <p className="text-slate-500 mb-6">No words left to practice today.</p>
        <Link href="/" className="text-indigo-600 underline">Back to Home</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-indigo-700 mb-2">Session complete!</h2>
        <p className="text-slate-500 mb-6">
          You practised {words.length} words across 3 rounds.
        </p>
        <Link href="/" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700">
          Back to Home
        </Link>
      </div>
    );
  }

  // --- Between-round transition ---

  if (roundDone) {
    const nextRound = (round + 1) as 0 | 1 | 2;
    const nextDesc = nextRound === 1 ? 'first letter shown as hint' : 'no hints — full recall';
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="text-5xl">🔄</div>
        <h2 className="text-2xl font-bold text-indigo-700">Round {round + 1} complete!</h2>
        <p className="text-slate-500">
          Next up: Round {nextRound + 1} of 3 — {nextDesc}
        </p>
        <button
          onClick={handleNextRound}
          className="bg-indigo-600 text-white px-10 py-4 rounded-2xl text-lg font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
        >
          Continue →
        </button>
      </div>
    );
  }

  if (!word) return null;

  const chars = [...word.de];

  return (
    <div className="flex flex-col gap-5">
      {/* Progress header */}
      <div>
        <div className="flex justify-between text-sm text-slate-400 mb-1">
          <span className="font-medium text-indigo-600">{ROUND_LABELS[round]}</span>
          <span>{wordIdx + 1} / {words.length}</span>
        </div>
        <div className="h-2 bg-indigo-100 rounded-full">
          <div
            className="h-2 bg-indigo-500 rounded-full transition-all"
            style={{ width: `${(wordIdx / words.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-50 p-6 flex flex-col gap-5">

        {/* English translation — always visible */}
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">English</div>
          <div className="text-2xl font-semibold text-slate-700">{word.en}</div>
        </div>

        {/* Article chip for nouns */}
        {word.type === 'noun' && word.article && (
          <div className="flex justify-center">
            <span className="bg-indigo-100 text-indigo-700 font-bold px-4 py-1 rounded-full text-lg">
              {word.article}
            </span>
          </div>
        )}

        {/* Hint tiles — blank or letter */}
        <div className="flex flex-wrap gap-2 justify-center">
          {chars.map((ch, i) => (
            <div
              key={i}
              className={`w-9 h-11 flex items-end justify-center pb-1 text-xl font-mono font-bold border-b-2 ${
                hint[i]
                  ? 'border-slate-300 text-transparent'
                  : 'border-indigo-500 text-indigo-800'
              }`}
            >
              {hint[i] ? ' ' : ch}
            </div>
          ))}
        </div>

        {feedback === null ? (
          <div className="flex flex-col gap-3">
            <SpecialCharButtons inputRef={inputRef} />
            <input
              ref={inputRef}
              type="text"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && answer.trim() && handleSubmit()}
              placeholder="Type the full word…"
              className="w-full border-2 border-indigo-200 rounded-xl px-4 py-3 text-lg text-center focus:outline-none focus:border-indigo-500 font-mono"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <button
              onClick={handleSubmit}
              disabled={!answer.trim()}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Check
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
        <div className="text-center text-slate-400 text-xs">{word.category}</div>
      )}
    </div>
  );
}
