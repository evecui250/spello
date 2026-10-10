'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSettings, saveSettings, switchToLevel, getImportedBooks, levelDisplayName, ImportedBook, removeImportedBook, setImportedBookLevel, myCefrLevels, otherCefrLevels, addCefrLevel, hideCefrLevel, clearAllProgress, resetEverything, Settings, getTheme, saveTheme, Theme, getFontScale, saveFontScale, FontScale, getSoundChoice, getCardMode, saveCardMode, CardMode } from '../../lib/storage';
import { THEME_CONFIG } from '../../components/AppBackground';
import { daysToWeeks, estimateProgressForecast, recommendedDailyReview, resizeTodayStudyBatch, allWordsForLevel } from '../../lib/practice';
import { Level, CefrLevel, LEVEL_SOURCE, isCefrLevel, isBookLevelId } from '../../lib/words';
import { shareImportedBook } from '../../lib/bookImport';
import { scheduleSync, syncNow, SYNCED_EVENT } from '../../lib/sync';
import { CHIME_OPTIONS } from '../../lib/sound';
import AccountPanel from '../../components/AccountPanel';
import BugReportButton from '../../components/BugReportButton';
import SoundPicker from '../../components/SoundPicker';
import ImportBookModal, { BookCodeDisplay } from '../../components/ImportBookModal';
import JoinBookModal from '../../components/JoinBookModal';
import CefrLevelSelect from '../../components/CefrLevelSelect';
import BookList from '../../components/BookList';
import { supabase } from '../../lib/supabase';

// Purely cosmetic — just decides whether to show the "Admin" link at all.
// The real authorization check lives server-side, in admin-stats' own
// ADMIN_EMAIL comparison; showing this link to the wrong person would at
// worst send them to a page that immediately says "not authorized".
const ADMIN_EMAIL = 'evecui250@gmail.com';

const FONT_LABEL: Record<FontScale, string> = { small: 'Small', default: 'Default', large: 'Large' };

// Profile is a short menu; each row opens one of these as its own screen
// (/settings?section=…), so the phone's back gesture returns to the menu.
type Section = 'account' | 'books' | 'learning' | 'appearance' | 'help';
const SECTIONS: Section[] = ['account', 'books', 'learning', 'appearance', 'help'];

function MenuRow({ icon, title, detail, onClick }: { icon: string; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-paper-dim/40 active:bg-paper-dim/60 transition-colors"
    >
      <span className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center text-lg shrink-0" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-ink-soft text-sm truncate">{detail}</span>
      </span>
      <span className="text-ink-soft text-xl leading-none shrink-0" aria-hidden>›</span>
    </button>
  );
}

