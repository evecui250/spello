'use client';

import { useEffect, useMemo, useState } from 'react';
import { WORDS, Word, Level, glossFor } from '../../lib/words';
import {
  getMergedProgressAcrossLevels, getSettings, WordProgress, MascotStageId, today,
  getAllCustomWordsAcrossLevels, addCustomWord, removeCustomWord, getWordProgress, saveWordProgress,
  newCustomWordId, isCustomWordId, PROGRESS_CHANGED_EVENT,
} from '../../lib/storage';
import { daysBetween, recordMilestonePass } from '../../lib/srs';
import { imageUrlForWord } from '../../lib/wordImage';
import { WORDS_WITH_IMAGES } from '../../lib/wordImageManifest';
import { lookupWord, LookupWordResult, DailyLimitReachedError, AIUnreachableError, generateWordAudio } from '../../lib/ai';
import { scheduleSync } from '../../lib/sync';
import { spokenForm } from '../../lib/speech';
import SpeakerButton from '../../components/SpeakerButton';
import DachshundMascot from '../../components/Mascot';
import WordInfoPanel from '../../components/WordInfoPanel';

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

// Lower is more relevant. Tiers are spaced 100 apart (exact match, German
// prefix, inflected-form prefix, German contains, inflected-form contains,
// gloss prefix, gloss contains) and within a tier the matched form's own
// length breaks ties — this is what makes an exact/short match like "Ei"
// outrank a longer word that merely happens to start with the same letters
// (e.g. "Eingang", "Einladung" both start with "ei" too, but "Ei" itself is
// an exact match and ranks first). Inflected forms (plural/thirdPerson/
// pastTense/perfectTense — all real fields already on Word) are checked
// too, so searching a plural like "Eier" resolves to the base word "Ei"
// instead of coming up empty and offering the AI-lookup/add-new flow for a
// word that already exists. Returns null for no match at all, so it can
// double as the search filter.
function searchRank(w: Word, q: string, nativeLanguage: 'en' | 'zh'): number | null {
  const de = w.de.toLowerCase();
  // Also matched with the article included (e.g. "der Start") — searchRank
  // only checked the bare word before, so typing the article along with it
  // (as it's actually displayed/spoken) found nothing.
  const withArticle = w.article ? `${w.article} ${w.de}`.toLowerCase() : de;
  const germanForms = [de, withArticle];
  const inflectedForms = [w.plural, w.thirdPerson, w.pastTense, w.perfectTense]
    .filter((f): f is string => !!f)
    .map(f => f.toLowerCase());
  const gloss = glossFor(w, nativeLanguage).toLowerCase();

  if (germanForms.includes(q) || inflectedForms.includes(q)) return 0;

  const germanPrefix = germanForms.find(f => f.startsWith(q));
  if (germanPrefix) return 100 + germanPrefix.length;

  const inflectedPrefix = inflectedForms.find(f => f.startsWith(q));
  if (inflectedPrefix) return 200 + inflectedPrefix.length;

  const germanContains = germanForms.find(f => f.includes(q));
  if (germanContains) return 300 + germanContains.length;

  const inflectedContains = inflectedForms.find(f => f.includes(q));
  if (inflectedContains) return 400 + inflectedContains.length;

  if (gloss.startsWith(q)) return 500;
  if (gloss.includes(q)) return 600;
  return null;
}

// The four real, user-selectable vocabulary books (matches Settings' own
// level picker) — search spans all of these at once now (see the owner's
// own framing: "no matter it's from our vocab book or not"), rather than
// needing a book picked first.
const BOOK_LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2'];

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

type DateFilter = 'all' | 'today' | '7days' | '30days';

// lastPracticed (not lastReviewedAt) is what actually means "touched at
// all in the last N days" — confirmed real bug: lastReviewedAt only
// updates on a COMPLETED milestone pass (see recordMilestonePass), so a
// review that's still mid-way through its rounds, got an answer wrong
// (demoted, not yet re-passed), or was done early via "Review Extra"
// (which explicitly never touches the schedule at all — see
// applyReviewResult) left zero trace here even though the learner
// genuinely practiced that word within the window. lastPracticed is set
// on every single attempt regardless of outcome, in both applyResult and
// applyReviewResult, so it's the correct signal for "did I do anything
// with this word recently."
function matchesDateFilter(p: WordProgress | undefined, filter: DateFilter, t: string): boolean {
  if (filter === 'all') return true;
  if (!p?.lastPracticed) return false;
  if (filter === 'today') return p.lastPracticed === t;
  const windowDays = filter === '7days' ? 7 : 30;
  return daysBetween(p.lastPracticed, t) < windowDays;
}

