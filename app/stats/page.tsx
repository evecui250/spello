'use client';

import { useEffect, useState } from 'react';
import { getAllProgress, MascotStageId } from '../../lib/storage';
import { WORDS } from '../../lib/words';
import DachshundMascot from '../../components/Mascot';

const STAGE_ORDER: MascotStageId[] = ['puppy', 'short', 'medium', 'long-crowned'];
const STAGE_COLORS: Record<MascotStageId, string> = {
  puppy: 'bg-slate-300',
  short: 'bg-yellow-400',
  medium: 'bg-amber-500',
  'long-crowned': 'bg-green-500',
};
const STAGE_LABEL: Record<MascotStageId, string> = {
  puppy: 'Learning',
  short: 'Familiar',
  medium: 'Strong',
  'long-crowned': 'Mastered',
};

export default function StatsPage() {
  const [stageCounts, setStageCounts] = useState<Record<MascotStageId, number>>({
    puppy: 0, short: 0, medium: 0, 'long-crowned': 0,
  });
  const [introducedCount, setIntroducedCount] = useState(0);

  useEffect(() => {
    const progress = getAllProgress();
    const counts: Record<MascotStageId, number> = { puppy: 0, short: 0, medium: 0, 'long-crowned': 0 };
    let introduced = 0;
    for (const w of WORDS) {
      const p = progress[w.id];
      // A word only earns its puppy the first time it clears round 5 —
      // still climbing the round 1-4 ladder doesn't count yet, even though
      // it already has a progress record.
      if (!p || p.studiedTimes === 0) continue;
      introduced++;
      counts[p.mascotStage] += 1;
    }
    setStageCounts(counts);
    setIntroducedCount(introduced);
  }, []);

  const bars = STAGE_ORDER.map(id => ({
    id,
    count: stageCounts[id],
    color: STAGE_COLORS[id],
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Statistics</h1>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5">
        <h2 className="font-semibold text-stone-800 mb-1">Mascot stage breakdown</h2>
        <p className="text-stone-500 text-sm mb-4">
          Each started word's dachshund grows as its spaced-repetition mastery score rises.
        </p>
        {introducedCount === 0 ? (
          <p className="text-stone-500 text-sm">Study a few words to start growing your first dachshund.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {bars.map(b => (
              <div key={b.id} className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-0.5 shrink-0 w-10">
                  <DachshundMascot stage={b.id} className="w-9 h-9" />
                  <span className="text-[10px] font-medium text-stone-500">{STAGE_LABEL[b.id]}</span>
                </div>
                <div className="flex-1">
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-3 rounded-full ${b.color} transition-all`}
                      style={{ width: `${(b.count / introducedCount) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-stone-500 text-sm w-10 text-right shrink-0">{b.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
