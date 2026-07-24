'use client';

import { useEffect, useState } from 'react';
import { WORDS, Word } from '../../lib/words';
import { getAllProgress, WordProgress, today } from '../../lib/storage';
import { addDays } from '../../lib/srs';

interface WordChip {
  id: string;
  de: string;
  article?: Word['article'];
}

interface DayBucket {
  date: string;
  learned: WordChip[];
  reviewed: WordChip[];
  due: WordChip[];       // scheduled for exactly this day, per today's snapshot
  overdue: WordChip[];   // today only — still-due backlog from earlier days
}

function chip(w: Word): WordChip {
  return { id: w.id, de: w.de, article: w.article };
}

function buildBuckets(progress: Record<string, WordProgress>, centerDate: string): DayBucket[] {
  const t = today();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(centerDate, i - 3));

  return dates.map(date => {
    const learned: WordChip[] = [];
    const reviewed: WordChip[] = [];
    const due: WordChip[] = [];
    const overdue: WordChip[] = [];

    for (const w of WORDS) {
      const p = progress[w.id];
      if (!p) continue;

      if (date <= t && p.lastReviewedAt === date) {
        (p.successfulReviews <= 1 ? learned : reviewed).push(chip(w));
      }

      const reviewEligible = p.round === 5 && p.successfulReviews >= 1 && !p.fullyMastered;
      if (reviewEligible && p.nextReviewDue === date) {
        due.push(chip(w));
      }
      if (date === t && reviewEligible && p.nextReviewDue && p.nextReviewDue < t) {
        overdue.push(chip(w));
      }
    }

    return { date, learned, reviewed, due, overdue };
  });
}

function formatDateLabel(date: string, isToday: boolean): string {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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

function DayCard({ bucket, isToday }: { bucket: DayBucket; isToday: boolean }) {
  const t = today();
  const isFuture = bucket.date > t;
  const nothing = bucket.learned.length === 0 && bucket.reviewed.length === 0
    && bucket.due.length === 0 && bucket.overdue.length === 0;

  return (
    <div className={`bg-amber-50/75 backdrop-blur-sm rounded-2xl border shadow-sm p-4 flex flex-col gap-2 ${isToday ? 'border-amber-400' : 'border-amber-100/50'}`}>
      <div className="font-semibold text-stone-800">{formatDateLabel(bucket.date, isToday)}</div>
      {nothing ? (
        <p className="text-stone-400 text-sm">Nothing.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <WordRow label="Learned" words={bucket.learned} color="text-emerald-700" />
          <WordRow label="Reviewed" words={bucket.reviewed} color="text-indigo-700" />
          <WordRow label={isFuture ? 'Scheduled to review' : 'Due to review'} words={bucket.due} color="text-amber-700" />
          {isToday && <WordRow label="Still overdue from before" words={bucket.overdue} color="text-red-700" />}
        </div>
      )}
    </div>
  );
}

export default function SchedulePage() {
  const [centerDate, setCenterDate] = useState(() => today());
  const [progress, setProgress] = useState<Record<string, WordProgress> | null>(null);

  useEffect(() => {
    setProgress(getAllProgress());
  }, []);

  if (!progress) return null;

  const t = today();
  const buckets = buildBuckets(progress, centerDate);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Schedule</h1>
      <p className="text-emerald-100/70 text-sm">
        3 days before and after the date below. Past days show what was actually learned or
        reviewed; future days show today's projected schedule — since a word's next review date
        shifts with how you do on it, this is a snapshot, not a fixed plan.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={centerDate}
          onChange={e => setCenterDate(e.target.value || t)}
          className="bg-amber-50/75 backdrop-blur-sm border-2 border-white/30 rounded-xl px-4 py-2 text-stone-800 focus:outline-none focus:border-amber-300"
        />
        {centerDate !== t && (
          <button
            onClick={() => setCenterDate(t)}
            className="text-sm font-semibold text-amber-200 hover:text-amber-100 underline"
          >
            Back to today
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {buckets.map(b => <DayCard key={b.date} bucket={b} isToday={b.date === t} />)}
      </div>
    </div>
  );
}
