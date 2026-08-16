'use client';

import { useEffect, useState } from 'react';
import { WORDS, wordsForLevel, Level, LEVEL_ORDER } from '../../lib/words';
import {
  getAllProgress, getAllProgressForLevel, getSettings, getStreak, getTotalGoalDays, MascotStageId, WordProgress,
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
// A word saved via WordInfoPanel's "save for review" (see
// lib/practice.ts's saveWordForReviewFromOtherLevel) lives in THIS level's
// progress store but isn't native to this book — this is the app's
// existing interactive/accent color (buttons, links), reused here so the
// "borrowed" stacking segment reads as its own consistent, recognizable
// color rather than inventing a fifth palette entry. Only meaningful in
// "This book" scope — see the scope toggle below.
const FOREIGN_COLOR = '#4f46e5';

// Ranks how far along a word's own milestone track is, for merging the
// same word id across two different levels' progress stores (see "All
// books" below) — the more-advanced copy wins rather than picking
// arbitrarily or double-counting.
const STAGE_RANK: Record<MascotStageId, number> = { puppy: 0, short: 1, medium: 2, 'long-crowned': 3 };
function stageRank(p: WordProgress): number {
  return p.mascotStage ? STAGE_RANK[p.mascotStage] : -1;
}

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

  // "All books": merge every active level's own store into one map, keyed
  // by word id — a word saved cross-level via "save for review" can
  // appear in more than one store at once, so the more-advanced copy wins
  // rather than double-counting it or picking whichever happens to be
  // read last.
  let effectiveProgress = progress;
  if (scope === 'all') {
    const merged: Record<string, WordProgress> = {};
    for (const l of activeLevels) {
      const store = l === level ? progress : getAllProgressForLevel(l);
      for (const [id, p] of Object.entries(store)) {
        if (!merged[id] || stageRank(p) > stageRank(merged[id])) merged[id] = p;
      }
    }
    effectiveProgress = merged;
  }

  // Split per stage into words native to the book being counted vs. words
  // "borrowed" via save-for-review (see FOREIGN_COLOR above) — only a
  // meaningful distinction in "This book" scope; in "All books" scope
  // every word is already being counted under some book, so there's
  // nothing left to call "foreign".
  const stageCounts: Record<MascotStageId, { native: number; foreign: number }> = {
    puppy: { native: 0, foreign: 0 },
    short: { native: 0, foreign: 0 },
    medium: { native: 0, foreign: 0 },
    'long-crowned': { native: 0, foreign: 0 },
  };
  let introducedCount = 0;
  for (const w of WORDS) {
    const p = effectiveProgress[w.id];
    if (!p || p.studiedTimes === 0) continue;
    introducedCount++;
    const bucket = stageCounts[p.mascotStage ?? 'puppy'];
    if (scope === 'all' || w.level === level) bucket.native++;
    else bucket.foreign++;
  }
  const bars = STAGE_ORDER.map(id => {
    const { native, foreign } = stageCounts[id];
    return { id, native, foreign, total: native + foreign, color: STAGE_COLORS[id] };
  });
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
                  onClick={() => setScope(s)}
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
              {b.foreign > 0 && (
                <span className="text-[9px] font-medium text-indigo-600 -mt-1">
                  {b.foreign} from other levels
                </span>
              )}
              {/* Stacked two-tone column — native (this book) at the
                  bottom, "borrowed" words from another level's book on top
                  in FOREIGN_COLOR, so the two are visually distinguishable
                  at a glance instead of just blending into one count. */}
              <div
                className="w-full max-w-10 rounded-t-md overflow-hidden flex flex-col justify-end transition-all"
                style={{ height: `${b.total > 0 ? Math.max((b.total / maxStageCount) * 100, 6) : 2}%` }}
              >
                {b.foreign > 0 && (
                  <div style={{ height: `${(b.foreign / b.total) * 100}%`, backgroundColor: FOREIGN_COLOR }} />
                )}
                <div style={{ height: `${b.total > 0 ? (b.native / b.total) * 100 : 100}%`, backgroundColor: b.color }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-around gap-3 mt-2">
          {bars.map(b => (
            <div key={b.id} className="flex flex-col items-center gap-1 flex-1">
              <DachshundMascot stage={b.id} className="w-10 h-10" />
              <span className="text-[10px] font-medium text-stone-500">{STAGE_LABEL[b.id]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
