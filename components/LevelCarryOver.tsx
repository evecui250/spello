'use client';

import { createPortal } from 'react-dom';
import { CefrLevel, LEVEL_ORDER, isCefrLevel, Level, wordsForLevel } from '../lib/words';
import {
  getSettings, saveSettings, getAllProgressForLevel, lowerLevelsWithPendingReviews,
  setCarriedReviewLevels, moveUpToLevel,
} from '../lib/storage';
import { allWordsForLevel } from '../lib/practice';
import { syncNow } from '../lib/sync';

// Moving up a level without dropping the old one's reviews — see
// storage.ts's carriedReviewLevels for how carried words are stored.

// "Almost done with A1" shows once this many (or fewer) of the level's
// words are still waiting to be introduced.
const NEXT_LEVEL_CARD_THRESHOLD = 20;
// A Spello book exists for these levels (see storage.ts's SELECTABLE_CEFR).
const LAST_MOVABLE_LEVEL: CefrLevel = 'B2';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const joinLevels = (levels: string[]) =>
  levels.length <= 1 ? levels.join('') : `${levels.slice(0, -1).join(', ')} and ${levels[levels.length - 1]}`;

// Home's one-time question for a learner already on a higher level while
// a lower one still has unfinished reviews (e.g. finished A1, now on A2).
export function carryPromptLevels(): { level: CefrLevel; count: number }[] {
  if (getSettings().carryReviewsAsked) return [];
  return lowerLevelsWithPendingReviews();
}

export function CarryReviewsPrompt({ levels, onDone }: { levels: { level: CefrLevel; count: number }[]; onDone: () => void }) {
  const active = getSettings().level;
  const names = joinLevels(levels.map(l => l.level));
  const total = levels.reduce((sum, l) => sum + l.count, 0);
  const answer = (yes: boolean) => {
    setCarriedReviewLevels(yes ? levels.map(l => l.level) : []);
    syncNow();
    onDone();
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-sm bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3 text-center">
        <h2 className="font-bold text-ink text-lg">Keep reviewing {names}?</h2>
        <p className="text-ink-soft text-sm">
          You still have {plural(total, `${names} word`)} on the way to Mastered. Want them in your daily reviews here
          in {active}, alongside your new {active} words, until they&apos;re all mastered?
        </p>
        <p className="text-ink-soft text-xs">Your {active} stats stay separate. You can change this in Profile → My books.</p>
        <div className="flex flex-col gap-2 mt-1">
          <button
            type="button"
            onClick={() => answer(true)}
            className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
          >
            Yes, review them here
          </button>
          <button
            type="button"
            onClick={() => answer(false)}
            className="w-full py-2.5 rounded-xl font-semibold text-ink-soft hover:text-ink transition-colors"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The level after `level`, if Spello has a book for it.
function nextLevelAfter(level: Level): CefrLevel | null {
  if (!isCefrLevel(level) || level === LAST_MOVABLE_LEVEL) return null;
  const next = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) + 1];
  return next && wordsForLevel(next).length > 0 ? next : null;
}

// What Home's "ready for A2?" card needs, or null when it shouldn't show.
export function nextLevelSuggestion(): { from: CefrLevel; next: CefrLevel; wordsLeft: number } | null {
  const s = getSettings();
  const next = nextLevelAfter(s.level);
  if (!next || s.nextLevelCardDismissed || !isCefrLevel(s.level)) return null;
  const progress = getAllProgressForLevel(s.level);
  const wordsLeft = allWordsForLevel(s.level).filter(w => !progress[w.id]?.mascotStage).length;
  return wordsLeft <= NEXT_LEVEL_CARD_THRESHOLD ? { from: s.level, next, wordsLeft } : null;
}

export function NextLevelCard({ from, next, wordsLeft, onChange }: { from: CefrLevel; next: CefrLevel; wordsLeft: number; onChange: () => void }) {
  const start = () => {
    moveUpToLevel(from, next);
    syncNow();
    onChange();
  };
  const dismiss = () => {
    saveSettings({ ...getSettings(), nextLevelCardDismissed: true });
    syncNow();
    onChange();
  };
  return (
    <div className="w-full rounded-2xl bg-black/15 border border-on-bg/20 px-4 py-3.5 flex flex-col gap-3">
      <div>
        <div className="font-semibold text-sm text-on-bg">
          {wordsLeft === 0 ? `You've met every ${from} word!` : `Almost through ${from}: ${plural(wordsLeft, 'new word')} left`}
        </div>
        <div className="text-xs text-on-bg/70">Ready to start {next}? Your {from} reviews come with you until they&apos;re mastered.</div>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={start} className="rounded-full bg-paper text-ink text-sm font-bold px-3.5 py-1.5">
          Start {next}
        </button>
        <button type="button" onClick={dismiss} className="rounded-full text-on-bg/75 text-sm font-semibold px-3 py-1.5 hover:text-on-bg">
          Not now
        </button>
      </div>
    </div>
  );
}
