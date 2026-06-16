'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { buildQueue, PracticeItem, checkAnswer, advanceLevel, dropLevel, getBlankPattern } from '../../lib/practice';
import { saveWordProgress, saveSession, getSession, touchStreak } from '../../lib/storage';
import SpecialCharButtons from '../../components/SpecialCharButtons';
import Link from 'next/link';

type Stage = 'beginning' | 'input' | 'feedback';

export default function PracticePage() {
  const [queue, setQueue] = useState<PracticeItem[]>([]);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('beginning');
  const [answer, setAnswer] = useState('');
  const [blanks, setBlanks] = useState<boolean[]>([]);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = buildQueue();
    setQueue(q);
    const s = getSession();
    saveSession({ ...s, total: q.length });
  }, []);

  const current = queue[index];

  useEffect(() => {
    if (!current) return;
    if (current.progress.level === -1) {
      setStage('beginning');
    } else {
      const pattern = getBlankPattern(current.word.de, current.progress.level);
      setBlanks(pattern);
      setStage('input');
    }
    setAnswer('');
    setCorrect(null);
  }, [index, current]);

  useEffect(() => {
    if (stage === 'input') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [stage]);

  const handleConfirmBeginning = () => {
    const updated = advanceLevel(current.progress);
    saveWordProgress(updated);
    const pattern = getBlankPattern(current.word.de, updated.level);
    setBlanks(pattern);
    setStage('input');
    setAnswer('');
  };

  const handleSubmit = () => {
    const isCorrect = checkAnswer(current.word.de, answer);
    setCorrect(isCorrect);
    const updated = isCorrect ? advanceLevel(current.progress) : dropLevel(current.progress);
    updated.lastPracticed = new Date().toISOString().slice(0, 10);
    saveWordProgress(updated);
    touchStreak();
    setStage('feedback');
  };

  const handleNext = useCallback(() => {
    const s = getSession();
    saveSession({ ...s, done: index + 1 });
    if (index + 1 >= queue.length) {
      setDone(true);
    } else {
      setIndex(i => i + 1);
    }
  }, [index, queue.length]);

  if (queue.length === 0) {
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
        <p className="text-slate-500 mb-6">You practised {queue.length} words.</p>
        <Link href="/" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-indigo-700">
          Back to Home
        </Link>
      </div>
    );
  }

  if (!current) return null;

  const word = current.word;
  const level = current.progress.level;
  const levelLabel = level === -1 ? 'New' : level === 2 ? `Level 2 (${current.progress.level2Count}/2)` : `Level ${level}`;

  const displayWord = level === -1
    ? word.de
    : [...word.de].map((ch, i) => blanks[i] ? '＿' : ch).join('');

  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-sm text-slate-400 mb-1">
          <span>{index + 1} / {queue.length}</span>
          <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-medium">{levelLabel}</span>
        </div>
        <div className="h-2 bg-indigo-100 rounded-full">
          <div
            className="h-2 bg-indigo-500 rounded-full transition-all"
            style={{ width: `${((index) / queue.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-indigo-50 p-6 flex flex-col gap-4">
        {/* Translation always shown */}
        <div className="text-center">
          <span className="text-slate-400 text-sm">English</span>
          <div className="text-xl font-semibold text-slate-700 mt-1">{word.en}</div>
        </div>

        {word.type === 'noun' && word.article && (
          <div className="text-center">
            <span className="text-indigo-400 text-sm">article</span>
            <div className="text-lg font-bold text-indigo-600 mt-1">{word.article}</div>
          </div>
        )}

        <div className="text-center">
          <span className="text-slate-400 text-sm">German</span>
          <div className="text-3xl font-mono font-bold text-indigo-800 mt-1 tracking-widest">
            {stage === 'beginning' ? word.de : displayWord}
          </div>
          {word.type === 'noun' && word.plural && (
            <div className="text-slate-400 text-sm mt-1">Pl.: {word.plural}</div>
          )}
        </div>

        {stage === 'beginning' && (
          <button
            onClick={handleConfirmBeginning}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Got it, practice now →
          </button>
        )}

        {stage === 'input' && (
          <div className="flex flex-col gap-3">
            <SpecialCharButtons inputRef={inputRef} />
            <input
              ref={inputRef}
              type="text"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && answer.trim() && handleSubmit()}
              placeholder="Type the word…"
              className="w-full border-2 border-indigo-200 rounded-xl px-4 py-3 text-lg text-center focus:outline-none focus:border-indigo-500 font-mono"
              autoComplete="off"
              autoCapitalize="none"
            />
            <button
              onClick={handleSubmit}
              disabled={!answer.trim()}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Check
            </button>
          </div>
        )}

        {stage === 'feedback' && (
          <div className="flex flex-col gap-3">
            <div className={`text-center py-3 rounded-xl font-semibold text-lg ${correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {correct ? '✓ Correct!' : `✗ The word is: ${word.de}`}
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
        <div className="text-center text-slate-400 text-sm">
          Category: {word.category}
        </div>
      )}
    </div>
  );
}
