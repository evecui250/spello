'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { WORDS, wordsForLevel, Level, LEVEL_ORDER } from '../../lib/words';
import {
  getAllProgress, getAllProgressForLevel, getMergedProgressAcrossLevels,
  getSettings, getStreak, getTotalGoalDays, MascotStageId, WordProgress,
} from '../../lib/storage';
import { SYNCED_EVENT } from '../../lib/sync';
import DachshundMascot from '../../components/Mascot';
import GoalDaysBadge from '../../components/GoalDaysBadge';

const STAGE_ORDER: MascotStageId[] = ['puppy', 'short', 'medium', 'long-crowned'];
// A muted, earthy progression (soft bronze -> sage -> moss -> deep plum) —
// reads as premium against the cream panel instead of the primary-color
// bg-sky/yellow/amber/green Tailwind swatches, which felt garish here.
const STAGE_COLORS: Record<MascotStageId, string> = {
  puppy: '#c9a86a',
  short: '#a3b18a',
  medium: '#588157',
  'long-crowned': '#5b3a5e',
};
// "Introduced" rather than "Learning" here — the Word List's own Learning
// filter now means something broader (earned at least one badge, any of the
// 4 stages including Mastered), so reusing the same word for just the
// puppy-stage bar would mean two different things in two places.
const STAGE_LABEL: Record<MascotStageId, string> = {
  puppy: 'Introduced',
  short: 'Familiar',
  medium: 'Strong',
  'long-crowned': 'Mastered',
};

type Scope = 'current' | 'all';

