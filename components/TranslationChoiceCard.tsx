'use client';

import { useEffect, useState } from 'react';
import { Word } from '../lib/words';
import SpeakerButton from './SpeakerButton';
import { speakWord } from '../lib/speech';

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

  // Guards against a stuck retry loop: when the same word is the only one
  // left in the round-1.5 retry queue, it comes back up as the very next
  // question with the same `word.id` — and since the parent's setMcqCurrent
  // calls (null, then the next question) both happen inside one handler,
  // React 18 batches them into a single commit and never actually unmounts
  // this component, so `selected` would otherwise carry over from the wrong
  // answer just given. `choices` is always a freshly-shuffled array from
  // buildMcqChoices — even for a repeated word — so it's a reliable signal
  // that a genuinely new question has started and the pick should reset.
  useEffect(() => {
    setSelected(null);
  }, [choices]);

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

  // Every pick plays the word's pronunciation once. A correct pick also
  // auto-advances after a short pause; a wrong one still needs a manual
  // Next so there's time to read which one was actually right.
  useEffect(() => {
    if (selected === null) return;
    speakWord(word);
  }, [selected, word]);

  useEffect(() => {
    if (!correct) return;
    const timer = setTimeout(() => onAnswer(true), 1200);
    return () => clearTimeout(timer);
  }, [correct, onAnswer]);

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
        {selected !== null && !correct && (
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
