'use client';

import { useEffect, useState } from 'react';
import { Word } from '../lib/words';
import { speakWord, spokenForm } from '../lib/speech';
import { playCorrectChime } from '../lib/sound';
import SpeakerButton from './SpeakerButton';

interface Props {
  word: Word;
  correct: string;
  choices: string[];
  onAnswer: (correct: boolean) => void;
  isReview?: boolean;
}

// The reverse of TranslationChoiceCard: the GERMAN word is shown (with its
// article, and a speaker button — hearing it pronounced while picking its
// meaning is the whole point of testing this direction at all), and the
// learner picks its MEANING from 4 choices (see lib/practice.ts's
// buildReverseMcqChoices for how those are picked). Deliberately different
// eyebrow copy from TranslationChoiceCard ("What does this word mean?" vs
// "Which German word means this?") rather than reusing the same phrase for
// both directions — two near-identical 4-choice screens are easy to answer
// on autopilot without registering which direction is actually being
// tested; distinct framing keeps that a conscious choice each time.
// Reinforcement only, same as TranslationChoiceCard: never touches
// mastery/growth scoring or nextReviewDue on its own.
export default function WordMeaningChoiceCard({ word, correct: correctChoice, choices, onAnswer, isReview }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  // Same reset-on-fresh-question guard as TranslationChoiceCard's own
  // effect — see its comment for why `choices` (always freshly shuffled,
  // even for a repeated word) is the reliable signal here rather than
  // `word.id` alone.
  useEffect(() => {
    setSelected(null);
  }, [choices]);

  const handlePick = (choice: string) => {
    if (selected !== null) return;
    setSelected(choice);
  };

  const correct = selected !== null && selected === correctChoice;

  useEffect(() => {
    if (selected === null) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter') onAnswer(correct); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, correct, onAnswer]);

  useEffect(() => {
    if (selected === null) return;
    if (correct) {
      playCorrectChime();
      const timer = setTimeout(() => speakWord(word), 550);
      return () => clearTimeout(timer);
    }
    speakWord(word);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, word]);

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-indigo-600">What does this word mean?</div>
          {isReview && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 shrink-0">
              Review
            </span>
          )}
        </div>
        <div className="text-center">
          <span className="text-2xl font-semibold text-slate-700">
            {spokenForm(word)}
            <SpeakerButton word={word} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {choices.map(choice => {
            const isCorrectChoice = choice === correctChoice;
            const isPicked = choice === selected;
            let cls = 'border-2 border-indigo-200 bg-white/80 text-slate-700 hover:border-indigo-400 hover:bg-white';
            if (selected !== null) {
              if (isCorrectChoice) cls = 'border-2 border-green-400 bg-green-100 text-green-700';
              else if (isPicked) cls = 'border-2 border-red-400 bg-red-100 text-red-700';
              else cls = 'border-2 border-indigo-200 bg-white/60 text-slate-400 opacity-60';
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
