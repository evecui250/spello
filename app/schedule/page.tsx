'use client';

import { useEffect, useState } from 'react';
import { WORDS, Word } from '../../lib/words';
import { getAllProgress, getSettings, WordProgress, today } from '../../lib/storage';
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
  plannedNew: number;    // future days only — projected new-word count at the current pace
}

function chip(w: Word): WordChip {
  return { id: w.id, de: w.de, article: w.article };
}

// Rough "if you study every day at today's pace" projection: depletes the
// not-yet-introduced pool day by day from tomorrow through the last day in
// the visible window. It's a projection, not a promise — actual daily study
// picks in-progress words first, and pace/backlog can change day to day.
function projectNewWordCounts(progress: Record<string, WordProgress>, studyBatchSize: number, lastDate: string): Record<string, number> {
  const t = today();
  let remaining = WORDS.filter(w => !progress[w.id]).length;
  const byDate: Record<string, number> = {};
  for (let d = addDays(t, 1); d <= lastDate; d = addDays(d, 1)) {
    const count = Math.min(studyBatchSize, remaining);
    byDate[d] = count;
    remaining -= count;
  }
  return byDate;
}

function buildBuckets(progress: Record<string, WordProgress>, centerDate: string, studyBatchSize: number): DayBucket[] {
  const t = today();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(centerDate, i - 3));
  const plannedByDate = projectNewWordCounts(progress, studyBatchSize, dates[dates.length - 1]);

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

    return { date, learned, reviewed, due, overdue, plannedNew: plannedByDate[date] ?? 0 };
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
    && bucket.due.length === 0 && bucket.overdue.length === 0 && bucket.plannedNew === 0;

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
          {isFuture && bucket.plannedNew > 0 && (
            <div className="text-xs font-semibold text-sky-700">
              ~{bucket.plannedNew} new word{bucket.plannedNew === 1 ? '' : 's'} planned (at today's pace)
            </div>
          )}
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
  const buckets = buildBuckets(progress, centerDate, getSettings().studyBatchSize);

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
