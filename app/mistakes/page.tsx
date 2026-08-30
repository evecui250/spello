'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { wordsForLevel, Word, glossFor } from '../../lib/words';
import {
  getAllProgress, getSettings, WordProgress,
  getAllCustomWordsForLevel, PROGRESS_CHANGED_EVENT,
} from '../../lib/storage';
import SpeakerButton from '../../components/SpeakerButton';
import MistakeRedoCard from '../../components/MistakeRedoCard';

// Falls back to lastPracticed (date-only) for a record saved before the
// `at` timestamp existed, so an old entry still sorts sensibly (as
// "oldest") instead of crashing or floating to a random position -- both
// an ISO datetime and a plain YYYY-MM-DD date string sort correctly
// against each other lexicographically, and a totally blank fallback
// sorts before both (oldest of all).
function sortKey(p: WordProgress | undefined, kind: 'mistake' | 'correct'): string {
  const at = kind === 'mistake' ? p?.lastMistake?.at : p?.exampleSentence?.at;
  return at ?? p?.lastPracticed ?? '';
}

export default function MistakesPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [customWords, setCustomWords] = useState<Word[]>([]);
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>('en');
  const [tab, setTab] = useState<'mistakes' | 'correct'>('mistakes');
  // Snapshotted once, at the moment "Redo" is tapped — see Word List's own
  // identical redoTarget for why (a successful redo clears lastMistake the
  // instant it saves, which would otherwise unmount the modal showing the
  // result before the learner ever sees it).
  const [redoTarget, setRedoTarget] = useState<{ word: Word; mistake: NonNullable<WordProgress['lastMistake']> } | null>(null);

  // Scoped to the current book only (not merged across every level) — per
  // feedback, this notebook should reflect whichever book the learner is
  // actually studying right now, same as the Home button that links here.
  const level = getSettings().level;

  useEffect(() => {
    setNativeLanguage(getSettings().nativeLanguage);
    setCustomWords(Object.values(getAllCustomWordsForLevel(level)));
    const load = () => setProgress(getAllProgress());
    load();
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const words = useMemo(
    () => [...wordsForLevel(level), ...customWords],
    [customWords, level],
  );

  const mistakeWords = useMemo(
    () => words
      .filter(w => !!progress[w.id]?.lastMistake)
      .sort((a, b) => sortKey(progress[b.id], 'mistake').localeCompare(sortKey(progress[a.id], 'mistake'))),
    [words, progress],
  );
  const perfectWords = useMemo(
    () => words
      .filter(w => !!progress[w.id]?.exampleSentence)
      .sort((a, b) => sortKey(progress[b.id], 'correct').localeCompare(sortKey(progress[a.id], 'correct'))),
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

  const activeWords = tab === 'mistakes' ? mistakeWords : perfectWords;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
        Mistake Notebook
      </h1>

      {/* Two panels, not two stacked sections — a word moves from Mistakes
          to Correct the instant a redo comes back perfect (see
          PROGRESS_CHANGED_EVENT above), so switching tabs is how a
          learner actually watches their own backlog shrink. */}
      <div className="flex gap-1 bg-black/20 rounded-full p-1 self-start">
        <button
          onClick={() => setTab('mistakes')}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${tab === 'mistakes' ? 'bg-amber-50 text-stone-800' : 'text-amber-100/70 hover:text-amber-50'}`}
        >
          Mistakes{mistakeWords.length > 0 && ` (${mistakeWords.length})`}
        </button>
        <button
          onClick={() => setTab('correct')}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${tab === 'correct' ? 'bg-amber-50 text-stone-800' : 'text-amber-100/70 hover:text-amber-50'}`}
        >
          Correct{perfectWords.length > 0 && ` (${perfectWords.length})`}
        </button>
      </div>

      {activeWords.length === 0 ? (
        <p className="text-emerald-100/70 text-sm">
          {tab === 'mistakes' ? 'Nothing to redo right now — nice work.' : "None yet — these fill in as you nail a word's sentence."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {activeWords.map(w => <WordRow key={w.id} w={w} />)}
        </div>
      )}

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
