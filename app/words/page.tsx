'use client';

import { useEffect, useMemo, useState } from 'react';
import { wordsForLevel, Word } from '../../lib/words';
import { getAllProgress, getSettings, WordProgress, today } from '../../lib/storage';
import { addDays, daysBetween } from '../../lib/srs';
import SpeakerButton from '../../components/SpeakerButton';
import DachshundMascot from '../../components/Mascot';
import CongratsModal from '../../components/CongratsModal';

// "in 3 days" / "due today" for a word that's still in the review rotation
// (mastered words are retired from review, so they don't get this label).
function reviewLabel(nextReviewDue?: string): string | null {
  if (!nextReviewDue) return null;
  const days = daysBetween(today(), nextReviewDue);
  return days <= 0 ? 'due today' : `in ${days} day${days === 1 ? '' : 's'}`;
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

type Familiarity = 'all' | 'new' | 'learning' | 'mastered';

// "New" = hasn't completed its first learning pass yet (round 4 success),
// even if attempts are already in progress. "Learning" = has completed at
// least one pass — spans all 4 mascot stages, including fully mastered
// words (it's a broad "has this been engaged with" bucket, not mutually
// exclusive with "Mastered"). "Mastered" is a specific, overlapping
// drill-down for the fullyMastered subset of "Learning".
function matchesFamiliarity(p: WordProgress | undefined, filter: Familiarity): boolean {
  if (filter === 'all') return true;
  const earned = !!p && p.studiedTimes > 0;
  if (filter === 'new') return !earned;
  if (filter === 'learning') return earned;
  return !!p?.fullyMastered;
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

function formatDateLabel(date: string, isToday: boolean): string {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return isToday ? `${label} · Today` : label;
}

export default function WordsPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [search, setSearch] = useState('');
  const [filterFamiliarity, setFilterFamiliarity] = useState<Familiarity>('all');
  const [dateMode, setDateMode] = useState<'all' | 'specific'>('all');
  const [date, setDate] = useState(() => today());
  const [showCongrats, setShowCongrats] = useState(false);
  // The vocabulary book itself — follows Settings' CEFR level (a separate
  // concept from the familiarity/date filters below). Browsing an A1 profile
  // shouldn't surface B2-only words.
  const words = useMemo(
    () => [...wordsForLevel(getSettings().level)].sort((a, b) => a.de.localeCompare(b.de, 'de')),
    [],
  );

  useEffect(() => {
    setProgress(getAllProgress());
  }, []);

  const t = today();
  const minDate = computeFirstUseDate(progress);
  const canGoBack = date > minDate;
  const canGoForward = date < t;

  const q = search.toLowerCase();
  const filtered = words
    .filter(w => {
      const p = progress[w.id];
      if (!matchesFamiliarity(p, filterFamiliarity)) return false;
      // A word only counts for a given day if it was actually learned or
      // reviewed then — lastReviewedAt is set on every successful round-4
      // pass, whether that's the first (learned) or a later one (reviewed).
      if (dateMode === 'specific' && p?.lastReviewedAt !== date) return false;
      return true;
    })
    .map(w => ({ w, rank: search ? searchRank(w, q) : 0 }))
    .filter((x): x is { w: Word; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map(x => x.w);

  // The congrats-reopen button reflects the WHOLE day's activity regardless
  // of the familiarity filter narrowing the visible list — "familiar words
  // from yesterday" shouldn't hide the card just because none of yesterday's
  // words happen to be familiar-tier today.
  let dayLearnedCount = 0;
  let dayReviewedCount = 0;
  if (dateMode === 'specific') {
    for (const w of words) {
      const p = progress[w.id];
      if (p?.lastReviewedAt !== date) continue;
      if (p.successfulReviews === 1) dayLearnedCount++;
      else if (p.successfulReviews > 1) dayReviewedCount++;
    }
  }
  const goalMet = dayLearnedCount > 0 || dayReviewedCount > 0;

  const earned = (p?: WordProgress) => !!p && p.studiedTimes > 0;

  function WordItem({ w }: { w: Word }) {
    const sentence = progress[w.id]?.exampleSentence;
    return (
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex items-center justify-between">
        <div>
          <span className="font-semibold text-stone-800">
            {w.article ? `${w.article} ` : ''}{w.de}
          </span>
          <SpeakerButton word={w} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
          {w.plural && <span className="text-stone-500 text-sm ml-2">· {w.plural}</span>}
          <div className="text-stone-500 text-sm">{w.en}</div>
          {sentence && <div className="text-stone-500 text-sm italic mt-0.5">{sentence.sentence}</div>}
        </div>
        <span className="shrink-0 flex flex-col items-center gap-0.5">
          {earned(progress[w.id]) ? (
            <>
              <DachshundMascot stage={progress[w.id].mascotStage ?? 'puppy'} className="w-11 h-11" />
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

      <div className="flex gap-2 flex-wrap">
        <select
          value={filterFamiliarity}
          onChange={e => setFilterFamiliarity(e.target.value as Familiarity)}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-300"
        >
          <option value="all">All words</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="mastered">Mastered</option>
        </select>

        <select
          value={dateMode}
          onChange={e => setDateMode(e.target.value as 'all' | 'specific')}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-300"
        >
          <option value="all">All days</option>
          <option value="specific">Specific day</option>
        </select>
      </div>

      {dateMode === 'specific' && (
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

          <div className="flex items-center justify-between gap-2">
            <span className="text-amber-50 font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
              {formatDateLabel(date, date === t)}
            </span>
            {goalMet && (
              <button
                onClick={() => setShowCongrats(true)}
                className="text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-full px-3 py-1.5 transition-colors"
              >
                View congrats card
              </button>
            )}
          </div>
        </>
      )}

      <p className="text-emerald-100/70 text-sm">{filtered.length} words</p>
      <div className="flex flex-col gap-2">
        {filtered.map(w => <WordItem key={w.id} w={w} />)}
      </div>

      {showCongrats && (
        <CongratsModal
          studiedCount={dayLearnedCount}
          reviewedCount={dayReviewedCount}
          language="German"
          level={getSettings().level}
          date={date}
          onClose={() => setShowCongrats(false)}
        />
      )}
    </div>
  );
}
