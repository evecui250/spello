'use client';

import { useEffect, useState } from 'react';
import { Word } from '../lib/words';
import SpeakerButton from './SpeakerButton';

interface Props {
  word: Word;
  choices: string[];
  onAnswer: (correct: boolean) => void;
}

// Round 1.5 — the German word is shown, the user picks its English meaning
// from 4 choices. Reinforcement only: never touches masteryScore/growthScore/
// nextReviewDue, only the word's own round-ladder progress does that.
export default function TranslationChoiceCard({ word, choices, onAnswer }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const handlePick = (choice: string) => {
    if (selected !== null) return;
    setSelected(choice);
  };

  const correct = selected !== null && selected === word.en;

  // Enter advances once a choice is picked. No arm/disarm double-press guard
  // here (unlike the round-ladder's Enter handling) — a choice is only ever
  // picked by clicking, never by pressing Enter, so there's no same-keypress
  // ambiguity to guard against; a single Enter press should just work.
  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter') onAnswer(correct); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, correct, onAnswer]);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5">
        <div className="text-sm font-medium text-indigo-600">What does this word mean?</div>
        <div className="text-center">
          <span className="font-mono text-2xl font-bold text-indigo-800 tracking-wide">
            {word.article ? `${word.article} ` : ''}{word.de}
          </span>
          <SpeakerButton word={word} className="ml-2 align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-xl" />
        </div>
        <div className="flex flex-col gap-2">
          {choices.map(choice => {
            const isCorrectChoice = choice === word.en;
            const isPicked = choice === selected;
            let cls = 'border-2 border-indigo-100 text-slate-700 hover:border-indigo-300';
            if (selected !== null) {
              if (isCorrectChoice) cls = 'border-2 border-green-400 bg-green-100 text-green-700';
              else if (isPicked) cls = 'border-2 border-red-400 bg-red-100 text-red-700';
              else cls = 'border-2 border-indigo-100 text-slate-400 opacity-60';
            }
            return (
              <button
                key={choice}
                onClick={() => handlePick(choice)}
                disabled={selected !== null}
                className={`text-left px-4 py-3 rounded-xl font-medium transition-colors ${cls}`}
              >
                {choice}
              </button>
            );
          })}
        </div>
        {selected !== null && (
          <button
            onClick={() => onAnswer(correct)}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}
