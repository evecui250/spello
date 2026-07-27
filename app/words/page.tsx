'use client';

import { useEffect, useMemo, useState } from 'react';
import { wordsForLevel, Word } from '../../lib/words';
import { getAllProgress, getSettings, MAX_ROUND, WordProgress, today } from '../../lib/storage';
import { addDays, daysBetween } from '../../lib/srs';
import SpeakerButton from '../../components/SpeakerButton';
import DachshundMascot from '../../components/Mascot';
import CongratsModal from '../../components/CongratsModal';

// "in 3 days" / "due now" for a word that's still in the review rotation
// (mastered words are retired from review, so they don't get this label).
function reviewLabel(nextReviewDue?: string): string | null {
  if (!nextReviewDue) return null;
  const days = daysBetween(today(), nextReviewDue);
  return days <= 0 ? 'due now' : `in ${days} day${days === 1 ? '' : 's'}`;
}

// Lower is more relevant — a German prefix match (e.g. "ob" → "oben") is far
// more useful than a word that merely contains the letters mid-way through
// (e.g. "Autobahn"), or one that only matches via its English translation.
// Returns null for no match at all, so it can double as the search filter.
function searchRank(w: Word, q: string): number | null {
  const de = w.de.toLowerCase();
  const en = w.en.toLowerCase();
  if (de.startsWith(q)) return 0;
  if (de.includes(q)) return 1;
  if (en.startsWith(q)) return 2;
  if (en.includes(q)) return 3;
  return null;
}

// The earliest date any word was touched — used as the date picker's lower
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

interface DayBucket {
  date: string;
  learned: Word[];
  reviewed: Word[];
  due: Word[]; // today only — everything currently due or overdue, per today's live snapshot
}

function buildBucket(levelWords: Word[], progress: Record<string, WordProgress>, date: string, isToday: boolean): DayBucket {
  const t = today();
  const learned: Word[] = [];
  const reviewed: Word[] = [];
  const due: Word[] = [];

  for (const w of levelWords) {
    const p = progress[w.id];
    if (!p) continue;

    // Only a word that actually completed round 4 on this day counts as
    // learned/reviewed — one still mid-ladder (never cleared round 4)
    // shouldn't show up here even if it was touched today.
    if (p.successfulReviews >= 1 && p.lastReviewedAt === date) {
      (p.successfulReviews === 1 ? learned : reviewed).push(w);
    }

    // "Due to review" is a live snapshot of nextReviewDue, which keeps
    // shifting as the word is reviewed — it only makes sense read against
    // today, not projected onto a past day that's already settled.
    if (isToday) {
      const reviewEligible = p.round === MAX_ROUND && p.successfulReviews >= 1 && !p.fullyMastered;
      if (reviewEligible && p.nextReviewDue && p.nextReviewDue <= t) due.push(w);
    }
  }

  return { date, learned, reviewed, due };
}

function formatDateLabel(date: string, isToday: boolean): string {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return isToday ? `${label} · Today` : label;
}