// useSearchParams needs a Suspense boundary in a statically exported page.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSection = searchParams.get('section');
  const section: Section | null = (SECTIONS as string[]).includes(rawSection ?? '') ? (rawSection as Section) : null;
  const openSection = (s: Section) => { router.push(`/settings?section=${s}`); window.scrollTo(0, 0); };
  const closeSection = () => { router.push('/settings'); window.scrollTo(0, 0); };
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [studyBatchSize, setStudyBatchSize] = useState(5);
  const [dailyReview, setDailyReview] = useState(15);
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>('en');
  const [level, setLevel] = useState<Level>('A1');
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [wordRepeatCount, setWordRepeatCount] = useState(1);
  const [requireArticle, setRequireArticle] = useState(false);
  const [sentenceWritingMode, setSentenceWritingMode] = useState(true);
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  // Reset lives behind a text link (same style/place as "Report a
  // problem") rather than a standing red card, opening a small modal to
  // pick which kind of reset — a tester reported mis-tapping a prominent
  // on-page danger-zone button. window.confirm() inside each handler
  // below is still a second, final confirmation layer on top of this.
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [showPaceInfo, setShowPaceInfo] = useState(false);
  const [theme, setTheme] = useState<Theme>('forest');
  const [cardMode, setCardMode] = useState<CardMode>('auto');
  const [fontScale, setFontScale] = useState<FontScale>('default');
  const [soundName, setSoundName] = useState('Triad Bloom');
  const [importOpen, setImportOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // Read after mount (not during render) so the first client render matches
  // the prerendered page; refreshed whenever the book or book list changes.
  const [myLevels, setMyLevels] = useState<CefrLevel[]>([]);
  const [otherLevels, setOtherLevels] = useState<CefrLevel[]>([]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [importedBooks, setImportedBooks] = useState<ImportedBook[]>([]);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applySettings = (s: Settings) => {
    setStudyBatchSize(s.studyBatchSize);
    setDailyReview(s.dailyReview);
    setNativeLanguage(s.nativeLanguage);
    setLevel(s.level);
    setAutoPlayAudio(s.autoPlayAudio);
    setWordRepeatCount(s.wordRepeatCount ?? 1);
    setRequireArticle(s.requireArticle);
    setSentenceWritingMode(s.sentenceWritingMode);
  };

  const loadFromStorage = () => applySettings(getSettings());

  useEffect(loadFromStorage, []);
  useEffect(() => {
    setMyLevels(myCefrLevels());
    setOtherLevels(otherCefrLevels());
  }, [level, importedBooks]);

  // Re-read after a sync too — a book imported on another device only
  // shows up here once pullAndMerge has brought its registry entry down.
  useEffect(() => {
    const load = () => setImportedBooks(getImportedBooks());
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => window.removeEventListener(SYNCED_EVENT, load);
  }, []);
  useEffect(() => setTheme(getTheme()), []);
  useEffect(() => setCardMode(getCardMode()), []);
  useEffect(() => setFontScale(getFontScale()), []);
  useEffect(() => {
    const choice = getSoundChoice();
    setSoundName(CHIME_OPTIONS.find(o => o.id === choice)?.name ?? 'Triad Bloom');
  }, []);

  const handleFontScaleChange = (s: FontScale) => {
    setFontScale(s);
    saveFontScale(s);
  };

  const handleThemeChange = (t: Theme) => {
    setTheme(t);
    saveTheme(t);
  };

  const handleCardModeChange = (m: CardMode) => {
    setCardMode(m);
    saveCardMode(m);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Switching level is switching profiles entirely — separate progress,
  // streak, daily stats/session, and pace settings, with no bleed-through
  // in either direction. Unlike every other control here, this does NOT
  // merge the just-changed field into current React state (that would carry
  // this level's studyBatchSize/dailyReview/etc. into the new level's fresh
  // profile) — it loads whatever that level's own profile already has (or
  // its untouched defaults, first time).
  const handleLevelChange = (newLevel: Level) => {
    const s = switchToLevel(newLevel);
    applySettings(s);
    // Immediate, not the debounced scheduleSync — a level switch is a
    // discrete one-shot action (unlike a slider drag), so there's no rapid-
    // fire event volume to coalesce, and the sooner it reaches remote the
    // less chance of it getting lost if the tab closes shortly after.
    syncNow();
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  };
  // Re-derived from importedBooks state so a share/remove re-renders.
  const activeBook = isBookLevelId(level) ? importedBooks.find(b => b.id === level) : undefined;

  async function handleShareActiveBook() {
    if (!activeBook) return;
    setSharing(true);
    setShareError(null);
    try {
      await shareImportedBook(activeBook.id);
      setImportedBooks(getImportedBooks());
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Couldn't create a code.");
    } finally {
      setSharing(false);
    }
  }

  // Swipe-to-remove. A Spello level is only hidden from the list (its
  // progress stays and returns if it's added again); an imported book is
  // deleted with its progress. You always keep at least one book, and
  // removing the one you're studying moves you to the next in the list.
  function handleRemoveBook(id: Level) {
    const all: Level[] = [...myLevels, ...importedBooks.map(b => b.id)];
    if (all.length <= 1) {
      window.alert('You need at least one book. Add another book first, then remove this one.');
      return;
    }
    const book = isBookLevelId(id) ? importedBooks.find(b => b.id === id) : undefined;
    if (book) {
      const note = book.shareCode ? ' Classmates who joined with its code keep their copy.' : '';
      if (!window.confirm(`Remove “${book.name}” and your progress on its words? This can't be undone.${note}`)) return;
      removeImportedBook(book.id);
    } else if (isCefrLevel(id)) {
      if (!window.confirm(`Remove ${id} from your books? Your progress is kept — add ${id} again any time to continue.`)) return;
      hideCefrLevel(id);
    }
    if (id === level) {
      const next = all.find(l => l !== id)!;
      handleLevelChange(next);
    } else {
      applySettings(getSettings());
    }
    setImportedBooks(getImportedBooks());
    setMyLevels(myCefrLevels());
    setOtherLevels(otherCefrLevels());
    syncNow();
  }



  // Recomputed live as the sliders move, so the user can see the effect of
  // a pace change immediately.
  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize, dailyReview),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studyBatchSize, dailyReview, cleared],
  );

  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize),
    [studyBatchSize],
  );

  // Every control saves immediately on change — no separate Save step.
  // Callers pass the field(s) that just changed; everything else comes
  // from current state, which is already up to date by the time this runs.
  const persist = (patch: Partial<Settings>) => {
    const next: Settings = {
      studyBatchSize, dailyReview, language: 'de', nativeLanguage, level, autoPlayAudio, wordRepeatCount, requireArticle,
      sentenceWritingMode, ...patch,
    };
    saveSettings(next);
    // Review's daily pool is always computed fresh from due words, so a
    // dailyReview change is already instant. Study's batch is fixed for the
    // day once drawn, so it needs an explicit resize to feel the change today.
    if (patch.studyBatchSize !== undefined) resizeTodayStudyBatch(patch.studyBatchSize);
    scheduleSync();
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  };

  const handleClearAll = async () => {
    if (!window.confirm(`This will erase all learning progress for the ${levelDisplayName(level)} level — every word starts over. Other levels, and your account-wide streak/goal days, aren't affected. This can't be undone. Continue?`)) return;
    clearAllProgress();
    // Awaited and immediate (not the debounced scheduleSync) — this is a
    // destructive action, so the cleared state needs to actually reach
    // remote before the user can navigate away, or a later sign-in sync
    // pull would resurrect the "removed" progress from the still-stale
    // remote row.
    await syncNow();
    setCleared(true);
    setTimeout(() => {
      setCleared(false);
      setResetModalOpen(false);
    }, 2000);
  };

  // Every level, plus onboarding — equivalent to a brand-new signed-in
  // account. Same immediate-push reasoning as handleClearAll, then routes
  // straight to onboarding since that's genuinely where a fresh account
  // lands next.
  const handleResetEverything = async () => {
    if (!window.confirm('This will erase ALL progress, streaks, and settings for EVERY level — your account will start over completely, as if brand new. You\'ll stay signed in. This can\'t be undone. Continue?')) return;
    resetEverything();
    await syncNow();
    setResetModalOpen(false);
    router.push('/welcome');
  };

  const SECTION_TITLES: Record<Section, string> = {
    account: 'Account', books: 'Books & level', learning: 'Learning', appearance: 'Appearance', help: 'Help & about',
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        {section ? (
          <button
            type="button"
            onClick={closeSection}
            className="flex items-center gap-2 text-on-bg hover:text-on-bg/80 transition-colors min-w-0"
          >
            <span className="text-2xl leading-none">‹</span>
            <h1 className="text-2xl font-bold truncate" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{SECTION_TITLES[section]}</h1>
          </button>
        ) : (
          <h1 className="text-2xl font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Profile</h1>
        )}
        <span className={`text-sm font-medium text-good transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>
          ✓ Saved
        </span>
      </div>

      {/* The menu: one row per area, each opening its own screen — like
          other apps' settings, instead of every control on one long page
          (real feedback: too crowded, everything needed scrolling). */}
      {!section && (
        <>
          <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm divide-y divide-paper-line/60 overflow-hidden">
            <MenuRow icon="👤" title="Account" detail={signedInEmail ?? 'Sign in to sync across devices'} onClick={() => openSection('account')} />
            <MenuRow icon="📚" title="Books & level" detail={`${levelDisplayName(level)} · ${allWordsForLevel(level).length} words`} onClick={() => openSection('books')} />
            <MenuRow icon="✏️" title="Learning" detail={`${studyBatchSize} new · up to ${dailyReview} reviews a day`} onClick={() => openSection('learning')} />
            <MenuRow icon="🎨" title="Appearance" detail={`${theme[0].toUpperCase()}${theme.slice(1)} · ${FONT_LABEL[fontScale]} text · ${soundName}`} onClick={() => openSection('appearance')} />
            <MenuRow icon="💬" title="Help & about" detail="Welcome guide, report a problem, privacy" onClick={() => openSection('help')} />
          </div>
      <button
        type="button"
        onClick={() => setResetModalOpen(true)}
        className="text-center bg-clay/15 backdrop-blur-sm rounded-2xl border border-clay shadow-sm p-4 font-semibold text-clay hover:bg-clay/25 transition-colors"
      >
        Reset account
      </button>
          {signedInEmail === ADMIN_EMAIL && (
            <Link href="/admin" className="text-center text-sm text-on-bg/75 hover:text-on-bg underline">Admin</Link>
          )}
        </>
      )}

      {section === 'account' && (
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-4">
        <AccountPanel onSync={loadFromStorage} />
      </div>
      )}

      {section === 'books' && (
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-ink">My books</span>
          <button
            type="button"
            onClick={() => setAddSheetOpen(true)}
            aria-label="Add a book"
            className="w-9 h-9 rounded-full bg-accent text-white text-2xl leading-none flex items-center justify-center hover:bg-accent-deep active:scale-95 transition-all"
          >
            +
          </button>
        </div>
        <BookList
          items={[
            ...myLevels.map(l => ({
              id: l as string,
              title: `${l} vocabulary`,
              subtitle: `${allWordsForLevel(l).length} words · ${LEVEL_SOURCE[l] ?? 'Spello'}`,
              active: level === l,
            })),
            ...importedBooks.map(b => ({
              id: b.id as string,
              title: b.name,
              subtitle: `${allWordsForLevel(b.id).length} words · imported · your level ${b.cefrLevel ?? 'B1'}`,
              active: level === b.id,
            })),
          ]}
          onSelect={id => { if (id !== level) handleLevelChange(id as Level); }}
          onRemove={id => handleRemoveBook(id as Level)}
        />
        <p className="text-ink-soft text-xs -mt-1">Tap a book to study it. Swipe left on a book to remove it.</p>

        {/* The selected imported book's own settings. */}
        {activeBook && (
          <div className="border border-paper-line rounded-xl p-3 flex flex-col gap-2">
            <span className="text-sm font-semibold text-ink truncate">{activeBook.name}</span>
            <label className="flex items-center justify-between gap-3 text-sm text-ink">
              <span>Your level for this book <span className="block text-ink-soft text-xs">How hard its sentences, paragraphs and chat are</span></span>
              <CefrLevelSelect
                value={activeBook.cefrLevel ?? 'B1'}
                onChange={l => { setImportedBookLevel(activeBook.id, l); setImportedBooks(getImportedBooks()); scheduleSync(); }}
              />
            </label>
            {activeBook.shareCode ? (
              <>
                <span className="text-ink-soft text-xs">Book code — classmates add it with + → “Join with a book code”:</span>
                <BookCodeDisplay code={activeBook.shareCode} />
              </>
            ) : (
              <button
                type="button"
                onClick={handleShareActiveBook}
                disabled={sharing}
                className="self-start text-sm font-semibold text-label hover:text-ink underline underline-offset-2 disabled:opacity-50"
              >
                {sharing ? 'Creating code…' : 'Share this book with a code'}
              </button>
            )}
            {shareError && <span className="text-clay text-xs">{shareError}</span>}
            <span className="text-ink-soft text-xs">
              {activeBook.sourcePages ? `From PDF pages ${activeBook.sourcePages}` : 'Added with a book code'}
            </span>
          </div>
        )}
      </div>
      )}

      {addSheetOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setAddSheetOpen(false)}>
          <div className="w-full max-w-sm bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3" style={{ marginBottom: 'var(--safe-bottom)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink">Add a book</h2>
              <button type="button" onClick={() => setAddSheetOpen(false)} aria-label="Close" className="text-ink-soft hover:text-ink text-xl leading-none">×</button>
            </div>
            {otherLevels.length > 0 && (
              <>
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Spello books</span>
                <div className="grid grid-cols-2 gap-2">
                  {otherLevels.map(l => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => { addCefrLevel(l); setAddSheetOpen(false); handleLevelChange(l); }}
                      className="text-left rounded-xl border border-paper-line px-3 py-2.5 hover:bg-paper-dim/50 transition-colors"
                    >
                      <span className="block font-semibold text-ink">{l}</span>
                      <span className="block text-ink-soft text-xs">{allWordsForLevel(l).length} words</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft mt-1">Your own</span>
            <button
              type="button"
              onClick={() => { setAddSheetOpen(false); setImportOpen(true); }}
              className="text-left rounded-xl border border-paper-line px-3 py-2.5 hover:bg-paper-dim/50 transition-colors"
            >
              <span className="block font-semibold text-ink">Import from a PDF</span>
              <span className="block text-ink-soft text-xs">Pick the vocabulary pages of your coursebook</span>
            </button>
            <button
              type="button"
              onClick={() => { setAddSheetOpen(false); setJoinOpen(true); }}
              className="text-left rounded-xl border border-paper-line px-3 py-2.5 hover:bg-paper-dim/50 transition-colors"
            >
              <span className="block font-semibold text-ink">Join with a book code</span>
              <span className="block text-ink-soft text-xs">Get the same book as your class</span>
            </button>
          </div>
        </div>,
        document.body,
      )}

      {section === 'learning' && (
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-6">
        <div>
          <label className="block font-semibold text-ink mb-1">Learn with</label>
          <select
            value={nativeLanguage}
            onChange={e => {
              const v = e.target.value as 'en' | 'zh';
              setNativeLanguage(v);
              persist({ nativeLanguage: v });
            }}
            className="w-full border-2 border-accent/70 rounded-lg px-3 py-2 text-ink focus:outline-none focus:border-accent"
          >
            <option value="en">English</option>
            <option value="zh">中文 (Chinese)</option>
          </select>
          <p className="text-ink-soft text-sm mt-1">Word meanings and example sentences are shown in this language.</p>
        </div>

        <div>
          <label className="block font-semibold text-ink mb-1">
            New words per day
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={30} value={studyBatchSize}
              onChange={e => {
                const v = Number(e.target.value);
                setStudyBatchSize(v);
                persist({ studyBatchSize: v });
              }}
              className="flex-1 accent-accent"
            />
            <span className="w-8 text-center font-bold text-ink">{studyBatchSize}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-ink mb-1">
            Max review words per day
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={100} value={dailyReview}
              onChange={e => {
                const v = Number(e.target.value);
                setDailyReview(v);
                persist({ dailyReview: v });
              }}
              className="flex-1 accent-accent"
            />
            <span className="w-8 text-center font-bold text-ink">{dailyReview}</span>
          </div>
          {dailyReview !== recommendedReview && (
            <div className="flex items-center justify-between gap-2 mt-2 bg-paper-dim/60 rounded-lg px-3 py-2 text-sm">
              <span className="text-ink">
                Recommended: <strong>{recommendedReview}</strong> for a {studyBatchSize}/day study pace
              </span>
              <button
                onClick={() => { setDailyReview(recommendedReview); persist({ dailyReview: recommendedReview }); }}
                className="shrink-0 bg-accent text-white px-3 py-1 rounded-lg font-semibold text-xs hover:bg-accent-deep active:scale-95 transition-all"
              >
                Use {recommendedReview}
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <div className="bg-paper-dim/60 rounded-xl px-4 py-3 text-sm text-ink flex items-center justify-between gap-3">
            <span className="font-semibold shrink-0 inline-flex items-center gap-1.5">
              At this pace
              <button
                type="button"
                onClick={() => setShowPaceInfo(v => !v)}
                aria-label="How mastery works"
                className="w-4 h-4 rounded-full bg-ink-soft/70 text-white text-[10px] font-bold leading-none flex items-center justify-center hover:bg-ink-soft/70 transition-colors"
              >
                ?
              </button>
            </span>
            <span className="text-right">
              ~{daysToWeeks(forecast.daysToMasterAll)} weeks to master all
            </span>
          </div>
          {showPaceInfo && (
            <div className="absolute top-full left-0 mt-2 z-10 w-full bg-paper/95 backdrop-blur-sm border border-paper-line rounded-xl px-4 py-3 text-sm text-ink shadow-lg">
              Each word follows a fixed schedule instead of a score: review
              it 1 day after you learn it, 3 days after that, then 5 days
              after that — three reviews, about 9 days total, and
              it&apos;s fully mastered.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-ink">
              Auto-play pronunciation
            </label>
          </div>
          <input
            type="checkbox"
            checked={autoPlayAudio}
            onChange={e => { setAutoPlayAudio(e.target.checked); persist({ autoPlayAudio: e.target.checked }); }}
            className="w-5 h-5 accent-accent"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-ink">
              Audio repetition
            </label>
          </div>
          <select
            value={wordRepeatCount}
            onChange={e => {
              const v = Number(e.target.value);
              setWordRepeatCount(v);
              persist({ wordRepeatCount: v });
            }}
            className="border-2 border-accent/70 rounded-lg px-3 py-2 text-ink focus:outline-none focus:border-accent"
          >
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={3}>3×</option>
          </select>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-ink">
              Practice articles
            </label>
          </div>
          <input
            type="checkbox"
            checked={requireArticle}
            onChange={e => { setRequireArticle(e.target.checked); persist({ requireArticle: e.target.checked }); }}
            className="w-5 h-5 accent-accent"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-ink">
              Sentence writing mode
            </label>
          </div>
          <input
            type="checkbox"
            checked={sentenceWritingMode}
            onChange={e => { setSentenceWritingMode(e.target.checked); persist({ sentenceWritingMode: e.target.checked }); }}
            className="w-5 h-5 accent-accent shrink-0 ml-3"
          />
        </div>
      </div>
      )}

      {section === 'appearance' && (
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-6">
          <div className="flex flex-col gap-6">
            <div>
              <label className="block font-semibold text-ink mb-1">Theme</label>
              <p className="text-ink-soft text-sm mb-3">Changes the app's background.</p>
              <div className="grid grid-cols-5 gap-x-2 gap-y-3">
                {(Object.keys(THEME_CONFIG) as Theme[]).map(t => {
                  const cfg = THEME_CONFIG[t];
                  const isSelected = theme === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleThemeChange(t)}
                      className="flex flex-col items-center gap-1"
                    >
                      <span
                        className={`w-9 h-9 rounded-full bg-gradient-to-b ${cfg.gradient} transition-all ${
                          isSelected ? 'ring-2 ring-offset-2 ring-offset-amber-50 ring-accent scale-110' : 'ring-1 ring-black/10'
                        }`}
                      />
                      <span className={`text-[11px] font-medium capitalize ${isSelected ? 'text-label' : 'text-ink-soft'}`}>
                        {t}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-ink mb-1">Cards</label>
              <p className="text-ink-soft text-sm mb-3">Dims every card for reading comfortably at night. Auto follows your device's clock.</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'light', label: 'Day' },
                  { value: 'auto', label: 'Auto' },
                  { value: 'dark', label: 'Night' },
                ] as { value: CardMode; label: string }[]).map(opt => {
                  const isSelected = cardMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleCardModeChange(opt.value)}
                      className={`rounded-xl py-3 border-2 font-medium text-sm transition-colors ${
                        isSelected ? 'border-accent bg-accent/10 text-label' : 'border-paper-line text-ink-soft'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-ink mb-1">Font size</label>
              <p className="text-ink-soft text-sm mb-3">Changes the text size everywhere in the app.</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'small', label: 'Small', sample: 'text-sm' },
                  { value: 'default', label: 'Default', sample: 'text-base' },
                  { value: 'large', label: 'Large', sample: 'text-lg' },
                ] as { value: FontScale; label: string; sample: string }[]).map(opt => {
                  const isSelected = fontScale === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleFontScaleChange(opt.value)}
                      className={`flex flex-col items-center gap-1 rounded-xl py-3 border-2 transition-colors ${
                        isSelected ? 'border-accent bg-accent/10' : 'border-paper-line'
                      }`}
                    >
                      <span className={`font-bold text-ink ${opt.sample}`}>Aa</span>
                      <span className={`text-xs font-medium ${isSelected ? 'text-label' : 'text-ink-soft'}`}>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block font-semibold text-ink mb-1">Correct-answer sound</label>
              <p className="text-ink-soft text-sm mb-3">Plays when you spell, match, or translate a word correctly. Tap one to hear it.</p>
              <SoundPicker onChange={id => setSoundName(CHIME_OPTIONS.find(o => o.id === id)?.name ?? 'Triad Bloom')} />
            </div>
          </div>
      </div>
      )}

      {section === 'help' && (
        <>
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/welcome"
          className="text-center bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-4 font-semibold text-ink hover:bg-paper transition-colors"
        >
          View welcome guide
        </Link>
        <BugReportButton />
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        <Link href="/terms" className="text-on-bg/75 hover:text-on-bg underline">Terms of Service</Link>
        <Link href="/privacy" className="text-on-bg/75 hover:text-on-bg underline">Privacy Policy</Link>
      </div>
        </>
      )}

      {/* Portaled straight to <body>, same reasoning as BugReportButton's
          modal — escapes any ancestor with backdrop-filter/transform that
          would otherwise become the containing block for this fixed
          overlay. window.confirm() inside each handler below is still the
          final destructive-action gate; this modal is just the picker. */}
      {joinOpen && (
        <JoinBookModal
          onClose={() => setJoinOpen(false)}
          onJoined={id => {
            setJoinOpen(false);
            setImportedBooks(getImportedBooks());
            handleLevelChange(id);
          }}
        />
      )}

      {importOpen && (
        <ImportBookModal
          onClose={() => { setImportOpen(false); setImportedBooks(getImportedBooks()); }}
          onSwitchTo={id => {
            setImportOpen(false);
            setImportedBooks(getImportedBooks());
            handleLevelChange(id);
          }}
        />
      )}

      {resetModalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setResetModalOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-clay">Reset</h2>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                aria-label="Close"
                className="text-ink-soft hover:text-ink text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div>
              <p className="text-ink-soft text-sm mb-2">
                Erase all word progress for the {levelDisplayName(level)} level to start over from scratch. Other levels, and your account-wide streak/goal days, are untouched.
              </p>
              <button
                onClick={handleClearAll}
                className="w-full bg-clay/20 text-clay border-2 border-clay py-3 rounded-xl font-semibold hover:bg-clay/30 active:scale-95 transition-all"
              >
                {cleared ? '✓ Cleared!' : `Clear all progress (${levelDisplayName(level)})`}
              </button>
            </div>

            <div className="border-t border-clay/50 pt-3">
              <p className="text-ink-soft text-sm mb-2">
                Or start over completely — every level's progress, streaks, and settings, as if you
                just signed up. You'll stay signed in with the same email.
              </p>
              <button
                onClick={handleResetEverything}
                className="w-full bg-clay/20 text-clay border-2 border-clay py-3 rounded-xl font-semibold hover:bg-clay/30 active:scale-95 transition-all"
              >
                Reset entire account
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
