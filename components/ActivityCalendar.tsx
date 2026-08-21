'use client';

import { useEffect, useState } from 'react';
import { getActivityCalendarDays, localDateString, today } from '../lib/storage';
import { SYNCED_EVENT } from '../lib/sync';

// Same soft, earthy palette as Progress page's mascot-stage bars (see
// STAGE_COLORS there) rather than a bright primary green/yellow — full days
// use the same "success" green already established by the round-ladder's
// own "✓ Correct!" feedback color, partial days use a faint version of the
// bronze/amber tone the cream card backgrounds already lean on, so neither
// mark fights with the page around it.
const FULL_CLASSES = 'border-2 border-green-600 text-green-800 bg-green-50';
const PARTIAL_CLASSES = 'bg-amber-200/70 text-amber-800';
const EMPTY_CLASSES = 'text-stone-400';
const TODAY_RING = 'ring-2 ring-indigo-300 ring-offset-1 ring-offset-amber-50';

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

// Monday-first weekday index (0 = Monday, 6 = Sunday) — Date.getDay() is
// Sunday-first, so this just rotates it.
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

type DayState = 'full' | 'partial' | 'empty';

function DayCircle({ date, state, isToday, dim }: { date: number; state: DayState; isToday: boolean; dim?: boolean }) {
  const stateClasses = state === 'full' ? FULL_CLASSES : state === 'partial' ? PARTIAL_CLASSES : EMPTY_CLASSES;
  return (
    <div
      className={`w-full aspect-square max-w-9 mx-auto rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${stateClasses} ${isToday ? TODAY_RING : ''} ${dim ? 'opacity-30' : ''}`}
    >
      {date}
    </div>
  );
}

export default function ActivityCalendar() {
  const [days, setDays] = useState<{ full: Set<string>; partial: Set<string> }>({ full: new Set(), partial: new Set() });
  const [expanded, setExpanded] = useState(false);
  // Which month the expanded grid shows — defaults to the current month,
  // independent of the collapsed row (which is always "the last 7 days"
  // regardless of this).
  const [viewDate, setViewDate] = useState(() => new Date());

  useEffect(() => {
    const load = () => {
      const { full, partial } = getActivityCalendarDays();
      setDays({ full: new Set(full), partial: new Set(partial) });
    };
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => window.removeEventListener(SYNCED_EVENT, load);
  }, []);

  const stateFor = (dateStr: string): DayState => {
    if (days.full.has(dateStr)) return 'full';
    if (days.partial.has(dateStr)) return 'partial';
    return 'empty';
  };

  const t = today();
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i - 6));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = mondayIndex(firstOfMonth);
  const cells: (Date | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth();

  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold text-stone-800">Activity</h2>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-xs font-semibold text-stone-500 hover:text-stone-700 transition-colors flex items-center gap-0.5"
        >
          {expanded ? 'Show less' : 'Show month'}
          <span aria-hidden className="inline-block text-[10px] leading-none">{expanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {!expanded ? (
        <div className="grid grid-cols-7 gap-2">
          {last7.map(d => {
            const dateStr = localDateString(d);
            return (
              <div key={dateStr} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-medium text-stone-400">{WEEKDAY_LETTERS[mondayIndex(d)]}</span>
                <DayCircle date={d.getDate()} state={stateFor(dateStr)} isToday={dateStr === t} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              aria-label="Previous month"
              className="px-2 py-1 text-stone-400 hover:text-stone-600 transition-colors text-lg leading-none"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-stone-700">{MONTH_NAMES[month]} {year}</span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              aria-label="Next month"
              disabled={isCurrentMonth}
              className="px-2 py-1 text-stone-400 hover:text-stone-600 disabled:opacity-30 disabled:hover:text-stone-400 transition-colors text-lg leading-none"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {WEEKDAY_LETTERS.map((l, i) => (
              <span key={i} className="text-[10px] font-medium text-stone-400 text-center">{l}</span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const dateStr = localDateString(d);
              return <DayCircle key={i} date={d.getDate()} state={stateFor(dateStr)} isToday={dateStr === t} dim={dateStr > t} />;
            })}
          </div>
          <div className="flex items-center gap-4 justify-center text-[11px] text-stone-500 pt-1">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full border-2 border-green-600 bg-green-50 inline-block" />Goal met</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-200/70 inline-block" />Partly done</span>
          </div>
        </div>
      )}
    </div>
  );
}