export default function WordsPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [date, setDate] = useState(() => today());
  const [showCongrats, setShowCongrats] = useState(false);
  // The vocabulary book itself — follows Settings' CEFR level (a separate
  // concept from filterLevel above, which is the New/Learning/Mastered/By
  // date filter). Browsing an A1 profile shouldn't surface B2-only words.
  const words = useMemo(
    () => [...wordsForLevel(getSettings().level)].sort((a, b) => a.de.localeCompare(b.de, 'de')),
    [],
  );

  useEffect(() => {
    setProgress(getAllProgress());
  }, []);

  // A word only "earns" its puppy the first time it clears round 4 —
  // studiedTimes stays 0 while it's still mid-ladder (rounds 1-4), even
  // though it already has a progress record. Until then it still reads as
  // New, same as a word that hasn't been touched at all.
  const earned = (p?: WordProgress) => !!p && p.studiedTimes > 0;

  const q = search.toLowerCase();
  const filtered = words
    .filter(w => {
      const p = progress[w.id];
      if (filterLevel === 'new' && earned(p)) return false;
      if (filterLevel === 'mastered' && !p?.fullyMastered) return false;
      if (filterLevel === 'learning' && (!earned(p) || p?.fullyMastered)) return false;
      return true;
    })
    .map(w => ({ w, rank: search ? searchRank(w, q) : 0 }))
    .filter((x): x is { w: Word; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map(x => x.w);

  const t = today();
  const minDate = computeFirstUseDate(progress);
  const bucket = filterLevel === 'date' ? buildBucket(words, progress, date, date === t) : null;
  const canGoBack = date > minDate;
  const canGoForward = date < t;
  const goalMet = !!bucket && (bucket.learned.length > 0 || bucket.reviewed.length > 0);

  function WordItem({ w }: { w: Word }) {
    return (
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex items-center justify-between">
        <div>
          <span className="font-semibold text-stone-800">
            {w.article ? `${w.article} ` : ''}{w.de}
          </span>
          <SpeakerButton word={w} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
          {w.plural && <span className="text-stone-500 text-sm ml-2">· {w.plural}</span>}
          <div className="text-stone-500 text-sm">{w.en}</div>
        </div>
        <span className="shrink-0 flex flex-col items-center gap-0.5">
          {earned(progress[w.id]) ? (
            <>
              <DachshundMascot stage={progress[w.id].mascotStage} className="w-11 h-11" />
              {!progress[w.id].fullyMastered && (
                <span className="text-[10px] text-stone-500 whitespace-nowrap">
                  {reviewLabel(progress[w.id].nextReviewDue)}
                </span>
              )}
            </>
          ) : (
            <span className="flex items-center justify-center px-2.5 py-1.5 rounded-full bg-slate-100">
              <span className="text-xs font-medium text-stone-500">New</span>
            </span>
          )}
        </span>
      </div>
    );
  }

  function WordSection({ label, list, color }: { label: string; list: Word[]; color: string }) {
    if (list.length === 0) return null;
    return (
      <div className="flex flex-col gap-2">
        <div className={`text-xs font-semibold ${color}`}>{label} ({list.length})</div>
        {list.map(w => <WordItem key={w.id} w={w} />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Word List</h1>

      <input
        type="search"
        placeholder="Search German or English…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="bg-amber-50/75 backdrop-blur-sm border-2 border-white/30 rounded-xl px-4 py-2 text-stone-800 placeholder:text-stone-500 focus:outline-none focus:border-amber-300"
      />

      <select
        value={filterLevel}
        onChange={e => setFilterLevel(e.target.value)}
        className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-300 self-start"
      >
        <option value="all">All words</option>
        <option value="new">New</option>
        <option value="learning">Learning</option>
        <option value="mastered">Mastered</option>
        <option value="date">By date</option>
      </select>

      {bucket ? (
        <>
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

          <div className="text-amber-50 font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
            {formatDateLabel(bucket.date, date === t)}
          </div>

          {goalMet && (
            <button
              onClick={() => setShowCongrats(true)}
              className="self-start text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-full px-3 py-1.5 transition-colors"
            >
              View congrats card
            </button>
          )}

          {bucket.learned.length === 0 && bucket.reviewed.length === 0 && bucket.due.length === 0 ? (
            <p className="text-stone-400 text-sm">Nothing.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <WordSection label="Learned" list={bucket.learned} color="text-emerald-200" />
              <WordSection label="Reviewed" list={bucket.reviewed} color="text-indigo-200" />
              <WordSection label="Due to review" list={bucket.due} color="text-amber-200" />
            </div>
          )}

          {showCongrats && (
            <CongratsModal
              studiedCount={bucket.learned.length}
              reviewedCount={bucket.reviewed.length}
              language="German"
              level={getSettings().level}
              date={bucket.date}
              onClose={() => setShowCongrats(false)}
            />
          )}
        </>
      ) : (
        <>
          <p className="text-emerald-100/70 text-sm">{filtered.length} words</p>
          <div className="flex flex-col gap-2">
            {filtered.map(w => <WordItem key={w.id} w={w} />)}
          </div>
        </>
      )}
    </div>
  );
}
