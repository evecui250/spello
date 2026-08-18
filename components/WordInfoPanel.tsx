'use client';

import { Word, glossFor } from '../lib/words';
import { getSettings } from '../lib/storage';
import SpeakerButton from './SpeakerButton';

// Shown when a learner clicks a word inside an AI-corrected sentence or
// the round-1 prompt sentence (see SentenceExercise in
// DailySessionFlow.tsx) — its German dictionary form, pronunciation,
// meaning, and which CEFR book it belongs to.
export default function WordInfoPanel({ word }: { word: Word }) {
  const settings = getSettings();

  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-indigo-800">
          {word.article ? `${word.article} ` : ''}{word.de}
          <SpeakerButton word={word} className="ml-1.5 align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-base" />
        </span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 rounded-full px-2 py-0.5">
          from {word.level.replace('_old', '')}
        </span>
      </div>
      <div className="text-stone-600 text-sm">{glossFor(word, settings.nativeLanguage)}</div>
    </div>
  );
}
