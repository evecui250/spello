'use client';

import { Word, glossFor } from '../lib/words';
import { getSettings, isCustomWordId } from '../lib/storage';
import SpeakerButton from './SpeakerButton';

interface Props {
  word: Word;
  // The exact inflected/conjugated form actually clicked, when it differs
  // from the dictionary form (word.de) -- e.g. a paragraph blank's answer
  // ("abgeholt") or a corrected sentence's own inflection. Undefined at
  // the existing call sites (SentenceExercise's prompt/correction words),
  // which have always shown the bare dictionary form only; only the bonus
  // paragraph exercise passes this so far.
  usedForm?: string;
}

// Shown when a learner clicks a word inside an AI-corrected sentence, the
// round-1 prompt sentence (see SentenceExercise in DailySessionFlow.tsx),
// or the bonus paragraph exercise (see ParagraphExerciseCard) — its German
// dictionary form, pronunciation, meaning, which CEFR book it belongs to,
// and (when available) its plural or other conjugated forms.
export default function WordInfoPanel({ word, usedForm }: Props) {
  const settings = getSettings();

  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-indigo-800">
          {word.article ? `${word.article} ` : ''}{word.de}
          <SpeakerButton word={word} className="ml-1.5 align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-base" />
        </span>
        {/* A custom (AI-looked-up) word isn't actually FROM the curated
            book it's filed under -- "from B2" there would misleadingly
            claim it's part of the official B2 corpus, which is exactly
            what a real report caught. isCustomWordId also covers the Word
            List's own lookup PREVIEW (see app/words/page.tsx), which is
            given a real "custom-" id before it's ever actually saved, for
            precisely this reason. */}
        <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${isCustomWordId(word.id) ? 'text-indigo-600 bg-indigo-100' : 'text-stone-500 bg-stone-100'}`}>
          {isCustomWordId(word.id) ? 'My word' : `from ${word.level.replace('_old', '')}`}
        </span>
      </div>
      <div className="text-stone-600 text-sm">{glossFor(word, settings.nativeLanguage)}</div>
      {usedForm && usedForm !== word.de && (
        <div className="text-xs text-stone-500">
          Used here as <span className="font-semibold text-stone-700">{usedForm}</span>
        </div>
      )}
      {word.type === 'noun' && word.plural && (
        <div className="text-xs text-stone-500">
          Plural: <span className="font-semibold text-stone-700">die {word.plural}</span>
        </div>
      )}
      {word.type === 'verb' && (word.thirdPerson || word.pastTense || word.perfectTense) && (
        <div className="text-xs text-stone-500 flex flex-col gap-0.5">
          {word.thirdPerson && <div>er/sie/es: <span className="font-semibold text-stone-700">{word.thirdPerson}</span></div>}
          {word.pastTense && <div>simple past: <span className="font-semibold text-stone-700">{word.pastTense}</span></div>}
          {word.perfectTense && <div>perfect: <span className="font-semibold text-stone-700">{word.perfectTense}</span></div>}
        </div>
      )}
    </div>
  );
}
