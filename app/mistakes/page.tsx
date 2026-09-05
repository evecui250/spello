'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { wordsForLevel, Word, glossFor } from '../../lib/words';
import {
  getAllProgress, getMergedProgressAcrossLevels, getSettings, WordProgress,
  getAllCustomWordsForLevel, PROGRESS_CHANGED_EVENT,
} from '../../lib/storage';
import { articleCandidateWords } from '../../lib/practice';
import SpeakerButton from '../../components/SpeakerButton';
import MistakeRedoCard from '../../components/MistakeRedoCard';
import ArtikelBlitzGame from '../../components/ArtikelBlitzGame';

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
  // Article mistakes span every level (same corpus-wide scope as
  // Artikel Blitz's own word pool -- see lib/practice.ts's
  // articleCandidateWords), unlike the Sentences tab below, which stays
  // scoped to the current book on purpose (per earlier feedback).
  const [mergedProgress, setMergedProgress] = useState<Record<string, WordProgress>>({});
  const [customWords, setCustomWords] = useState<Word[]>([]);
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>('en');
  const [topTab, setTopTab] = useState<'sentences' | 'articles'>('sentences');
  const [tab, setTab] = useState<'mistakes' | 'correct'>('mistakes');
  const [practiceOpen, setPracticeOpen] = useState(false);
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
    const load = () => {
      setProgress(getAllProgress());
      setMergedProgress(getMergedProgressAcrossLevels());
    };
    load();
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const articleMistakeWords = useMemo(
    () => articleCandidateWords()
      .filter(w => !!mergedProgress[w.id]?.articleMistake)
      .sort((a, b) => (mergedProgress[b.id]?.articleMistake?.at ?? '').localeCompare(mergedProgress[a.id]?.articleMistake?.at ?? '')),
    [mergedProgress],
  );

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
      <div className="bg-paper/75 backdrop-blur-sm rounded-xl border border-paper-line/50 shadow-sm px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-ink">
            {w.article ? `${w.article} ` : ''}{w.de}
          </span>
          <SpeakerButton word={w} className="text-label hover:text-ink transition-colors align-middle" />
          <span className="text-ink-soft text-sm">{glossFor(w, nativeLanguage)}</span>
        </div>
        {sentence && (
          <div className="mt-1 flex flex-col gap-0.5">
            {sentence.englishPrompt && (
              <div className="text-ink-soft text-xs">
                {nativeLanguage === 'zh' ? (sentence.englishPromptZh ?? w.exercisePromptZh ?? sentence.englishPrompt) : sentence.englishPrompt}
              </div>
            )}
            <div className="text-ink-soft text-sm italic">{sentence.sentence}</div>
          </div>
        )}
        {mistake && (
          <button
            onClick={() => setRedoTarget({ word: w, mistake })}
            className="mt-2 text-xs font-semibold text-label bg-paper-dim rounded-full px-2.5 py-1 hover:bg-gold transition-colors"
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
      <h1 className="text-2xl font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
        Mistake Notebook
      </h1>

      {/* Sentences (today's exact Mistakes/Correct system, untouched) vs.
          Articles (new -- shares WordProgress's articleMistake fields
          with Artikel Blitz, see lib/practice.ts). */}
      <div className="flex gap-1 bg-black/20 rounded-full p-1 self-start">
        <button
          onClick={() => setTopTab('sentences')}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${topTab === 'sentences' ? 'bg-paper text-ink' : 'text-on-bg/70 hover:text-on-bg'}`}
        >
          Sentences
        </button>
        <button
          onClick={() => setTopTab('articles')}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${topTab === 'articles' ? 'bg-paper text-ink' : 'text-on-bg/70 hover:text-on-bg'}`}
        >
          Articles{articleMistakeWords.length > 0 && ` (${articleMistakeWords.length})`}
        </button>
      </div>

      {topTab === 'sentences' && (
        <>
          {/* Two panels, not two stacked sections — a word moves from
              Mistakes to Correct the instant a redo comes back perfect
              (see PROGRESS_CHANGED_EVENT above), so switching tabs is how
              a learner actually watches their own backlog shrink. */}
          <div className="flex gap-1 bg-black/10 rounded-full p-1 self-start">
            <button
              onClick={() => setTab('mistakes')}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${tab === 'mistakes' ? 'bg-paper text-ink' : 'text-on-bg/70 hover:text-on-bg'}`}
            >
              Mistakes{mistakeWords.length > 0 && ` (${mistakeWords.length})`}
            </button>
            <button
              onClick={() => setTab('correct')}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${tab === 'correct' ? 'bg-paper text-ink' : 'text-on-bg/70 hover:text-on-bg'}`}
            >
              Correct{perfectWords.length > 0 && ` (${perfectWords.length})`}
            </button>
          </div>

          {activeWords.length === 0 ? (
            <p className="text-on-bg/70 text-sm">
              {tab === 'mistakes' ? 'Nothing to redo right now — nice work.' : "None yet — these fill in as you nail a word's sentence."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {activeWords.map(w => <WordRow key={w.id} w={w} />)}
            </div>
          )}
        </>
      )}

      {topTab === 'articles' && (
        <>
          {articleMistakeWords.length > 0 && (
            <button
              type="button"
              onClick={() => setPracticeOpen(true)}
              className="self-start text-white rounded-full px-4 py-2 font-semibold text-sm shadow-md active:scale-95 transition-all"
              style={{ backgroundImage: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)' }}
            >
              Practice Articles
            </button>
          )}
          {articleMistakeWords.length === 0 ? (
            <p className="text-on-bg/70 text-sm">Nothing to redo right now — nice work.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {articleMistakeWords.map(w => {
                const p = mergedProgress[w.id];
                const streak = p?.articleRecallStreak ?? 0;
                return (
                  <div key={w.id} className="bg-paper/75 backdrop-blur-sm rounded-xl border border-paper-line/50 shadow-sm px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-paper-dim text-ink-soft font-mono font-bold text-xs">?</span>
                        <span className="font-semibold text-ink">{w.de}</span>
                        <SpeakerButton word={w} className="text-label hover:text-ink transition-colors align-middle" />
                      </div>
                      <div className="flex items-center gap-1">
                        {[0, 1].map(i => (
                          <span key={i} className={`w-2 h-2 rounded-full ${i < streak ? 'bg-good-deep' : 'bg-paper-dim border border-ink-soft/30'}`} />
                        ))}
                      </div>
                    </div>
                    <div className="text-ink-soft text-sm mt-1">{glossFor(w, nativeLanguage)}</div>
                    <div className="text-ink-soft text-xs mt-1">{streak} of 2 correct recalls to clear</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
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

      {practiceOpen && createPortal(
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto p-4">
          <div className="max-w-sm mx-auto py-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Practice Articles</h2>
              <button
                type="button"
                onClick={() => setPracticeOpen(false)}
                aria-label="Close"
                className="text-on-bg/80 hover:text-on-bg text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <ArtikelBlitzGame mode="practice" onQuit={() => setPracticeOpen(false)} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
