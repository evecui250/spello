'use client';

import { useState } from 'react';
import { Word } from '../lib/words';

interface Props {
  words: Word[];
  onComplete: (wrongIds: string[]) => void;
}

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

// One page of the end-of-section matching quiz (≤5 words): click a German
// word, then click its English meaning to pair them. Every pair is locked
// in immediately (right or wrong, shown in place) — wrong ones are reported
// back to the caller, which feeds them into a redo page later.
export default function MatchingQuizPage({ words, onComplete }: Props) {
  const [shuffledEn] = useState(() => shuffled(words.map(w => w.en)));
  const [selectedGermanId, setSelectedGermanId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const usedEnglish = new Set(Object.values(assignments));

  const pickGerman = (id: string) => {
    if (assignments[id]) return;
    setSelectedGermanId(id);
  };

  const pickEnglish = (text: string) => {
    if (usedEnglish.has(text) || !selectedGermanId) return;
    setAssignments(a => ({ ...a, [selectedGermanId]: text }));
    setSelectedGermanId(null);
  };

  const allPaired = words.every(w => assignments[w.id]);

  const handleContinue = () => {
    const wrongIds = words.filter(w => assignments[w.id] !== w.en).map(w => w.id);
    onComplete(wrongIds);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl shadow-sm border border-amber-100/50 p-6 flex flex-col gap-4">
        <div className="text-sm font-medium text-indigo-600">Match each word to its meaning</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            {words.map(w => {
              const paired = assignments[w.id];
              const isSelected = selectedGermanId === w.id;
              let cls = 'border-2 border-indigo-100 text-slate-700 hover:border-indigo-300';
              if (paired) {
                cls = paired === w.en
                  ? 'border-2 border-green-400 bg-green-100 text-green-700'
                  : 'border-2 border-red-400 bg-red-100 text-red-700';
              } else if (isSelected) {
                cls = 'border-2 border-indigo-500 bg-indigo-50 text-indigo-700';
              }
              return (
                <button
                  key={w.id}
                  onClick={() => pickGerman(w.id)}
                  disabled={!!paired}
                  className={`px-3 py-2.5 rounded-xl font-mono font-semibold text-sm text-left transition-colors ${cls}`}
                >
                  {w.article ? `${w.article} ` : ''}{w.de}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2">
            {shuffledEn.map(text => {
              const used = usedEnglish.has(text);
              return (
                <button
                  key={text}
                  onClick={() => pickEnglish(text)}
                  disabled={used || !selectedGermanId}
                  className={`px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                    used
                      ? 'border-2 border-slate-200 bg-slate-50 text-slate-500 line-through decoration-slate-300'
                      : 'border-2 border-indigo-100 text-slate-700 hover:border-indigo-300'
                  }`}
                >
                  {text}
                </button>
              );
            })}
          </div>
        </div>
        {allPaired && (
          <button
            onClick={handleContinue}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}