// Most words don't have a pre-generated illustration yet — render nothing
// (rather than a broken-image icon) when the file 404s.
function WordThumbnail({ word }: { word: Word }) {
  const [failed, setFailed] = useState(false);
  // Checked against the build-time manifest first (see
  // lib/wordImageManifest.ts) so the ~70% of rows with no illustration
  // never even issue a request for one — `failed` remains only as a
  // defensive fallback if the manifest and actual files ever drift.
  if (!WORDS_WITH_IMAGES.has(word.id) || failed) return null;
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

// Applies a starting filter value from the URL's own query string —
// plain window.location rather than Next's useSearchParams, specifically
// to avoid the Suspense-boundary requirement that hook needs under
// `output: 'export'`. Called from a useEffect below rather than a lazy
// useState initializer — confirmed real: reaching this page via a
// same-origin <Link> (as opposed to a full page load/typed URL) could
// leave a param like `familiarity` not applied even though `date` was,
// which points at Next's client-side navigation/prefetch not
// guaranteeing window.location is what a mount-time initializer sees;
// reading it in an effect (which only ever runs after the browser's own
// URL is definitely settled) sidesteps that entirely. No-op (returns
// false) if the param is absent or doesn't match one of the real option
// values — the return lets a caller fall back to some other real-settings
// read of its own only when the URL didn't actually specify anything.
function applyParam<T extends string>(key: string, valid: readonly T[], setter: (v: T) => void): boolean {
  const v = new URLSearchParams(window.location.search).get(key);
  if (v !== null && (valid as readonly string[]).includes(v)) { setter(v as T); return true; }
  return false;
}

// Stamps a freshly-added word straight to "Introduced" (mascotStage
// 'puppy') the moment it's added, rather than leaving it with no progress
// at all until it happens to come up in a future study session —
// addCustomWord only ever wrote the vocabulary record itself, never a
// WordProgress row, so without this a newly-added word looked identical
// to a plain "New" corpus word and wouldn't enter the review rotation
// until manually studied first. recordMilestonePass is the exact same
// helper a real Day-1 study pass uses to make this transition, so a
// freshly-added word gets a real nextReviewDue and counts identically to
// one introduced the normal way — same pipeline, no separate handling
// needed anywhere else (see lib/practice.ts's allWordsForLevel/
// buildReviewWords, which key off mascotStage regardless of how a word
// got it).
function addCustomWordIntroduced(word: Word): void {
  addCustomWord(word);
  saveWordProgress(recordMilestonePass(getWordProgress(word.id), 'puppy'));
}

type View = 'search' | 'myWords';

export default function WordsPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>('search');
  const [filterFamiliarity, setFilterFamiliarity] = useState<Familiarity>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  // nativeLanguage starts at DEFAULT_SETTINGS' own value (not a lazy
  // getSettings() read) and gets corrected in the effect below instead —
  // confirmed real: reading real localStorage directly in a useState
  // initializer or the render body renders DIFFERENT word-list text on
  // this static-export page's build-time prerender (no window, so
  // DEFAULT_SETTINGS) than on the client's first real render (real
  // localStorage) whenever a learner's actual settings differ from the
  // defaults, which is exactly what a React hydration-mismatch error is —
  // the effect's update happens safely AFTER hydration instead.
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>('en');
  const [activeLevel, setActiveLevel] = useState<Level>('A1');
  // Bumped on every add/remove so `customWords` below (which reads fresh
  // from storage each time, not from React state) actually recomputes —
  // storage.ts's add/removeCustomWord aren't themselves reactive, same
  // reason PROGRESS_CHANGED_EVENT exists elsewhere, just simpler to force
  // locally here since this page is the only thing that needs to react.
  const [customWordsVersion, setCustomWordsVersion] = useState(0);
  // The "look up & add" flow's own state — a separate small piece of UI
  // triggered when a search matches nothing anywhere (see
  // searchMatchesAnything below), entirely independent of the list state.
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'loading' | 'not-found' | 'error' | 'limit-reached' | 'unreachable'>('idle');
  const [lookupResult, setLookupResult] = useState<LookupWordResult | null>(null);
  // Generated the moment a lookup succeeds (not a shared placeholder) --
  // real bug caught live: a fixed "custom-preview" id for every lookup
  // meant tapping the preview's speaker on ONE word, then previewing a
  // DIFFERENT word and tapping again, would incorrectly inherit the
  // first word's cached audio (fixed by blocking generation for previews
  // entirely) -- but that just traded one bug for a worse regression: the
  // preview's speaker became permanently unable to ever get real audio,
  // stuck on the same flaky browser fallback on every single tap (exactly
  // what further reports kept catching). A real, unique id per lookup
  // fixes the actual problem instead: generation is safe again (nothing
  // to collide with), and handleAddWord below reuses this same id rather
  // than minting a second one, so a preview that already got its audio
  // generated doesn't need to regenerate it after adding.
  const [lookupResultId, setLookupResultId] = useState<string | null>(null);

  // Learner-added words across EVERY book, read fresh from storage —
  // kept as its own STATE (populated only inside an effect below), never
  // read directly during render, for the same reason nativeLanguage above
  // isn't a lazy getSettings() read either: this page prerenders at build
  // time with no window at all, so a live localStorage read sitting
  // directly in a memo would make the client's very first render
  // disagree with that prerendered HTML the instant any custom word
  // actually exists. Starting empty here matches the prerender exactly;
  // the effect's update then lands safely AFTER hydration completes.
  // Needed in BOTH views now — Search mode checks it to mark a match
  // "Already in my words", not just the My Words tab itself.
  const [customWords, setCustomWords] = useState<Word[]>([]);

  useEffect(() => {
    setNativeLanguage(getSettings().nativeLanguage);
    setActiveLevel(getSettings().level);
    applyParam('familiarity', ['all', 'new', 'learning', 'mastered'], setFilterFamiliarity);
    applyParam('date', ['all', 'today', '7days', '30days'], setDateFilter);
  }, []);

  useEffect(() => {
    setCustomWords(getAllCustomWordsAcrossLevels());
  }, [customWordsVersion]);

  useEffect(() => {
    const load = () => setProgress(getMergedProgressAcrossLevels());
    load();
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
  }, []);

  const t = today();
  const q = search.toLowerCase();
  const earned = (p?: WordProgress) => !!p && p.studiedTimes > 0;

  // Every corpus word across all 4 books, plus every custom word already
  // added anywhere — the full pool Search mode ranks against. "No matter
  // it's from our vocab book or not" is the owner's own framing for why
  // this doesn't stay scoped to a single book the way browsing used to.
  const searchPool = useMemo(
    () => [...WORDS.filter(w => (BOOK_LEVELS as string[]).includes(w.level)), ...customWords],
    [customWords],
  );

  const searchResults = useMemo(() => {
    if (view !== 'search' || !search.trim()) return [];
    return searchPool
      .map(w => ({ w, rank: searchRank(w, q, nativeLanguage) }))
      .filter((x): x is { w: Word; rank: number } => x.rank !== null)
      .sort((a, b) => a.rank - b.rank)
      .map(x => x.w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search, searchPool, nativeLanguage]);

  const myWordsList = useMemo(() => {
    if (view !== 'myWords') return [];
    return customWords
      .filter(w => {
        const p = progress[w.id];
        if (!matchesFamiliarity(p, filterFamiliarity)) return false;
        if (!matchesDateFilter(p, dateFilter, t)) return false;
        return true;
      })
      .sort((a, b) => a.de.localeCompare(b.de, 'de'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, customWords, progress, filterFamiliarity, dateFilter]);

  // Whether the search itself (ignoring the familiarity/date filters,
  // which are orthogonal display narrowing, not "does this word exist at
  // all") found anything anywhere — this, not `searchResults.length === 0`,
  // is what should gate the "look up & add" offer below, so it never
  // appears just because e.g. "Mastered" happens to hide every real match.
  const searchMatchesAnything = search.trim() !== '' && searchPool.some(w => searchRank(w, q, nativeLanguage) !== null);

  // Auto-fires the AI lookup once a search comes up empty locally, instead
  // of making the learner notice there's no match and tap a button to
  // start it — debounced 600ms past the last keystroke so a word typed
  // out letter by letter doesn't fire a real AI call (and eat into the
  // daily cap) for every incomplete prefix along the way. Guards on
  // lookupStatus/lookupResult too, or a successful result flipping status
  // back to 'idle' would immediately re-trigger itself in a loop.
  useEffect(() => {
    const term = search.trim();
    if (view !== 'search' || !term || searchMatchesAnything || lookupStatus !== 'idle' || lookupResult) return;
    const timer = setTimeout(() => handleLookup(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search, searchMatchesAnything, lookupStatus, lookupResult]);

  function handleLookup() {
    const term = search.trim();
    if (!term) return;
    setLookupStatus('loading');
    setLookupResult(null);
    setLookupResultId(null);
    lookupWord(term, activeLevel)
      .then(result => {
        if (!result) { setLookupStatus('not-found'); return; }
        setLookupResult(result);
        setLookupResultId(newCustomWordId());
        setLookupStatus('idle');
      })
      .catch(e => {
        if (e instanceof AIUnreachableError) { setLookupStatus('unreachable'); return; }
        setLookupStatus(e instanceof DailyLimitReachedError ? 'limit-reached' : 'error');
      });
  }

  // From the AI lookup flow — a word that doesn't exist in the corpus at
  // all. Filed under the learner's own ACTIVE study level (not whatever
  // book might have been browsed before this redesign) so it's reviewed
  // together with the book they're actually working through right now.
  function handleAddWord(result: LookupWordResult) {
    // Reuses the id already minted for the preview (see lookupResultId's
    // own comment) rather than generating a fresh one -- if the learner
    // already tapped the preview's speaker, this is the SAME id that
    // audio was cached under, so it's picked up immediately with no
    // second generation call needed.
    const word: Word = { ...result, id: lookupResultId ?? newCustomWordId(), level: activeLevel };
    addCustomWordIntroduced(word);
    setCustomWordsVersion(v => v + 1);
    setLookupResult(null);
    setLookupResultId(null);
    setLookupStatus('idle');
    setSearch('');
    scheduleSync();
    // Fire-and-forget, deliberately not awaited — the word is fully usable
    // via the browser-TTS fallback (see lib/speech.ts) the moment it's
    // added regardless of how this turns out; this just upgrades it to a
    // real cached clip a few seconds later, same voice as the curated
    // corpus, once it's ready (or is already there, if the preview's own
    // speaker already generated it -- generateWordAudio upserts, so
    // calling it again here is harmless either way). A failure here
    // (network hiccup, daily cap) silently leaves the browser-TTS
    // fallback as the permanent behavior for this word — never surfaced
    // as an error, since nothing actually broke.
    generateWordAudio(word.id, spokenForm(word));
  }

  // From a search match that's a REAL corpus word, but from a book other
  // than the one actively being studied — clones it into a fresh custom
  // word filed under the active level, so it joins the same review
  // rotation. A match already in the active level's own book is left
  // alone entirely (see SearchResultRow below) — the normal study
  // schedule already covers it, nothing to add.
  function handleAddFromOtherBook(w: Word) {
    const cloned: Word = { ...w, id: newCustomWordId(), level: activeLevel };
    addCustomWordIntroduced(cloned);
    setCustomWordsVersion(v => v + 1);
    scheduleSync();
    generateWordAudio(cloned.id, spokenForm(cloned));
  }

  function handleRemoveWord(w: Word) {
    if (!window.confirm(`Remove "${w.de}" from your words? Any progress on it will be lost too.`)) return;
    removeCustomWord(w.id);
    setCustomWordsVersion(v => v + 1);
    scheduleSync();
  }

  // The progress/mascot side of a row — identical for My Words items and
  // already-added search matches, so both call sites below share it
  // rather than duplicating the mascot/"New" pill markup.
  function ProgressBadge({ w }: { w: Word }) {
    return (
      <span className="shrink-0 w-20 flex flex-col items-center gap-0.5">
        {earned(progress[w.id]) ? (
          <>
            <DachshundMascot stage={progress[w.id].mascotStage ?? 'puppy'} className="w-11 h-11" />
            <span className="text-[10px] font-medium text-ink-soft whitespace-nowrap">
              {STAGE_LABEL[progress[w.id].mascotStage ?? 'puppy']}
            </span>
            {!progress[w.id].fullyMastered && (
              <span className="text-[10px] text-ink-soft whitespace-nowrap">
                {reviewLabel(progress[w.id].nextReviewDue)}
              </span>
            )}
          </>
        ) : (
          <span className="flex items-center justify-center px-2.5 py-1.5 rounded-full bg-paper-dim">
            <span className="text-xs font-medium text-ink-soft">New</span>
          </span>
        )}
      </span>
    );
  }

  function WordMeta({ w, showBook }: { w: Word; showBook: boolean }) {
    return (
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-ink">
          {w.article ? `${w.article} ` : ''}{w.de}
        </span>
        <SpeakerButton word={w} className="ml-1.5 text-label hover:text-ink transition-colors align-middle" />
        {w.plural && <span className="text-ink-soft text-sm ml-2">· {w.plural}</span>}
        {showBook && (
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-ink-soft bg-paper-dim rounded-full px-2 py-0.5 align-middle">
            {w.level}
          </span>
        )}
        {isCustomWordId(w.id) && (
          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-label bg-accent/15 rounded-full px-2 py-0.5 align-middle">
            My word
          </span>
        )}
        <div className="text-ink-soft text-sm">{glossFor(w, nativeLanguage)}</div>
      </div>
    );
  }

  // My Words tab — unchanged from before: a plain browsable/manageable
  // list of everything the learner has added, across every book.
  function MyWordsRow({ w }: { w: Word }) {
    return (
      <div className="bg-paper/75 backdrop-blur-sm rounded-xl border border-paper-line/50 shadow-sm px-4 py-3 flex items-center gap-3">
        <WordMeta w={w} showBook />
        <WordThumbnail word={w} />
        <ProgressBadge w={w} />
        <button
          onClick={() => handleRemoveWord(w)}
          aria-label={`Remove ${w.de} from your words`}
          className="shrink-0 self-start text-ink-soft hover:text-clay transition-colors text-lg leading-none px-1"
        >
          ×
        </button>
      </div>
    );
  }

  // Search tab — a match is either already yours in some form (already a
  // custom word, or a real word from the book you're actively studying),
  // in which case there's nothing to do but show its existing progress,
  // or it's a real word from a DIFFERENT book, which gets an explicit
  // "Add to my words" action (see handleAddFromOtherBook).
  function SearchResultRow({ w }: { w: Word }) {
    const alreadyCustom = isCustomWordId(w.id);
    const inActiveBook = !alreadyCustom && w.level === activeLevel;
    const addable = !alreadyCustom && !inActiveBook;
    return (
      <div className="bg-paper/75 backdrop-blur-sm rounded-xl border border-paper-line/50 shadow-sm px-4 py-3 flex items-center gap-3">
        <WordMeta w={w} showBook={!alreadyCustom} />
        <WordThumbnail word={w} />
        {addable ? (
          <button
            onClick={() => handleAddFromOtherBook(w)}
            className="shrink-0 bg-accent text-white text-xs px-3 py-2 rounded-lg font-semibold hover:bg-accent-deep active:scale-95 transition-all"
          >
            Add to my words
          </button>
        ) : (
          <div className="shrink-0 flex flex-col items-center gap-1">
            {inActiveBook && (
              <span className="text-[10px] font-medium text-ink-soft whitespace-nowrap">In your book</span>
            )}
            <ProgressBadge w={w} />
            {alreadyCustom && (
              <button
                onClick={() => handleRemoveWord(w)}
                aria-label={`Remove ${w.de} from your words`}
                className="text-ink-soft hover:text-clay transition-colors text-xs"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Word List</h1>

      <div className="flex gap-1 bg-paper-dim/70 backdrop-blur-sm rounded-full p-1 self-start">
        {(['search', 'myWords'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`text-sm font-semibold px-4 py-1.5 rounded-full transition-colors ${
              view === v ? 'bg-accent-deep text-white' : 'text-on-bg/70 hover:text-on-bg'
            }`}
          >
            {v === 'search' ? 'Search' : 'My Words'}
          </button>
        ))}
      </div>

      {view === 'search' && (
        <input
          type="search"
          autoFocus
          placeholder="Search any German or English word to add it…"
          value={search}
          onChange={e => { setSearch(e.target.value); setLookupStatus('idle'); setLookupResult(null); setLookupResultId(null); }}
          className="bg-paper/75 backdrop-blur-sm border-2 border-white/30 rounded-xl px-4 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent"
        />
      )}

      {/* Familiarity/date filters only make sense for browsing the full My
          Words list — Search mode is a single-word lookup (usually just a
          few results), so these dropdowns were pure clutter there and have
          been dropped for that view entirely. A fixed 2-column grid — each
          select always takes exactly half the row and shrinks to fit,
          rather than wrapping individually once their combined intrinsic
          width happens to exceed the row on a given screen. min-w-0 lets a
          grid item actually shrink below its content's natural width
          instead of overflowing the cell. */}
      {view === 'myWords' && (
        <div className="grid grid-cols-2 gap-1.5">
          <select
            value={filterFamiliarity}
            onChange={e => setFilterFamiliarity(e.target.value as Familiarity)}
            className="min-w-0 bg-paper/75 backdrop-blur-sm border border-white/30 rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-accent"
          >
            <option value="all">All words</option>
            <option value="new">New</option>
            <option value="learning">Learning</option>
            <option value="mastered">Mastered</option>
          </select>

          <select
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value as DateFilter)}
            className="min-w-0 bg-paper/75 backdrop-blur-sm border border-white/30 rounded-lg px-2 py-1.5 text-xs text-ink focus:outline-none focus:border-accent"
          >
            <option value="all">All days</option>
            <option value="today">Today</option>
            <option value="7days">Past 7 days</option>
            <option value="30days">Past 30 days</option>
          </select>
        </div>
      )}

      {view === 'search' && !search.trim() && (
        <p className="text-on-bg/70 text-sm text-center py-8">
          Search for a word — from any of the books, or completely new — to add it to your studies.
        </p>
      )}

      {/* "Look up & add" — only offered once the search itself has come up
          empty everywhere (see searchMatchesAnything's own comment) — a
          learner who already has matches to look at shouldn't be nudged
          to add a duplicate. The lookup fires automatically (see the
          debounced effect above) rather than waiting on a button tap. */}
      {view === 'search' && search.trim() !== '' && !searchMatchesAnything && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-xl border border-paper-line/50 shadow-sm px-4 py-3 flex flex-col gap-2.5">
          {!lookupResult && (
            <>
              {(lookupStatus === 'idle' || lookupStatus === 'loading') && (
                <p className="text-ink-soft text-sm flex items-center gap-2">
                  <span className="inline-block w-3.5 h-3.5 border-2 border-accent/50 border-t-indigo-600 rounded-full animate-spin shrink-0" />
                  Searching for "{search.trim()}"…
                </p>
              )}
              {lookupStatus === 'not-found' && (
                <p className="text-ink-soft text-sm">
                  Couldn't find a German word or translation for "{search.trim()}" — check the spelling, or try a different word.
                </p>
              )}
              {lookupStatus === 'limit-reached' && (
                <p className="text-label text-sm">Used up today's AI lookups — come back tomorrow.</p>
              )}
              {(lookupStatus === 'error' || lookupStatus === 'unreachable') && (
                <div className="flex items-center gap-2">
                  <p className="text-clay text-sm">Couldn't look that up right now.</p>
                  <button onClick={handleLookup} className="text-label text-sm font-semibold underline shrink-0">Try again</button>
                </div>
              )}
            </>
          )}
          {lookupResult && lookupResultId && (
            <>
              {/* A real, unique "custom-" id (see lookupResultId's own
                  comment) rather than a shared placeholder -- generating
                  real audio for the preview is safe now (nothing to
                  collide with), and WordInfoPanel's own "My word" vs
                  "from LEVEL" badge reads correctly since it's already a
                  genuine custom id. handleAddWord reuses this exact id. */}
              <WordInfoPanel
                word={{ ...lookupResult, id: lookupResultId, level: activeLevel }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleAddWord(lookupResult)}
                  className="flex-1 bg-accent text-white text-sm px-4 py-2 rounded-lg font-semibold hover:bg-accent-deep active:scale-95 transition-all"
                >
                  Add to my words
                </button>
                <button
                  onClick={() => { setLookupResult(null); setLookupResultId(null); setLookupStatus('idle'); }}
                  className="text-ink-soft text-sm px-3 py-2"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {view === 'search' && search.trim() !== '' && (
        <>
          <p className="text-on-bg/70 text-sm">{searchResults.length} match{searchResults.length === 1 ? '' : 'es'}</p>
          <div className="flex flex-col gap-2">
            {searchResults.map(w => <SearchResultRow key={w.id} w={w} />)}
          </div>
        </>
      )}

      {view === 'myWords' && (
        <>
          <p className="text-on-bg/70 text-sm">{myWordsList.length} word{myWordsList.length === 1 ? '' : 's'}</p>
          {myWordsList.length === 0 ? (
            <p className="text-on-bg/70 text-sm text-center py-8">
              Nothing here yet — search for a word and add it to see it in this list.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {myWordsList.map(w => <MyWordsRow key={w.id} w={w} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
