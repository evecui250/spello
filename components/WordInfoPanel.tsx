'use client';

import { useState } from 'react';
import { Word } from '../lib/words';
import { getSettings, getWordProgress } from '../lib/storage';
import { saveWordForReviewFromOtherLevel } from '../lib/practice';
import { scheduleSync } from '../lib/sync';
import SpeakerButton from './SpeakerButton';

// Shown when a learner clicks a word inside an AI-corrected sentence (see
// SentenceExercise in DailySessionFlow.tsx) — meaning, which CEFR book it
// belongs to, and — only for a word from a level OTHER than the one being
// studied right now — a "save for review" action. Saving folds it into
// the CURRENT level's own review rotation via saveWordForReviewFromOtherLevel,
// exactly as if it had just been introduced and passed its first
// milestone here (see that function's own comment for why).
export default function WordInfoPanel({ word }: { word: Word }) {
  const settings = getSettings();
  const isNative = word.level === settings.level;
  const [saved, setSaved] = useState(() => !!getWordProgress(word.id).mascotStage);

  const handleSave = () => {
    if (saveWordForReviewFromOtherLevel(word)) {
      setSaved(true);
      scheduleSync();
    }
  };

  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-lg font-bold text-indigo-800">
          {word.article ? `${word.article} ` : ''}{word.de}
          <SpeakerButton word={word} className="ml-1.5 align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-base" />
        </span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 rounded-full px-2 py-0.5">
          from {word.level.replace('_old', '')}
        </span>
      </div>
      <div className="text-stone-600 text-sm">{word.en}</div>
      {!isNative && (
        saved ? (
          <p className="text-emerald-700 text-xs font-medium mt-1">✓ Saved — first review tomorrow</p>
        ) : (
          <button
            onClick={handleSave}
            className="mt-1 self-start bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Save for review
          </button>
        )
      )}
    </div>
  );
}
