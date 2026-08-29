'use client';

import { useState } from 'react';
import { Word, Level, glossFor, diffAgainstAttempt } from '../lib/words';
import { WordProgress, getSettings, getWordProgress, saveWordProgress } from '../lib/storage';
import { correctSentence, DailyLimitReachedError, AIUnreachableError } from '../lib/ai';
import { scheduleSync } from '../lib/sync';
import { playCorrectChime } from '../lib/sound';
import SpeakerButton from './SpeakerButton';
import TextSpeakerButton from './TextSpeakerButton';

interface Props {
  word: Word;
  mistake: NonNullable<WordProgress['lastMistake']>;
  level: Level;
  onDone: () => void;
}

// The Word List's "Needs practice" redo flow (the "Mistake Notebook") —
// re-shows the EXACT SAME English prompt a word's round-1 introduction
// used (see WordProgress.lastMistake's own comment for why round 1 only
// ever happens once, so this is the only way to ever revisit it) and
// calls correctSentence live again on a fresh attempt, same as the real
// exercise does. Deliberately never touches round/mascotStage/scheduling —
// this is pure extra reinforcement, same "never touches scoring" status
// every other bonus/practice-more path in the app already has.
export default function MistakeRedoCard({ word, mistake, level, onDone }: Props) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'limit-reached' | 'unreachable'>('idle');
  const [result, setResult] = useState<{ sentence: string; wordForm: string } | null>(null);
  const nativeLanguage = getSettings().nativeLanguage;

  const diff = result ? diffAgainstAttempt(input, result.sentence) : null;

  const handleSubmit = () => {
    if (!input.trim() || status === 'loading') return;
    setStatus('loading');
    correctSentence(word.id, word.de, level, mistake.englishPrompt ?? '', input.trim())
      .then(correction => {
        setResult(correction);
        setStatus('idle');
        const perfect = diffAgainstAttempt(input, correction.sentence).perfect;
        if (perfect) playCorrectChime();
        // Re-read fresh rather than trusting a closed-over copy of `word`
        // (which has no progress fields at all) — this card can sit open
        // a while (the learner may pause to think), and other progress
        // writes elsewhere shouldn't be clobbered by a stale snapshot.
        const current = getWordProgress(word.id);
        saveWordProgress({
          ...current,
          exampleSentence: perfect
            ? { sentence: correction.sentence, wordForm: correction.wordForm, englishPrompt: mistake.englishPrompt, englishPromptZh: mistake.englishPromptZh }
            : current.exampleSentence,
          lastMistake: perfect ? undefined : {
            englishPrompt: mistake.englishPrompt,
            englishPromptZh: mistake.englishPromptZh,
            userInput: input.trim(),
            correctedSentence: correction.sentence,
            wordForm: correction.wordForm,
          },
        });
        scheduleSync();
      })
      .catch(e => {
        if (e instanceof AIUnreachableError) { setStatus('unreachable'); return; }
        setStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
      });
  };

  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-indigo-800">
          {word.article ? `${word.article} ` : ''}{word.de}
          <SpeakerButton word={word} className="ml-1.5 align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-base" />
        </span>
        <span className="text-stone-600 text-sm">{glossFor(word, nativeLanguage)}</span>
      </div>

      <div className="bg-indigo-50 rounded-xl px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-indigo-400 mb-1">Translate to German</div>
        <div className="text-stone-700 italic">
          {nativeLanguage === 'zh' ? (mistake.englishPromptZh ?? mistake.englishPrompt) : mistake.englishPrompt}
        </div>
      </div>

      <div className="text-xs text-stone-500">
        Last time: <span className="italic">{mistake.userInput}</span>
      </div>

      {!result && (
        <>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={2}
            placeholder="Type your German translation…"
            className="w-full border-2 border-indigo-100 rounded-xl px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-indigo-300 resize-none"
          />
          {status === 'error' && <p className="text-red-500 text-xs">Couldn't check that — try again.</p>}
          {status === 'limit-reached' && <p className="text-amber-600 text-xs">Used up today's practice limit — come back tomorrow.</p>}
          {status === 'unreachable' && <p className="text-amber-600 text-xs">Can't reach our AI service right now.</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || status === 'loading'}
              className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40"
            >
              {status === 'loading' ? 'Checking…' : 'Check'}
            </button>
            <button onClick={onDone} className="text-stone-500 text-sm px-3">Close</button>
          </div>
        </>
      )}

      {result && diff && (
        <>
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-green-600 mb-1 font-medium flex items-center justify-center gap-1.5">
              {diff.perfect ? '✓ Perfect!' : 'Correction'}
              <TextSpeakerButton text={result.sentence} className="text-green-500 hover:text-green-700 transition-colors normal-case" />
            </div>
            <div className="text-lg text-green-800 text-center">
              {diff.tokens.map(({ text, changed }, i) => (
                <span key={i} className={changed ? 'underline decoration-violet-500 decoration-2 underline-offset-2 font-bold' : undefined}>
                  {text}
                </span>
              ))}
            </div>
          </div>
          {diff.perfect ? (
            <p className="text-green-700 text-sm text-center">Cleared from your mistake notebook 🎉</p>
          ) : (
            <p className="text-stone-500 text-sm text-center">Still not quite — want to try again?</p>
          )}
          <div className="flex gap-2">
            {!diff.perfect && (
              <button
                onClick={() => { setResult(null); setInput(''); setStatus('idle'); }}
                className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Try again
              </button>
            )}
            <button
              onClick={onDone}
              className={diff.perfect ? 'flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all' : 'text-stone-500 text-sm px-3'}
            >
              {diff.perfect ? 'Done' : 'Close'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
