'use client';

import { useEffect, useRef, useState, TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { getActivityCalendarDays, getDailyWordLog, getSettings, localDateString, today } from '../lib/storage';
import { SYNCED_EVENT } from '../lib/sync';
import { glossFor, Word } from '../lib/words';
import { wordsById } from '../lib/practice';
import CongratsModal from './CongratsModal';

// Same soft, earthy palette as Progress page's mascot-stage bars (see
// STAGE_COLORS there) rather than a bright primary green/yellow — full days
// use the same "success" green already established by the round-ladder's
// own "✓ Correct!" feedback color, partial days use a faint version of the
// bronze/amber tone the cream card backgrounds already lean on, so neither
// mark fights with the page around it.
const FULL_CLASSES = 'bg-good/70 text-good-deep';
const PARTIAL_CLASSES = 'bg-gold/70 text-label';
// Darker than a typical muted label (stone-400) so the date digits stay
// easy to read at a glance, without going all the way to the near-black
// headings use — this is still a secondary/quiet element on the card.
const EMPTY_CLASSES = 'text-ink-soft';
const TODAY_RING = 'ring-2 ring-accent ring-offset-1 ring-offset-amber-50';

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

function DayCircle({ date, state, isToday, dim, onClick }: { date: number; state: DayState; isToday: boolean; dim?: boolean; onClick?: () => void }) {
  const stateClasses = state === 'full' ? FULL_CLASSES : state === 'partial' ? PARTIAL_CLASSES : EMPTY_CLASSES;
  return (
    <button
      type="button"
      disabled={dim}
      onClick={onClick}
      className={`w-full aspect-square max-w-9 mx-auto rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${stateClasses} ${isToday ? TODAY_RING : ''} ${dim ? 'opacity-30' : 'active:scale-90'}`}
    >
      {date}
    </button>
  );
}

// Reads straight from the real per-day log (see logWordActivity) rather
// than reconstructing from WordProgress's own fields — those only ever
// hold each word's single latest date/stage, so an earlier attempt at
// this (comparing lastPracticed/lastReviewedAt/mascotStage against the
// clicked date) silently lost words the moment they were touched again on
// a LATER day. A day from before this log existed just has nothing
// recorded — same limitation every other backfilled record in this app
// has, and honestly reported as "no activity" rather than guessed at.
function wordsForDate(dateStr: string): { learned: Word[]; reviewed: Word[] } {
  const entry = getDailyWordLog()[dateStr];
  if (!entry) return { learned: [], reviewed: [] };
  // A word's round-1 attempt (logged 'reviewed') and its round-2 completion
  // (logged 'learned') can both happen the same day — dedupe in favor of
  // 'learned' rather than showing the same word under both headings, since
  // the round-1 attempt was really just the first half of learning it, not
  // a separate review event.
  const learnedIds = new Set(entry.learned);
  return {
    learned: wordsById(entry.learned),
    reviewed: wordsById(entry.reviewed.filter(id => !learnedIds.has(id))),
  };
}

// Below this, a horizontal drag reads as a week-swipe rather than a
// vertical page scroll — matches typical swipe-carousel thresholds
// (enough to filter out an accidental/shaky touch, not so much that a
// real swipe feels ignored).
const SWIPE_THRESHOLD_PX = 40;

export default function ActivityCalendar() {
  const [days, setDays] = useState<{ full: Set<string>; partial: Set<string> }>({ full: new Set(), partial: new Set() });
  const [expanded, setExpanded] = useState(false);
  // Which month the expanded grid shows — defaults to the current month,
  // independent of the collapsed row (which is always "the last 7 days"
  // regardless of this).
  const [viewDate, setViewDate] = useState(() => new Date());
  // How many weeks back the COLLAPSED row is showing — 0 is the current
  // window (the 7 days ending today). Swipe left (or the ‹ button) goes
  // further into the past; swipe right (or ›) comes back toward today,
  // capped there since there's nothing to show beyond it.
  const [weekOffset, setWeekOffset] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i - 6 - weekOffset * 7));
  // Headered by whichever month the row's last (most recent) day falls
  // in — matches the offset-0 case (today) exactly, and gives a single,
  // unambiguous answer for a row that happens to straddle two months.
  const rowMonth = last7[6];

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
    if (delta < 0) setWeekOffset(w => w + 1);
    else setWeekOffset(w => Math.max(0, w - 1));
  };

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
    <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold text-ink">Activity</h2>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="text-xs font-semibold text-ink-soft hover:text-ink transition-colors flex items-center gap-0.5"
        >
          {expanded ? 'Show less' : 'Show month'}
          <span aria-hidden className="inline-block text-[10px] leading-none">{expanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {!expanded ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setWeekOffset(w => w + 1)}
              aria-label="Previous week"
              className="px-2 py-1 text-ink-soft hover:text-ink transition-colors text-lg leading-none"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-ink">
              {MONTH_NAMES[rowMonth.getMonth()]} {rowMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
              aria-label="Next week"
              disabled={weekOffset === 0}
              className="px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-30 disabled:hover:text-ink-soft transition-colors text-lg leading-none"
            >
              ›
            </button>
          </div>
          {/* Touch-swipe left/right to page through weeks — phone-only in
              practice (no mouse-drag equivalent wired up), which is why the
              ‹ › buttons above exist too, for anyone on desktop/without
              touch. */}
          <div
            className="grid grid-cols-7 gap-2"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {last7.map(d => {
              const dateStr = localDateString(d);
              return (
                <div key={dateStr} className="flex flex-col items-center gap-1">
                  <span className="text-xs font-medium text-ink-soft">{WEEKDAY_LETTERS[mondayIndex(d)]}</span>
                  <DayCircle date={d.getDate()} state={stateFor(dateStr)} isToday={dateStr === t} dim={dateStr > t} onClick={() => setSelectedDate(dateStr)} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              aria-label="Previous month"
              className="px-2 py-1 text-ink-soft hover:text-ink transition-colors text-lg leading-none"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-ink">{MONTH_NAMES[month]} {year}</span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              aria-label="Next month"
              disabled={isCurrentMonth}
              className="px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-30 disabled:hover:text-ink-soft transition-colors text-lg leading-none"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {WEEKDAY_LETTERS.map((l, i) => (
              <span key={i} className="text-xs font-medium text-ink-soft text-center">{l}</span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const dateStr = localDateString(d);
              return <DayCircle key={i} date={d.getDate()} state={stateFor(dateStr)} isToday={dateStr === t} dim={dateStr > t} onClick={() => setSelectedDate(dateStr)} />;
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 justify-center text-[11px] text-ink-soft pt-3">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-good/70 inline-block" />Goal met</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gold/70 inline-block" />Finished review</span>
      </div>

      {selectedDate && createPortal(
        <DayDetailPopup dateStr={selectedDate} isFullDay={days.full.has(selectedDate)} onClose={() => setSelectedDate(null)} />,
        document.body,
      )}
    </div>
  );
}

function DayDetailPopup({ dateStr, isFullDay, onClose }: { dateStr: string; isFullDay: boolean; onClose: () => void }) {
  const { learned, reviewed } = wordsForDate(dateStr);
  const label = new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const nativeLanguage = getSettings().nativeLanguage;
  // A day only ever reaches "full" (goal met) by finishing both study and
  // review that day, the exact same condition that shows the real congrats
  // card live — so reopening it here is safe to gate on the same flag
  // rather than needing its own separate record of "was a card shown".
  // Reconstructed from the same word lists the popup already displays
  // above (deliberately the same counts a learner already sees here, not
  // a separately-tracked number that could quietly drift from it); level
  // comes from whichever word was actually studied that day, since a
  // learner can switch levels between one goal-day and the next and this
  // log isn't itself level-namespaced (see DAILY_WORD_LOG_KEY).
  const [showCard, setShowCard] = useState(false);
  const cardLevel = learned[0]?.level ?? reviewed[0]?.level ?? getSettings().level;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">{label}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-soft hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        {isFullDay && (
          <button
            type="button"
            onClick={() => setShowCard(true)}
            className="self-start text-xs font-semibold text-label hover:text-ink bg-accent/10 hover:bg-accent/15 rounded-full px-3 py-1.5 transition-colors"
          >
            View card
          </button>
        )}
        {learned.length === 0 && reviewed.length === 0 ? (
          <p className="text-ink-soft text-sm">No activity that day.</p>
        ) : (
          <>
            {learned.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">
                  {learned.length} word{learned.length === 1 ? '' : 's'} learned
                </h3>
                {learned.map(w => (
                  <div key={w.id} className="flex items-center justify-between bg-paper/60 rounded-lg px-3 py-2 gap-2">
                    <span className="text-ink font-medium truncate">{w.article ? `${w.article} ` : ''}{w.de}</span>
                    <span className="text-ink-soft text-sm text-right truncate">{glossFor(w, nativeLanguage)}</span>
                  </div>
                ))}
              </div>
            )}
            {reviewed.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">
                  {reviewed.length} word{reviewed.length === 1 ? '' : 's'} reviewed
                </h3>
                {reviewed.map(w => (
                  <div key={w.id} className="flex items-center justify-between bg-paper/60 rounded-lg px-3 py-2 gap-2">
                    <span className="text-ink font-medium truncate">{w.article ? `${w.article} ` : ''}{w.de}</span>
                    <span className="text-ink-soft text-sm text-right truncate">{glossFor(w, nativeLanguage)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {showCard && (
        <CongratsModal
          studiedCount={learned.length}
          reviewedCount={reviewed.length}
          language="German"
          level={cardLevel}
          date={dateStr}
          onClose={() => setShowCard(false)}
        />
      )}
    </div>
  );
}
