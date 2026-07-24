'use client';

import { useEffect, useState } from 'react';
import { WORDS, Word } from '../../lib/words';
import { getAllProgress, MascotStageId, WordProgress, today } from '../../lib/storage';
import { addDays } from '../../lib/srs';
import DachshundMascot from '../../components/Mascot';
import CongratsModal from '../../components/CongratsModal';

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

interface WordChip {
  id: string;
  de: string;
  article?: Word['article'];
}

interface DayBucket {
  date: string;
  learned: WordChip[];
  reviewed: WordChip[];
  due: WordChip[]; // today only — everything currently due or overdue, per today's live snapshot
}

function chip(w: Word): WordChip {
  return { id: w.id, de: w.de, article: w.article };
}

// The earliest date any word was touched — used as the calendar's lower
// bound, so the user can't navigate to before they started using the app.
function computeFirstUseDate(progress: Record<string, WordProgress>): string {
  let earliest: string | null = null;
  for (const id of Object.keys(progress)) {
    const p = progress[id];
    for (const d of [p.lastPracticed, p.lastReviewedAt]) {
      if (d && (!earliest || d < earliest)) earliest = d;
    }
  }
  return earliest ?? today();
}

function buildBucket(progress: Record<string, WordProgress>, date: string, isToday: boolean): DayBucket {
  const t = today();
  const learned: WordChip[] = [];
  const reviewed: WordChip[] = [];
  const due: WordChip[] = [];

  for (const w of WORDS) {
    const p = progress[w.id];
    if (!p) continue;

    // Only a word that actually completed round 5 on this day counts as
    // learned/reviewed — one still mid-ladder (never cleared round 5)
    // shouldn't show up here even if it was touched today.
    if (p.successfulReviews >= 1 && p.lastReviewedAt === date) {
      (p.successfulReviews === 1 ? learned : reviewed).push(chip(w));
    }

    // "Due to review" is a live snapshot of nextReviewDue, which keeps
    // shifting as the word is reviewed — it only makes sense read against
    // today, not projected onto a past day that's already settled.
    if (isToday) {
      const reviewEligible = p.round === 5 && p.successfulReviews >= 1 && !p.fullyMastered;
      if (reviewEligible && p.nextReviewDue && p.nextReviewDue <= t) due.push(chip(w));
    }
  }

  return { date, learned, reviewed, due };
}

function formatDateLabel(date: string, isToday: boolean): string {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return isToday ? `${label} · Today` : label;
}

function WordRow({ label, words, color }: { label: string; words: WordChip[]; color: string }) {
  if (words.length === 0) return null;
  return (
    <div>
      <div className={`text-xs font-semibold mb-1 ${color}`}>{label} ({words.length})</div>
      <div className="flex flex-wrap gap-1.5">
        {words.map(w => (
          <span key={w.id} className="text-xs bg-white/70 rounded-full px-2 py-1 text-stone-700 font-mono">
            {w.article ? `${w.article} ` : ''}{w.de}
          </span>
        ))}
      </div>
    </div>
  );
}

function DayCard({ bucket, isToday, onViewCongrats }: { bucket: DayBucket; isToday: boolean; onViewCongrats: () => void }) {
  const nothing = bucket.learned.length === 0 && bucket.reviewed.length === 0 && bucket.due.length === 0;
  // "Goal met" for this day, reconstructed from what actually happened —
  // matches the same learned/reviewed counts the live congrats card shows,
  // so a reopened card for a past day is consistent with what was seen then.
  const goalMet = bucket.learned.length > 0 || bucket.reviewed.length > 0;

  return (
    <div className={`bg-amber-50/75 backdrop-blur-sm rounded-2xl border shadow-sm p-4 flex flex-col gap-2 ${isToday ? 'border-amber-400' : 'border-amber-100/50'}`}>
      <div className="font-semibold text-stone-800">{formatDateLabel(bucket.date, isToday)}</div>
      {nothing ? (
        <p className="text-stone-400 text-sm">Nothing.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <WordRow label="Learned" words={bucket.learned} color="text-emerald-700" />
          <WordRow label="Reviewed" words={bucket.reviewed} color="text-indigo-700" />
          <WordRow label="Due to review" words={bucket.due} color="text-amber-700" />
        </div>
      )}
      {goalMet && (
        <button
          onClick={onViewCongrats}
          className="mt-1 self-start text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-full px-3 py-1.5 transition-colors"
        >
          🎉 View congrats card
        </button>
      )}
    </div>
  );
}

export default function ProgressPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress> | null>(null);
  const [date, setDate] = useState(() => today());
  const [showCongrats, setShowCongrats] = useState(false);

  useEffect(() => {
    setProgress(getAllProgress());
  }, []);

  if (!progress) return null;

  const t = today();
  const minDate = computeFirstUseDate(progress);

  const stageCounts: Record<MascotStageId, number> = { puppy: 0, short: 0, medium: 0, 'long-crowned': 0 };
  let introducedCount = 0;
  for (const w of WORDS) {
    const p = progress[w.id];
    if (!p || p.studiedTimes === 0) continue;
    introducedCount++;
    stageCounts[p.mascotStage] += 1;
  }
  const bars = STAGE_ORDER.map(id => ({ id, count: stageCounts[id], color: STAGE_COLORS[id] }));

  const bucket = buildBucket(progress, date, date === t);
  const canGoBack = date > minDate;
  const canGoForward = date < t;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Progress</h1>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5">
        <h2 className="font-semibold text-stone-800 mb-1">Words breakdown</h2>
        <p className="text-stone-500 text-sm mb-4">
          How your started words are progressing.
        </p>
        {introducedCount === 0 ? (
          <p className="text-stone-500 text-sm">Study a few words to start growing your first dachshund.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {bars.map(b => (
              <div key={b.id} className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-0.5 shrink-0 w-12">
                  <DachshundMascot stage={b.id} className="w-11 h-11" />
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

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Daily history</h2>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setDate(d => (d > minDate ? addDays(d, -1) : d))}
            disabled={!canGoBack}
            aria-label="Previous day"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-50/75 border-2 border-white/30 text-stone-800 font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-amber-50"
          >
            ←
          </button>

          <input
            type="date"
            value={date}
            min={minDate}
            max={t}
            onChange={e => e.target.value && setDate(e.target.value)}
            className="bg-amber-50/75 backdrop-blur-sm border-2 border-white/30 rounded-xl px-3 py-2 text-stone-800 text-sm focus:outline-none focus:border-amber-300"
          />

          <button
            onClick={() => setDate(d => (d < t ? addDays(d, 1) : d))}
            disabled={!canGoForward}
            aria-label="Next day"
            className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-50/75 border-2 border-white/30 text-stone-800 font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:bg-amber-50"
          >
            →
          </button>
        </div>

        {date !== t && (
          <button
            onClick={() => setDate(t)}
            className="self-center text-sm font-semibold text-amber-200 hover:text-amber-100 underline"
          >
            Back to today
          </button>
        )}

        <DayCard bucket={bucket} isToday={date === t} onViewCongrats={() => setShowCongrats(true)} />
      </div>

      {showCongrats && (
        <CongratsModal
          studiedCount={bucket.learned.length}
          reviewedCount={bucket.reviewed.length}
          language="German"
          date={bucket.date}
          onClose={() => setShowCongrats(false)}
        />
      )}
    </div>
  );
}
