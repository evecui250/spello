'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { WORDS, Word, Level, glossFor } from '../../lib/words';
import {
  getMergedProgressAcrossLevels, getSettings, WordProgress,
  getAllCustomWordsAcrossLevels, PROGRESS_CHANGED_EVENT,
} from '../../lib/storage';
import SpeakerButton from '../../components/SpeakerButton';
import MistakeRedoCard from '../../components/MistakeRedoCard';

// Same "curated corpus + learner-added words, across every book" pool
// Word List's own "All books" view builds — a mistake or a perfect
// sentence can come from any level, so this notebook was never going to
// be scoped to just one.
const BOOK_LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2'];

export default function MistakesPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [customWords, setCustomWords] = useState<Word[]>([]);
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>('en');
  // Snapshotted once, at the moment "Redo" is tapped — see Word List's own
  // identical redoTarget for why (a successful redo clears lastMistake the
  // instant it saves, which would otherwise unmount the modal showing the
  // result before the learner ever sees it).
  const [redoTarget, setRedoTarget] = useState<{ word: Word; mistake: NonNullable<WordProgress['lastMistake']> } | null>(null);

  useEffect(() => {
    setNativeLanguage(getSettings().nativeLanguage);
    setCustomWords(getAllCustomWordsAcrossLevels());
    const load = () => setProgress(getMergedProgressAcrossLevels());
    load();
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
  }, []);

  const words = useMemo(
    () => [...WORDS.filter(w => (BOOK_LEVELS as string[]).includes(w.level)), ...customWords],
    [customWords],
  );

  const mistakeWords = useMemo(
    () => words
      .filter(w => !!progress[w.id]?.lastMistake)
      .sort((a, b) => a.de.localeCompare(b.de, 'de')),
    [words, progress],
  );
  const perfectWords = useMemo(
    () => words
      .filter(w => !!progress[w.id]?.exampleSentence)
      .sort((a, b) => a.de.localeCompare(b.de, 'de')),
    [words, progress],
  );

  function WordRow({ w }: { w: Word }) {
    const p = progress[w.id];
    const sentence = p?.exampleSentence;
    const mistake = p?.lastMistake;
    return (
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-stone-800">
            {w.article ? `${w.article} ` : ''}{w.de}
          </span>
          <SpeakerButton word={w} className="text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 rounded-full px-2 py-0.5">
            {w.level}
          </span>
          <span className="text-stone-500 text-sm">{glossFor(w, nativeLanguage)}</span>
        </div>
        {sentence && (
          <div className="mt-1 flex flex-col gap-0.5">
            {sentence.englishPrompt && (
              <div className="text-stone-400 text-xs">
                {nativeLanguage === 'zh' ? (sentence.englishPromptZh ?? w.exercisePromptZh ?? sentence.englishPrompt) : sentence.englishPrompt}
              </div>
            )}
            <div className="text-stone-500 text-sm italic">{sentence.sentence}</div>
          </div>
        )}
        {mistake && (
          <button
            onClick={() => setRedoTarget({ word: w, mistake })}
            className="mt-2 text-xs font-semibold text-amber-700 bg-amber-100 rounded-full px-2.5 py-1 hover:bg-amber-200 transition-colors"
          >
            ✎ Redo this sentence
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-4">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
        Mistake Notebook
      </h1>

      <div className="flex flex-col gap-2">
        <h2 className="text-amber-100 font-semibold text-sm uppercase tracking-wide">
          Mistake sentences {mistakeWords.length > 0 && `(${mistakeWords.length})`}
        </h2>
        {mistakeWords.length === 0 ? (
          <p className="text-emerald-100/70 text-sm">Nothing to redo right now — nice work.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {mistakeWords.map(w => <WordRow key={w.id} w={w} />)}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-amber-100 font-semibold text-sm uppercase tracking-wide">
          Perfect sentences {perfectWords.length > 0 && `(${perfectWords.length})`}
        </h2>
        {perfectWords.length === 0 ? (
          <p className="text-emerald-100/70 text-sm">None yet — these fill in as you nail a word's sentence on the first try.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {perfectWords.map(w => <WordRow key={w.id} w={w} />)}
          </div>
        )}
      </div>

      {redoTarget && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setRedoTarget(null)}
        >
          <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <MistakeRedoCard
              word={redoTarget.word}
              mistake={redoTarget.mistake}
              level={redoTarget.word.level}
              onDone={() => setRedoTarget(null)}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