export default function ProgressPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress> | null>(null);
  const [totalGoalDays, setTotalGoalDays] = useState(0);
  const [streakCount, setStreakCount] = useState(0);
  const [scope, setScope] = useState<Scope>('current');
  // Which levels actually have any progress at all — "All books" only
  // ever aggregates books the learner has genuinely touched, not every
  // theoretically available level (C1/C2 have no words yet; B2_old is a
  // legacy corpus most accounts never touch), so the total never looks
  // inflated by books nobody opened.
  const [studiedLevels, setStudiedLevels] = useState<Level[]>([]);
  // Which stage's breakdown popup is open (only reachable in "All books"
  // scope, where "which book did these come from" is actually meaningful).
  const [openStage, setOpenStage] = useState<MascotStageId | null>(null);

  useEffect(() => {
    // Also re-reads on SYNCED_EVENT (matches Home's pattern) — otherwise a
    // signed-in pull-and-merge that finishes after this page has already
    // mounted (e.g. a fresh load that lands here first, before Home) would
    // leave these counts stuck at whatever local storage had before the
    // pull, until the next manual reload.
    const load = () => {
      setProgress(getAllProgress());
      setTotalGoalDays(getTotalGoalDays());
      setStreakCount(getStreak().count);
      setStudiedLevels(LEVEL_ORDER.filter(l => Object.keys(getAllProgressForLevel(l)).length > 0));
    };
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => window.removeEventListener(SYNCED_EVENT, load);
  }, []);

  if (!progress) return null;

  const level = getSettings().level;
  const activeLevels = scope === 'all' ? [...new Set([level, ...studiedLevels])] : [level];
  // Same merge Word List's "All books" filter now uses (see
  // getMergedProgressAcrossLevels) — keeping both on the shared helper is
  // what guarantees they agree with each other instead of one under-
  // reporting relative to the other.
  const effectiveProgress = scope === 'all' ? getMergedProgressAcrossLevels() : progress;

  // "This book" only ever counts words native to the book being viewed;
  // "All books" counts every word, attributed to its own book below.
  const stageCounts: Record<MascotStageId, number> = {
    puppy: 0, short: 0, medium: 0, 'long-crowned': 0,
  };
  const stageLevelCounts: Record<MascotStageId, Partial<Record<Level, number>>> = {
    puppy: {}, short: {}, medium: {}, 'long-crowned': {},
  };
  let introducedCount = 0;
  for (const w of WORDS) {
    if (scope === 'current' && w.level !== level) continue;
    const p = effectiveProgress[w.id];
    if (!p || p.studiedTimes === 0) continue;
    introducedCount++;
    const stage = p.mascotStage ?? 'puppy';
    stageCounts[stage]++;
    if (scope === 'all') {
      // B2_old is a legacy parallel corpus for the same nominal level as
      // B2 (see lib/words.ts), not a book a learner ever picks — fold it
      // into the same "B2" bucket rather than showing it as a second,
      // duplicate-looking "B2" row.
      const displayLevel = w.level === 'B2_old' ? 'B2' : w.level;
      stageLevelCounts[stage][displayLevel] = (stageLevelCounts[stage][displayLevel] ?? 0) + 1;
    }
  }
  const bars = STAGE_ORDER.map(id => ({ id, total: stageCounts[id], color: STAGE_COLORS[id] }));
  const maxStageCount = Math.max(...bars.map(b => b.total), 1);
  const totalWords = scope === 'all'
    ? activeLevels.reduce((sum, l) => sum + wordsForLevel(l).length, 0)
    : wordsForLevel(level).length;

  // A1 only: the ~220 curated high-frequency words always come first and
  // use the copy-the-word round 1 (see isBootstrapCopyWord) — sentence
  // translation only starts once every one of them has at least been
  // started (buildStudyWords stops prioritizing them the moment none are
  // left untouched, whether or not they're fully learned yet). Tied to
  // whichever level is actually active right now, regardless of the scope
  // toggle below — it's about today's study session, not a retrospective
  // stat.
  const bootstrapWords = level === 'A1' ? wordsForLevel('A1').filter(w => w.highFrequency) : [];
  const bootstrapRemaining = bootstrapWords.filter(w => !progress[w.id]).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center gap-6">
        <GoalDaysBadge variant="goal" count={totalGoalDays} size={112} label="goal days" />
        <GoalDaysBadge variant="streak" count={streakCount} size={112} label="day streak" />
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="font-semibold text-stone-800">Words breakdown</h2>
          {studiedLevels.length > 1 && (
            <div className="flex bg-stone-200/60 rounded-full p-0.5 text-xs font-medium shrink-0">
              {(['current', 'all'] as Scope[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setScope(s); setOpenStage(null); }}
                  className={`px-2.5 py-1 rounded-full transition-colors ${
                    scope === s ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'
                  }`}
                >
                  {s === 'current' ? 'This book' : 'All books'}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-stone-500 text-sm mb-1">
          {scope === 'all'
            ? `${totalWords} words total across ${activeLevels.length} vocabulary book${activeLevels.length === 1 ? '' : 's'}.`
            : `${totalWords} words total in this vocabulary book.`}
        </p>
        {bootstrapWords.length > 0 && (
          <p className="text-stone-500 text-sm mb-4">
            {bootstrapRemaining > 0
              ? `${bootstrapRemaining} more word${bootstrapRemaining === 1 ? '' : 's'} to unlock sentence translation.`
              : 'Sentence translation unlocked!'}
          </p>
        )}
        {introducedCount === 0 && (
          <p className="text-stone-500 text-sm mb-3">Study a few words to start growing your first dachshund.</p>
        )}
        {/* Each bar's height is relative to whichever stage currently has the
            most words, not to a fixed total — so distribution 2-4-4-8 and
            1-2-2-4 render identically. That means it never "fills up" and
            stays meaningful regardless of how many words are introduced. */}
        <div className="flex items-end justify-around gap-3 h-28">
          {bars.map(b => (
            <div key={b.id} className="flex flex-col items-center justify-end h-full flex-1 gap-1">
              <span className="text-sm font-semibold text-stone-700">{b.total}</span>
              <div
                className="w-full max-w-10 rounded-t-md overflow-hidden transition-all"
                style={{
                  height: `${b.total > 0 ? Math.max((b.total / maxStageCount) * 100, 6) : 2}%`,
                  backgroundColor: b.color,
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-around gap-3 mt-2">
          {bars.map(b => {
            const clickable = scope === 'all' && b.total > 0;
            return (
              <button
                key={b.id}
                type="button"
                disabled={!clickable}
                onClick={() => setOpenStage(b.id)}
                className={`flex flex-col items-center gap-1 flex-1 rounded-lg py-1 transition-colors ${clickable ? 'hover:bg-stone-100 active:scale-95' : ''}`}
              >
                <DachshundMascot stage={b.id} className="w-10 h-10" />
                <span className="text-[10px] font-medium text-stone-500">{STAGE_LABEL[b.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Straight to the Word List, pre-filtered to exactly what someone
          looking at this card would want next: this book, words actually
          introduced so far, no date restriction — so they can see the
          actual words behind these counts instead of just the totals.
          'B2_old' links out as plain 'B2' — that suffix is internal only,
          and B2_old isn't a selectable book on the Word List's own filter
          (see BOOK_LEVELS there). */}
      <Link
        href={`/words/?level=${level === 'B2_old' ? 'B2' : level}&familiarity=learning&date=all`}
        className="text-center bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm py-3 px-4 font-semibold hover:bg-amber-50 active:scale-[0.99] transition-all"
        style={{ color: '#2f4a2c' }}
      >
        View word list →
      </Link>

      {openStage && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenStage(null)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-amber-50 rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-stone-800 flex items-center gap-2">
                <DachshundMascot stage={openStage} className="w-8 h-8" />
                {stageCounts[openStage]} {STAGE_LABEL[openStage]}
              </h2>
              <button
                type="button"
                onClick={() => setOpenStage(null)}
                aria-label="Close"
                className="text-stone-400 hover:text-stone-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {Object.entries(stageLevelCounts[openStage])
                .sort((a, b) => LEVEL_ORDER.indexOf(a[0] as Level) - LEVEL_ORDER.indexOf(b[0] as Level))
                .map(([lvl, count]) => (
                  <div key={lvl} className="flex items-center justify-between bg-white/60 rounded-lg px-3 py-2">
                    <span className="text-stone-700 font-medium">{lvl}</span>
                    <span className="text-stone-500 text-sm">{count} word{count === 1 ? '' : 's'}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
