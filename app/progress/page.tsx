'use client';

import { useEffect, useState } from 'react';
import { WORDS, wordsForLevel } from '../../lib/words';
import {
  getAllProgress, getSettings, getStreak, getTotalGoalDays, MascotStageId, WordProgress,
} from '../../lib/storage';
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
const STAGE_LABEL: Record<MascotStageId, string> = {
  puppy: 'Learning',
  short: 'Familiar',
  medium: 'Strong',
  'long-crowned': 'Mastered',
};

export default function ProgressPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress> | null>(null);
  const [totalGoalDays, setTotalGoalDays] = useState(0);
  const [streakCount, setStreakCount] = useState(0);

  useEffect(() => {
    setProgress(getAllProgress());
    setTotalGoalDays(getTotalGoalDays());
    setStreakCount(getStreak().count);
  }, []);

  if (!progress) return null;

  const stageCounts: Record<MascotStageId, number> = { puppy: 0, short: 0, medium: 0, 'long-crowned': 0 };
  let introducedCount = 0;
  for (const w of WORDS) {
    const p = progress[w.id];
    if (!p || p.studiedTimes === 0) continue;
    introducedCount++;
    stageCounts[p.mascotStage] += 1;
  }
  const bars = STAGE_ORDER.map(id => ({ id, count: stageCounts[id], color: STAGE_COLORS[id] }));
  const maxStageCount = Math.max(...bars.map(b => b.count), 1);
  const totalWords = wordsForLevel(getSettings().level).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center gap-6">
        <GoalDaysBadge variant="goal" count={totalGoalDays} size={112} label="goal days" />
        <GoalDaysBadge variant="streak" count={streakCount} size={112} label="day streak" />
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5">
        <h2 className="font-semibold text-stone-800">Words breakdown</h2>
        <p className="text-stone-500 text-sm mb-4">{totalWords} words total in this vocabulary book.</p>
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
              <span className="text-sm font-semibold text-stone-700">{b.count}</span>
              <div
                className="w-full max-w-10 rounded-t-md transition-all"
                style={{
                  height: `${b.count > 0 ? Math.max((b.count / maxStageCount) * 100, 6) : 2}%`,
                  backgroundColor: b.color,
                }}
              />
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
