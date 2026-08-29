'use client';

import { useState } from 'react';
import { Word, glossFor } from '../lib/words';
import { ParagraphExercise } from '../lib/storage';
import { getSettings } from '../lib/storage';
import { playCorrectChime } from '../lib/sound';
import SpeakerButton from './SpeakerButton';

interface Props {
  exercise: ParagraphExercise;
  words: Word[]; // this batch's words, for the reveal panel after checking
  onComplete: () => void;
}

// The bonus end-of-introduction cloze paragraph: tap a word chip, then tap
// a blank to drop it there (tap a filled blank to pull it back out) --
// deliberately NOT real HTML5 drag-and-drop, which is unreliable on mobile
// touch (the actual target audience for a quick daily bonus round).
// Tracked by TRAY INDEX rather than the answer string itself throughout --
// two different words can coincidentally need the identical inflected
// form, and filtering "already placed" by string equality would then hide
// both copies the moment either one gets placed.
export default function ParagraphExerciseCard({ exercise, words, onComplete }: Props) {
  const [blankTray, setBlankTray] = useState<(number | null)[]>(() => exercise.blanks.map(() => null));
  const [selectedTray, setSelectedTray] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  const wordById = new Map(words.map(w => [w.id, w]));
  const usedIndices = new Set(blankTray.filter((i): i is number => i !== null));
  const allFilled = blankTray.every(i => i !== null);
  const results = checked ? blankTray.map((trayIdx, blankIdx) => trayIdx !== null && exercise.tray[trayIdx] === exercise.blanks[blankIdx].answer) : null;
  const allCorrect = results?.every(Boolean) ?? false;

  const handleTrayTap = (trayIdx: number) => {
    if (checked || usedIndices.has(trayIdx)) return;
    setSelectedTray(prev => (prev === trayIdx ? null : trayIdx));
  };

  const handleBlankTap = (blankIdx: number) => {
    if (checked) return;
    if (blankTray[blankIdx] !== null) {
      setBlankTray(arr => arr.map((v, i) => (i === blankIdx ? null : v)));
      return;
    }
    if (selectedTray === null) return;
    setBlankTray(arr => arr.map((v, i) => (i === blankIdx ? selectedTray : v)));
    setSelectedTray(null);
  };

  const handleCheck = () => {
    setChecked(true);
    const correct = blankTray.every((trayIdx, blankIdx) => trayIdx !== null && exercise.tray[trayIdx] === exercise.blanks[blankIdx].answer);
    if (correct) playCorrectChime();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5">
        <div className="text-sm font-medium text-indigo-600">
          {checked ? (allCorrect ? 'Perfect! 🎉' : 'Here\'s how it fits together') : 'Tap a word, then tap where it belongs'}
        </div>

        <div className="text-lg leading-relaxed text-slate-700">
          {exercise.segments.map((segment, i) => (
            <span key={i}>
              {segment}
              {i < exercise.blanks.length && (
                <BlankSlot
                  filled={blankTray[i] !== null ? exercise.tray[blankTray[i] as number] : null}
                  selectable={!checked && blankTray[i] === null && selectedTray !== null}
                  checked={checked}
                  correct={results ? results[i] : null}
                  correctAnswer={exercise.blanks[i].answer}
                  onTap={() => handleBlankTap(i)}
                />
              )}
            </span>
          ))}
        </div>

        {!checked && (
          <div className="flex flex-wrap gap-2 justify-center pt-1 border-t border-amber-100/60">
            {exercise.tray.map((answer, trayIdx) =>
              usedIndices.has(trayIdx) ? null : (
                <button
                  key={trayIdx}
                  onClick={() => handleTrayTap(trayIdx)}
                  className={`px-4 py-2 rounded-xl font-medium border-2 transition-all ${
                    selectedTray === trayIdx
                      ? 'border-indigo-500 bg-indigo-100 text-indigo-700 scale-105'
                      : 'border-indigo-200 bg-white/80 text-slate-700 hover:border-indigo-400'
                  }`}
                >
                  {answer}
                </button>
              ),
            )}
          </div>
        )}

        {!checked && (
          <button
            onClick={handleCheck}
            disabled={!allFilled}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40 disabled:hover:bg-indigo-600"
          >
            Check
          </button>
        )}

        {checked && (
          <>
            <div className="flex flex-col gap-2 pt-1 border-t border-amber-100/60">
              {exercise.blanks.map((blank, i) => {
                const w = wordById.get(blank.wordId);
                if (!w) return null;
                return (
                  <div key={i} className="flex items-center justify-between gap-3 bg-white/70 rounded-xl px-4 py-2.5">
                    <div>
                      <span className="font-semibold text-stone-800">
                        {w.article ? `${w.article} ` : ''}{w.de}
                        <SpeakerButton word={w} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
                      </span>
                      <div className="text-stone-500 text-sm">{glossFor(w, getSettings().nativeLanguage)}</div>
                    </div>
                    <span className={`shrink-0 text-lg ${results?.[i] ? 'text-green-600' : 'text-red-500'}`}>
                      {results?.[i] ? '✓' : '✗'}
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              onClick={onComplete}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Continue →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BlankSlot({
  filled, selectable, checked, correct, correctAnswer, onTap,
}: {
  filled: string | null;
  selectable: boolean;
  checked: boolean;
  correct: boolean | null;
  correctAnswer: string;
  onTap: () => void;
}) {
  let cls = 'border-slate-300 bg-white/60 text-slate-400';
  if (checked) {
    cls = correct ? 'border-green-400 bg-green-100 text-green-700' : 'border-red-400 bg-red-100 text-red-700';
  } else if (filled !== null) {
    cls = 'border-indigo-400 bg-indigo-50 text-indigo-700';
  } else if (selectable) {
    cls = 'border-indigo-400 bg-indigo-50/60 text-indigo-400 animate-pulse';
  }
  return (
    <button
      onClick={onTap}
      disabled={checked}
      className={`inline-flex items-center justify-center mx-1 px-2 py-0.5 rounded-lg border-2 font-semibold align-baseline ${cls}`}
    >
      {checked ? correctAnswer : (filled ?? '____')}
      {checked && !correct && filled && <span className="ml-1 text-xs line-through opacity-70">{filled}</span>}
    </button>
  );
}
