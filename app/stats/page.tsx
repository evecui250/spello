'use client';

import { useEffect, useState } from 'react';
import { getAllProgress, getStreak, MascotStageId } from '../../lib/storage';
import { WORDS } from '../../lib/words';
import { MASCOT_STAGES, calculateGrowthIncrement } from '../../lib/srs';
import DachshundMascot from '../../components/Mascot';

const STAGE_ORDER: MascotStageId[] = ['puppy', 'short', 'medium', 'long-crowned'];
const STAGE_COLORS: Record<MascotStageId, string> = {
  puppy: 'bg-slate-300',
  short: 'bg-yellow-400',
  medium: 'bg-amber-500',
  'long-crowned': 'bg-green-500',
};
const STAGE_BLURB: Record<MascotStageId, string> = {
  puppy: 'Just introduced — memory strength is still low.',
  short: 'Getting stronger — starting to stick reliably.',
  medium: 'Almost there — recall is solid, just needs a bit more.',
  'long-crowned': 'Fully mastered — retired from regular review.',
};

// A clean (no-mistake) pass always adds the same fixed increment, so "how
// many more reviews to the next stage" is just the score gap divided by it.
const CLEAN_INCREMENT = calculateGrowthIncrement(0);

function stageExplanation(id: MascotStageId): string {
  const idx = MASCOT_STAGES.findIndex(s => s.id === id);
  const stage = MASCOT_STAGES[idx];
  const next = MASCOT_STAGES[idx + 1];
  if (!next) return STAGE_BLURB[id];
  const reviewsToNext = Math.ceil((next.minScore - stage.minScore) / CLEAN_INCREMENT);
  return `${STAGE_BLURB[id]} About ${reviewsToNext} more clean review${reviewsToNext === 1 ? '' : 's'} to reach the next stage.`;
}

export default function StatsPage() {
  const [stageCounts, setStageCounts] = useState<Record<MascotStageId, number>>({
    puppy: 0, short: 0, medium: 0, 'long-crowned': 0,
  });
  const [introducedCount, setIntroducedCount] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [expandedStage, setExpandedStage] = useState<MascotStageId | null>(null);

  useEffect(() => {
    const progress = getAllProgress();
    const counts: Record<MascotStageId, number> = { puppy: 0, short: 0, medium: 0, 'long-crowned': 0 };
    let mastered = 0;
    let introduced = 0;
    for (const w of WORDS) {
      const p = progress[w.id];
      // A word only earns its puppy the first time it clears round 5 —
      // still climbing the round 1-4 ladder doesn't count yet, even though
      // it already has a progress record.
      if (!p || p.studiedTimes === 0) continue;
      introduced++;
      counts[p.mascotStage] += 1;
      if (p.fullyMastered) mastered++;
    }
    setStageCounts(counts);
    setIntroducedCount(introduced);
    setMasteredCount(mastered);
    setStreak(getStreak().count);
  }, []);

  const bars = STAGE_ORDER.map(id => ({
    id,
    count: stageCounts[id],
    color: STAGE_COLORS[id],
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Statistics</h1>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-stone-800">Daily Streak</span>
          <span className="text-2xl font-bold text-orange-500">{streak} 🔥</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-stone-800">Words Mastered</span>
          <span className="text-2xl font-bold text-green-600">{masteredCount} / {WORDS.length}</span>
        </div>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5">
        <h2 className="font-semibold text-stone-800 mb-1">Mascot stage breakdown</h2>
        <p className="text-stone-500 text-sm mb-4">
          Each started word's dachshund grows as its spaced-repetition mastery score rises. Tap a dog to see what it means.
        </p>
        {introducedCount === 0 ? (
          <p className="text-stone-500 text-sm">Study a few words to start growing your first dachshund.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {bars.map(b => (
              <div key={b.id}>
                <button
                  type="button"
                  onClick={() => setExpandedStage(s => (s === b.id ? null : b.id))}
                  className="w-full flex items-center gap-3"
                >
                  <DachshundMascot stage={b.id} className="w-9 h-9 shrink-0" />
                  <div className="flex-1">
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-3 rounded-full ${b.color} transition-all`}
                        style={{ width: `${(b.count / introducedCount) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-stone-500 text-sm w-10 text-right shrink-0">{b.count}</span>
                </button>
                {expandedStage === b.id && (
                  <p className="mt-1.5 ml-12 text-sm text-stone-600 bg-amber-100/60 rounded-lg px-3 py-2">
                    {stageExplanation(b.id)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
