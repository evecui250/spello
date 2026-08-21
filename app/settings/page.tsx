'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSettings, saveSettings, switchToLevel, clearAllProgress, resetEverything, Settings, getTheme, saveTheme, Theme } from '../../lib/storage';
import { THEME_CONFIG } from '../../components/AppBackground';
import { daysToWeeks, estimateProgressForecast, recommendedDailyReview, resizeTodayStudyBatch } from '../../lib/practice';
import { Level, wordsForLevel } from '../../lib/words';
import { scheduleSync, syncNow } from '../../lib/sync';
import AccountPanel from '../../components/AccountPanel';
import ShareCard from '../../components/ShareCard';
import BugReportButton from '../../components/BugReportButton';
import { supabase } from '../../lib/supabase';

// Purely cosmetic — just decides whether to show the "Admin" link at all.
// The real authorization check lives server-side, in admin-stats' own
// ADMIN_EMAIL comparison; showing this link to the wrong person would at
// worst send them to a page that immediately says "not authorized".
const ADMIN_EMAIL = 'evecui250@gmail.com';

export default function SettingsPage() {
  const router = useRouter();
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [studyBatchSize, setStudyBatchSize] = useState(5);
  const [dailyReview, setDailyReview] = useState(15);
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>('en');
  const [level, setLevel] = useState<Level>('A1');
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
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
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applySettings = (s: Settings) => {
    setStudyBatchSize(s.studyBatchSize);
    setDailyReview(s.dailyReview);
    setNativeLanguage(s.nativeLanguage);
    setLevel(s.level);
    setAutoPlayAudio(s.autoPlayAudio);
    setRequireArticle(s.requireArticle);
    setSentenceWritingMode(s.sentenceWritingMode);
  };

  const loadFromStorage = () => applySettings(getSettings());

  useEffect(loadFromStorage, []);
  useEffect(() => setTheme(getTheme()), []);

  const handleThemeChange = (t: Theme) => {
    setTheme(t);
    saveTheme(t);
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
      studyBatchSize, dailyReview, language: 'de', nativeLanguage, level, autoPlayAudio, requireArticle,
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
    if (!window.confirm(`This will erase all learning progress for the ${level} level — every word starts over. Other levels, and your account-wide streak/goal days, aren't affected. This can't be undone. Continue?`)) return;
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Settings</h1>
        <span className={`text-sm font-medium text-emerald-300 transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>
          ✓ Saved
        </span>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6">
        <AccountPanel onSync={loadFromStorage} />
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6">
        <label className="block font-semibold text-stone-800 mb-1">Theme</label>
        <p className="text-stone-500 text-sm mb-3">Changes the app's background.</p>
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
                    isSelected ? 'ring-2 ring-offset-2 ring-offset-amber-50 ring-indigo-500 scale-110' : 'ring-1 ring-black/10'
                  }`}
                />
                <span className={`text-[11px] font-medium capitalize ${isSelected ? 'text-indigo-700' : 'text-stone-500'}`}>
                  {t}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-6">
        <div>
          <label className="block font-semibold text-stone-800 mb-1">Level</label>
          <select
            value={level}
            onChange={e => handleLevelChange(e.target.value as Level)}
            className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
          >
            <option value="A1">A1</option>
            <option value="A2">A2</option>
            <option value="B1">B1</option>
            <option value="B2">B2</option>
          </select>
          <p className="text-stone-500 text-sm mt-1">This vocabulary book has {wordsForLevel(level).length} words for {level}.</p>
        </div>

        <div>
          <label className="block font-semibold text-stone-800 mb-1">Learn with</label>
          <select
            value={nativeLanguage}
            onChange={e => {
              const v = e.target.value as 'en' | 'zh';
              setNativeLanguage(v);
              persist({ nativeLanguage: v });
            }}
            className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
          >
            <option value="en">English</option>
            <option value="zh">中文 (Chinese)</option>
          </select>
          <p className="text-stone-500 text-sm mt-1">Word meanings and example sentences are shown in this language.</p>
        </div>

        <div>
          <label className="block font-semibold text-stone-800 mb-1">
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
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-stone-800">{studyBatchSize}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-stone-800 mb-1">
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
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-stone-800">{dailyReview}</span>
          </div>
          {dailyReview !== recommendedReview && (
            <div className="flex items-center justify-between gap-2 mt-2 bg-amber-100/60 rounded-lg px-3 py-2 text-sm">
              <span className="text-stone-800">
                💡 Recommended: <strong>{recommendedReview}</strong> for a {studyBatchSize}/day study pace
              </span>
              <button
                onClick={() => { setDailyReview(recommendedReview); persist({ dailyReview: recommendedReview }); }}
                className="shrink-0 bg-indigo-600 text-white px-3 py-1 rounded-lg font-semibold text-xs hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Use {recommendedReview}
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <div className="bg-amber-100/60 rounded-xl px-4 py-3 text-sm text-stone-800 flex items-center justify-between gap-3">
            <span className="font-semibold shrink-0 inline-flex items-center gap-1.5">
              At this pace
              <button
                type="button"
                onClick={() => setShowPaceInfo(v => !v)}
                aria-label="How mastery works"
                className="w-4 h-4 rounded-full bg-stone-400/70 text-white text-[10px] font-bold leading-none flex items-center justify-center hover:bg-stone-500/70 transition-colors"
              >
                ?
              </button>
            </span>
            <span className="text-right">
              ~{daysToWeeks(forecast.daysToMasterAll)} weeks to master all
            </span>
          </div>
          {showPaceInfo && (
            <div className="absolute top-full left-0 mt-2 z-10 w-full bg-amber-50/95 backdrop-blur-sm border border-amber-100 rounded-xl px-4 py-3 text-sm text-stone-700 shadow-lg">
              Each word follows a fixed schedule instead of a score: review
              it 1 day after you learn it, 3 days after that, then 5 days
              after that — three reviews, about 9 days total, and
              it&apos;s fully mastered.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-stone-800">
              Auto-play pronunciation
            </label>
          </div>
          <input
            type="checkbox"
            checked={autoPlayAudio}
            onChange={e => { setAutoPlayAudio(e.target.checked); persist({ autoPlayAudio: e.target.checked }); }}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-stone-800">
              Practice articles
            </label>
          </div>
          <input
            type="checkbox"
            checked={requireArticle}
            onChange={e => { setRequireArticle(e.target.checked); persist({ requireArticle: e.target.checked }); }}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-stone-800">
              Sentence writing mode
            </label>
          </div>
          <input
            type="checkbox"
            checked={sentenceWritingMode}
            onChange={e => { setSentenceWritingMode(e.target.checked); persist({ sentenceWritingMode: e.target.checked }); }}
            className="w-5 h-5 accent-indigo-600 shrink-0 ml-3"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/welcome"
          className="text-center bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-4 font-semibold text-stone-700 hover:bg-amber-50 transition-colors"
        >
          View welcome guide
        </Link>
        <ShareCard />
      </div>

      {/* Preview-only entry point — not yet part of the main daily flow,
          see app/game/page.tsx's own top comment. */}
      <Link
        href="/game"
        className="text-center bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm py-3 px-4 font-semibold text-stone-700 hover:bg-amber-50 active:scale-[0.99] transition-all"
      >
        🎮 Try the new word-match game (preview)
      </Link>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
        <Link href="/terms" className="text-amber-200 hover:text-amber-100 underline">Terms of Service</Link>
        <Link href="/privacy" className="text-amber-200 hover:text-amber-100 underline">Privacy Policy</Link>
        <BugReportButton />
        <button
          type="button"
          onClick={() => setResetModalOpen(true)}
          className="text-amber-200 hover:text-amber-100 underline"
        >
          Reset
        </button>
        {signedInEmail === ADMIN_EMAIL && (
          <Link href="/admin" className="text-amber-200 hover:text-amber-100 underline">Admin</Link>
        )}
      </div>

      {/* Portaled straight to <body>, same reasoning as BugReportButton's
          modal — escapes any ancestor with backdrop-filter/transform that
          would otherwise become the containing block for this fixed
          overlay. window.confirm() inside each handler below is still the
          final destructive-action gate; this modal is just the picker. */}
      {resetModalOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setResetModalOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-amber-50 rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-red-700">Reset</h2>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                aria-label="Close"
                className="text-stone-400 hover:text-stone-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div>
              <p className="text-stone-500 text-sm mb-2">
                Erase all word progress for the {level} level to start over from scratch. Other levels, and your account-wide streak/goal days, are untouched.
              </p>
              <button
                onClick={handleClearAll}
                className="w-full bg-red-50 text-red-700 border-2 border-red-100 py-3 rounded-xl font-semibold hover:bg-red-100 active:scale-95 transition-all"
              >
                {cleared ? '✓ Cleared!' : `Clear all progress (${level})`}
              </button>
            </div>

            <div className="border-t border-red-200/50 pt-3">
              <p className="text-stone-500 text-sm mb-2">
                Or start over completely — every level's progress, streaks, and settings, as if you
                just signed up. You'll stay signed in with the same email.
              </p>
              <button
                onClick={handleResetEverything}
                className="w-full bg-red-100 text-red-800 border-2 border-red-200 py-3 rounded-xl font-semibold hover:bg-red-200 active:scale-95 transition-all"
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
