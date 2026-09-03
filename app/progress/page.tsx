'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { WORDS, wordsForLevel, glossFor, Level, LEVEL_ORDER, Word } from '../../lib/words';
import {
  getAllProgress, getAllProgressForLevel, getMergedProgressAcrossLevels,
  getSettings, getStreak, getTotalGoalDays, MascotStageId, WordProgress,
  getTheme, Theme, THEME_CHANGED_EVENT, getAllCustomWordsAcrossLevels,
} from '../../lib/storage';
import { allWordsForLevel } from '../../lib/practice';
import { SYNCED_EVENT } from '../../lib/sync';
import DachshundMascot from '../../components/Mascot';
import GoalDaysBadge from '../../components/GoalDaysBadge';
import ActivityCalendar from '../../components/ActivityCalendar';
import Leaderboard from '../../components/Leaderboard';
import { THEME_CONFIG } from '../../components/AppBackground';

// A fixed pixel cap for the tallest bar, not a percentage of some
// surrounding flex container's own height — reported as still clipping
// at the bottom even after the empty-stage sliver fix, and a percentage
// height inside nested flex columns (items-end + justify-end + h-full)
// is a known spot for mobile Safari/Chrome to disagree with desktop
// about what "100%" actually resolves to. A plain px value has no such
// ambiguity, on any browser.
const BAR_MAX_HEIGHT_PX = 84;
const STAGE_ORDER: MascotStageId[] = ['puppy', 'short', 'medium', 'long-crowned'];
// Colors now come from THEME_CONFIG[theme].stageColors (see AppBackground)
// — a muted, earthy 4-step progression per theme, e.g. Forest's original
// bronze->sage->moss->plum, re-hued to match whichever background is
// active instead of staying green-toned regardless of theme.
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
  // theoretically available level (C1/C2 have no words yet), so the total
  // never looks inflated by books nobody opened.
  const [studiedLevels, setStudiedLevels] = useState<Level[]>([]);
  // Which stage's breakdown popup is open — in "This book" scope this
  // shows the actual words in that stage; in "All books" scope (where
  // "which book did these come from" is the more useful question) it
  // shows a per-level count breakdown instead (see the popup itself).
  const [openStage, setOpenStage] = useState<MascotStageId | null>(null);
  const [theme, setTheme] = useState<Theme>('forest');

  useEffect(() => {
    const loadTheme = () => setTheme(getTheme());
    loadTheme();
    window.addEventListener(THEME_CHANGED_EVENT, loadTheme);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, loadTheme);
  }, []);

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
  // Only actually populated/used in "This book" scope (see the popup
  // below) — "All books" already has its own per-level count breakdown
  // above, which is what "which book are these from" actually needs;
  // listing every individual word across every book in one popup would
  // be a much longer, less scannable list for the one scope where it's
  // least likely to be what someone's after.
  const stageWords: Record<MascotStageId, Word[]> = {
    puppy: [], short: [], medium: [], 'long-crowned': [],
  };
  let introducedCount = 0;
  for (const w of [...WORDS, ...getAllCustomWordsAcrossLevels()]) {
    if (scope === 'current' && w.level !== level) continue;
    const p = effectiveProgress[w.id];
    if (!p || p.studiedTimes === 0) continue;
    introducedCount++;
    const stage = p.mascotStage ?? 'puppy';
    stageCounts[stage]++;
    if (scope === 'all') {
      stageLevelCounts[stage][w.level] = (stageLevelCounts[stage][w.level] ?? 0) + 1;
    } else {
      stageWords[stage].push(w);
    }
  }
  const bars = STAGE_ORDER.map((id, i) => ({ id, total: stageCounts[id], color: THEME_CONFIG[theme].stageColors[i] }));
  const maxStageCount = Math.max(...bars.map(b => b.total), 1);
  const totalWords = scope === 'all'
    ? activeLevels.reduce((sum, l) => sum + allWordsForLevel(l).length, 0)
    : allWordsForLevel(level).length;

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

      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="font-semibold text-ink">Words breakdown</h2>
          {studiedLevels.length > 1 && (
            <div className="flex bg-paper-dim/60 rounded-full p-0.5 text-xs font-medium shrink-0">
              {(['current', 'all'] as Scope[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setScope(s); setOpenStage(null); }}
                  className={`px-2.5 py-1 rounded-full transition-colors ${
                    scope === s ? 'bg-paper text-ink shadow-sm' : 'text-ink-soft'
                  }`}
                >
                  {s === 'current' ? 'This book' : 'All books'}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-ink-soft text-sm mb-1">
          {scope === 'all'
            ? `${totalWords} words total across ${activeLevels.length} vocabulary book${activeLevels.length === 1 ? '' : 's'}.`
            : `${totalWords} words total in this vocabulary book.`}
        </p>
        {introducedCount > 0 && (
          <p className="text-ink-soft text-xs mb-1">Tap a mascot below to see its words.</p>
        )}
        {bootstrapWords.length > 0 && (
          <p className="text-ink-soft text-sm mb-4">
            {bootstrapRemaining > 0
              ? `${bootstrapRemaining} more word${bootstrapRemaining === 1 ? '' : 's'} to unlock sentence translation.`
              : 'Sentence translation unlocked!'}
          </p>
        )}
        {introducedCount === 0 && (
          <p className="text-ink-soft text-sm mb-3">Study a few words to start growing your first dachshund.</p>
        )}
        {/* Each bar's height is relative to whichever stage currently has the
            most words, not to a fixed total — so distribution 2-4-4-8 and
            1-2-2-4 render identically. That means it never "fills up" and
            stays meaningful regardless of how many words are introduced. */}
        <div className="flex items-end justify-around gap-3">
          {bars.map(b => (
            <div key={b.id} className="flex flex-col items-center justify-end flex-1 gap-1">
              <span className="text-sm font-semibold text-ink">{b.total}</span>
              {/* A genuinely empty stage renders no bar at all. The real
                  cause of the reported "clipped at the bottom" look,
                  finally pinned down from an actual screenshot: a small
                  count next to a much larger one (e.g. 4 vs. a 50-word
                  max) was scaling down to ~7px tall — barely more than
                  this div's own rounded-t-md corner radius, so instead of
                  reading as a short bar it read as a squashed, bottom-less
                  blob. 18px keeps even the smallest nonzero stage clearly
                  bar-shaped (a real flat body under the rounded top)
                  regardless of the width ratio the other stages happen
                  to be scaled by, at the cost of "shortest bar" no longer
                  being perfectly proportional at extreme ratios — a
                  trade worth making since the whole point of this chart
                  is reading as a bar, not as an exact ruler.
              */}
              {b.total > 0 && <div
                className="w-full max-w-10 rounded-t-md overflow-hidden transition-all"
                style={{
                  height: `${Math.max(Math.round((b.total / maxStageCount) * BAR_MAX_HEIGHT_PX), 18)}px`,
                  backgroundColor: b.color,
                }}
              />}
            </div>
          ))}
        </div>
        <div className="flex justify-around gap-3 mt-3">
          {bars.map(b => {
            const clickable = b.total > 0;
            return (
              <button
                key={b.id}
                type="button"
                disabled={!clickable}
                onClick={() => setOpenStage(b.id)}
                className={`flex flex-col items-center gap-1 flex-1 rounded-lg py-1 transition-colors ${clickable ? 'hover:bg-paper-dim active:scale-95' : ''}`}
              >
                <DachshundMascot stage={b.id} className="w-10 h-10" />
                <span className="text-[10px] font-medium text-ink-soft">{STAGE_LABEL[b.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Leaderboard />

      <ActivityCalendar />

      {openStage && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenStage(null)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink flex items-center gap-2">
                <DachshundMascot stage={openStage} className="w-8 h-8" />
                {stageCounts[openStage]} {STAGE_LABEL[openStage]}
              </h2>
              <button
                type="button"
                onClick={() => setOpenStage(null)}
                aria-label="Close"
                className="text-ink-soft hover:text-ink text-xl leading-none"
              >
                ×
              </button>
            </div>
            {scope === 'all' ? (
              <div className="flex flex-col gap-1.5">
                {Object.entries(stageLevelCounts[openStage])
                  .sort((a, b) => LEVEL_ORDER.indexOf(a[0] as Level) - LEVEL_ORDER.indexOf(b[0] as Level))
                  .map(([lvl, count]) => (
                    <div key={lvl} className="flex items-center justify-between bg-paper/60 rounded-lg px-3 py-2">
                      <span className="text-ink font-medium">{lvl}</span>
                      <span className="text-ink-soft text-sm">{count} word{count === 1 ? '' : 's'}</span>
                    </div>
                  ))}
              </div>
            ) : (
              // "This book" — one level, so a per-level count wouldn't
              // say anything a single number on the bar above didn't
              // already — the actual words themselves are what's
              // actually useful to see here instead.
              <div className="flex flex-col gap-1.5">
                {[...stageWords[openStage]]
                  .sort((a, b) => a.de.localeCompare(b.de, 'de'))
                  .map(w => (
                    <div key={w.id} className="flex items-center justify-between bg-paper/60 rounded-lg px-3 py-2 gap-2">
                      <span className="text-ink font-medium truncate">
                        {w.article ? `${w.article} ` : ''}{w.de}
                      </span>
                      <span className="text-ink-soft text-sm text-right truncate">{glossFor(w, getSettings().nativeLanguage)}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
