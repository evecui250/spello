'use client';

import { useEffect, useMemo, useState } from 'react';
import { WORDS, wordsForLevel, Word, Level, glossFor } from '../../lib/words';
import { getAllProgress, getSettings, WordProgress, MascotStageId, today } from '../../lib/storage';
import { daysBetween } from '../../lib/srs';
import { imageUrlForWord } from '../../lib/wordImage';
import SpeakerButton from '../../components/SpeakerButton';
import DachshundMascot from '../../components/Mascot';

// Same wording as Progress page's STAGE_LABEL — "Introduced" rather than
// "New" for a word that's actually finished Day 1, so this list's badge
// text matches the mascot-stage terminology used everywhere else instead
// of implying it hasn't been touched yet.
const STAGE_LABEL: Record<MascotStageId, string> = {
  puppy: 'Introduced',
  short: 'Familiar',
  medium: 'Strong',
  'long-crowned': 'Mastered',
};

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
function searchRank(w: Word, q: string, nativeLanguage: 'en' | 'zh'): number | null {
  const de = w.de.toLowerCase();
  // Also matched with the article included (e.g. "der Start") — searchRank
  // only checked the bare word before, so typing the article along with it
  // (as it's actually displayed/spoken) found nothing.
  const withArticle = w.article ? `${w.article} ${w.de}`.toLowerCase() : de;
  const gloss = glossFor(w, nativeLanguage).toLowerCase();
  if (de.startsWith(q) || withArticle.startsWith(q)) return 0;
  if (de.includes(q) || withArticle.includes(q)) return 1;
  if (gloss.startsWith(q)) return 2;
  if (gloss.includes(q)) return 3;
  return null;
}

// The four real, user-selectable vocabulary books (matches Settings' own
// level picker) — excludes the legacy 'B2_old' and the still-unused
// 'C1'/'C2' Level values, none of which are a book a learner can pick.
const BOOK_LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2'];
type BookFilter = 'all' | Level;

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

type DateFilter = 'all' | '7days' | '30days';

// lastReviewedAt is set on every successful round-4 pass, whether that's
// the first (learned) or a later one (reviewed) — so this covers "touched
// at all in the last N days" regardless of which of those it was.
function matchesDateFilter(p: WordProgress | undefined, filter: DateFilter, t: string): boolean {
  if (filter === 'all') return true;
  if (!p?.lastReviewedAt) return false;
  const windowDays = filter === '7days' ? 7 : 30;
  return daysBetween(p.lastReviewedAt, t) < windowDays;
}

// Most words don't have a pre-generated illustration yet — render nothing
// (rather than a broken-image icon) when the file 404s.
function WordThumbnail({ word }: { word: Word }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={imageUrlForWord(word)}
      alt=""
      loading="lazy"
      className="w-12 h-12 object-contain shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

export default function WordsPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [search, setSearch] = useState('');
  const [filterFamiliarity, setFilterFamiliarity] = useState<Familiarity>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // Which vocabulary book to browse — defaults to Settings' own active
  // level (so the page looks exactly as it always has until the learner
  // deliberately switches it), but "All books" and any OTHER level can be
  // browsed too. Progress is still only ever read from the CURRENTLY
  // ACTIVE level's own store (per-level progress is a fully separate
  // profile — see lib/storage.ts) — so a word from a level the learner
  // isn't actively studying shows real progress here only if it was
  // reached via WordInfoPanel's cross-level "save for review" (see
  // lib/practice.ts's saveWordForReviewFromOtherLevel), which stores it,
  // under its own foreign id, inside the CURRENT level's progress store.
  // Browsing a book the learner studied natively in the past, under a
  // level that ISN'T active right now, won't show that old history here.
  const [filterLevel, setFilterLevel] = useState<BookFilter>(() => getSettings().level);
  const nativeLanguage = getSettings().nativeLanguage;

  const words = useMemo(() => {
    const pool = filterLevel === 'all'
      ? WORDS.filter(w => (BOOK_LEVELS as string[]).includes(w.level))
      : wordsForLevel(filterLevel);
    return [...pool].sort((a, b) => a.de.localeCompare(b.de, 'de'));
  }, [filterLevel]);

  useEffect(() => {
    setProgress(getAllProgress());
  }, []);

  const t = today();

  const q = search.toLowerCase();
  const filtered = words
    .filter(w => {
      const p = progress[w.id];
      if (!matchesFamiliarity(p, filterFamiliarity)) return false;
      if (!matchesDateFilter(p, dateFilter, t)) return false;
      return true;
    })
    .map(w => ({ w, rank: search ? searchRank(w, q, nativeLanguage) : 0 }))
    .filter((x): x is { w: Word; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map(x => x.w);

  const earned = (p?: WordProgress) => !!p && p.studiedTimes > 0;

  function WordItem({ w }: { w: Word }) {
    const sentence = progress[w.id]?.exampleSentence;
    return (
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-stone-800">
            {w.article ? `${w.article} ` : ''}{w.de}
          </span>
          <SpeakerButton word={w} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
          {w.plural && <span className="text-stone-500 text-sm ml-2">· {w.plural}</span>}
          {/* Only shown when browsing "All books" — a mixed-book list
              needs a way to tell at a glance which one each row is from. */}
          {filterLevel === 'all' && (
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 rounded-full px-2 py-0.5 align-middle">
              {w.level}
            </span>
          )}
          <div className="text-stone-500 text-sm">{glossFor(w, nativeLanguage)}</div>
          {sentence && (
            <div className="mt-0.5 flex flex-col gap-0.5">
              {sentence.englishPrompt && (
                <div className="text-stone-400 text-xs">
                  {nativeLanguage === 'zh' && w.exercisePromptZh ? w.exercisePromptZh : sentence.englishPrompt}
                </div>
              )}
              <div className="text-stone-500 text-sm italic">{sentence.sentence}</div>
            </div>
          )}
        </div>
        <WordThumbnail word={w} />
        <span className="shrink-0 w-20 flex flex-col items-center gap-0.5">
          {earned(progress[w.id]) ? (
            <>
              <DachshundMascot stage={progress[w.id].mascotStage ?? 'puppy'} className="w-11 h-11" />
              <span className="text-[10px] font-medium text-stone-500 whitespace-nowrap">
                {STAGE_LABEL[progress[w.id].mascotStage ?? 'puppy']}
              </span>
              {!progress[w.id].fullyMastered && (
                <span className="text-[10px] text-stone-400 whitespace-nowrap">
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
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value as BookFilter)}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-300"
        >
          <option value="all">All books</option>
          {BOOK_LEVELS.map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
        </select>

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
          value={dateFilter}
          onChange={e => setDateFilter(e.target.value as DateFilter)}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-300"
        >
          <option value="all">All days</option>
          <option value="7days">Past 7 days</option>
          <option value="30days">Past 30 days</option>
        </select>
      </div>

      <p className="text-emerald-100/70 text-sm">{filtered.length} words</p>
      <div className="flex flex-col gap-2">
        {filtered.map(w => <WordItem key={w.id} w={w} />)}
      </div>
    </div>
  );
}
