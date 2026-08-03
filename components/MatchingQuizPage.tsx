'use client';

import { useEffect, useState } from 'react';
import { Word, glossFor } from '../lib/words';
import { getSettings } from '../lib/storage';
import { speakWord } from '../lib/speech';

interface Props {
  words: Word[];
  onComplete: () => void;
}

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// One page of the end-of-section matching quiz (exactly 5 words): click a
// German word and an English meaning, in either order, to try pairing them.
// A correct pair locks in green; a wrong one flashes red and both sides
// become pickable again — keep retrying until every pair on this page is
// correct, then "Continue" advances to the next page.
export default function MatchingQuizPage({ words, onComplete }: Props) {
  const nativeLanguage = getSettings().nativeLanguage;
  const [shuffledEn] = useState(() => shuffled(words.map(w => glossFor(w, nativeLanguage))));
  const [correctIds, setCorrectIds] = useState<Set<string>>(new Set());
  const [selectedGerman, setSelectedGerman] = useState<string | null>(null);
  const [selectedEnglish, setSelectedEnglish] = useState<string | null>(null);
  const [wrongFlash, setWrongFlash] = useState<{ german: string; english: string } | null>(null);

  const allCorrect = correctIds.size === words.length;

  // Once both sides of a pair are selected (in either order), evaluate it.
  useEffect(() => {
    if (!selectedGerman || !selectedEnglish) return;
    const word = words.find(w => w.id === selectedGerman);
    if (!word) return;
    if (glossFor(word, nativeLanguage) === selectedEnglish) {
      setCorrectIds(prev => new Set(prev).add(selectedGerman));
      setSelectedGerman(null);
      setSelectedEnglish(null);
      if (getSettings().autoPlayAudio) speakWord(word);
      return;
    }
    setWrongFlash({ german: selectedGerman, english: selectedEnglish });
    const timer = setTimeout(() => {
      setWrongFlash(null);
      setSelectedGerman(null);
      setSelectedEnglish(null);
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGerman, selectedEnglish]);

  const pickGerman = (id: string) => {
    if (correctIds.has(id) || wrongFlash) return;
    setSelectedGerman(id);
  };

  const pickEnglish = (text: string) => {
    if (wrongFlash) return;
    const alreadyCorrect = words.some(w => correctIds.has(w.id) && glossFor(w, nativeLanguage) === text);
    if (alreadyCorrect) return;
    setSelectedEnglish(text);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-4">
        <div className="text-sm font-medium text-indigo-600">Match each word to its meaning</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            {words.map(w => {
              const isCorrect = correctIds.has(w.id);
              const isSelected = selectedGerman === w.id;
              const isWrong = wrongFlash?.german === w.id;
              let cls = 'border-2 border-indigo-100 text-slate-700 hover:border-indigo-300';
              if (isCorrect) cls = 'border-2 border-green-400 bg-green-100 text-green-700';
              else if (isWrong) cls = 'border-2 border-red-400 bg-red-100 text-red-700';
              else if (isSelected) cls = 'border-2 border-indigo-500 bg-indigo-50 text-indigo-700';
              return (
                <button
                  key={w.id}
                  onClick={() => pickGerman(w.id)}
                  disabled={isCorrect || !!wrongFlash}
                  className={`px-3 py-2.5 rounded-xl font-mono font-semibold text-sm text-left transition-colors ${cls}`}
                >
                  {w.article ? `${w.article} ` : ''}{w.de}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2">
            {shuffledEn.map(text => {
              const isCorrect = words.some(w => correctIds.has(w.id) && glossFor(w, nativeLanguage) === text);
              const isSelected = selectedEnglish === text;
              const isWrong = wrongFlash?.english === text;
              let cls = 'border-2 border-indigo-100 text-slate-700 hover:border-indigo-300';
              if (isCorrect) cls = 'border-2 border-green-400 bg-green-100 text-green-700';
              else if (isWrong) cls = 'border-2 border-red-400 bg-red-100 text-red-700';
              else if (isSelected) cls = 'border-2 border-indigo-500 bg-indigo-50 text-indigo-700';
              return (
                <button
                  key={text}
                  onClick={() => pickEnglish(text)}
                  disabled={isCorrect || !!wrongFlash}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${cls}`}
                >
                  {text}
                </button>
              );
            })}
          </div>
        </div>
        {allCorrect && (
          <button
            onClick={onComplete}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}
