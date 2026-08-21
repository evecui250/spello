'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getAllProgress, getSettings, today,
  isOnboardingDone, getDailySession, startDailySession, resetDailyGoalsForExtraRound, DailySession,
  getTheme, Theme, THEME_CHANGED_EVENT,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords } from '../lib/practice';
import { SYNCED_EVENT } from '../lib/sync';
import Logo from '../components/Logo';
import { CheckCircleIcon } from '../components/icons';
import { THEME_CONFIG } from '../components/AppBackground';

// Once today's main goal is done, "Study more" pulls a smaller bonus round
// instead of the user's full daily pace — repeatable as many times as there
// are still words available.
const EXTRA_STUDY_SIZE = 5;
const EXTRA_REVIEW_SIZE = 10;

const FIREFLIES_HOME = [
  { top: '4%', left: '18%', delay: 0.4 },
  { top: '8%', left: '78%', delay: 1.1 },
];

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<DailySession | null>(null);
  // Matches the current global background theme (see AppBackground) so
  // these two extra decorative sparkles around the hero don't stay
  // hardcoded amber/firefly-colored under a theme they no longer belong to.
  const [theme, setTheme] = useState<Theme>('forest');
  const [previewStudyCount, setPreviewStudyCount] = useState(0);
  const [previewReviewCount, setPreviewReviewCount] = useState(0);
  const [totalStudyCount, setTotalStudyCount] = useState(0);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isOnboardingDone()) {
      router.replace('/welcome');
      return;
    }
    // Runs on mount (whatever's already in local storage), and again once
    // a signed-in pull-and-merge finishes — otherwise a returning user who
    // lands here before that async pull resolves sees a stale/empty local
    // state until they happen to visit Settings, the only page that used to
    // trigger the pull.
    const load = () => {
      const progress = getAllProgress();
      const settings = getSettings();
      const ds = getDailySession();
      setSession(ds);
      if (!ds) {
        // Nothing started today yet — preview what Start would pull in.
        // Remaining equals the total here, since nothing's done yet.
        const studyCount = buildStudyWords(settings.studyBatchSize).length;
        const reviewCount = buildReviewWords(settings.dailyReview).length;
        setPreviewStudyCount(studyCount);
        setPreviewReviewCount(reviewCount);
        setTotalStudyCount(studyCount);
        setTotalReviewCount(reviewCount);
      } else if (ds.phase === 'done') {
        // Today's goal is met — preview the smaller bonus round instead.
        const studyCount = buildStudyWords(EXTRA_STUDY_SIZE).length;
        const reviewCount = buildReviewWords(EXTRA_REVIEW_SIZE).length;
        setPreviewStudyCount(studyCount);
        setPreviewReviewCount(reviewCount);
        setTotalStudyCount(studyCount);
        setTotalReviewCount(reviewCount);
      } else {
        // Mid-session — show what's actually still left against today's
        // original batch size, so "5/15 new" reflects 10 already done.
        const t = today();
        setPreviewStudyCount(ds.studyWordIds.filter(id => !progress[id]?.mascotStage).length);
        setPreviewReviewCount(ds.reviewWordIds.filter(id => {
          const p = progress[id];
          return !p?.fullyMastered && !(p?.nextReviewDue && p.nextReviewDue > t);
        }).length);
        setTotalStudyCount(ds.studyWordIds.length);
        setTotalReviewCount(ds.reviewWordIds.length);
      }
      setReady(true);
    };
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => window.removeEventListener(SYNCED_EVENT, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadTheme = () => setTheme(getTheme());
    loadTheme();
    window.addEventListener(THEME_CHANGED_EVENT, loadTheme);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, loadTheme);
  }, []);

  const startSession = () => {
    const settings = getSettings();
    const studyIds = buildStudyWords(settings.studyBatchSize).map(w => w.id);
    const reviewIds = buildReviewWords(settings.dailyReview).map(w => w.id);
    startDailySession(studyIds, reviewIds);
    router.push('/practice');
  };

  // Today's main goal is already done — pull a smaller bonus round instead
  // of the full daily pace, and un-latch the goal flags so finishing it
  // earns its own congrats card (with the day's running total, not just
  // this round's).
  const startExtraRound = () => {
    const studyIds = buildStudyWords(EXTRA_STUDY_SIZE).map(w => w.id);
    const reviewIds = buildReviewWords(EXTRA_REVIEW_SIZE).map(w => w.id);
    resetDailyGoalsForExtraRound();
    startDailySession(studyIds, reviewIds, true);
    router.push('/practice');
  };

  if (!ready) return null;

  const isDoneForNow = session?.phase === 'done';
  const inProgress = !!session && !isDoneForNow;
  // Only when there's truly nothing left anywhere (whole vocab exhausted,
  // nothing due) does the button retire into a plain non-interactive pill —
  // otherwise "done for today" still offers a bonus round via the same button.
  const nothingLeftAtAll = isDoneForNow && previewStudyCount === 0 && previewReviewCount === 0;

  // Mid-session still says "Start" (not "Continue") — just with the counts
  // updated to whatever's actually left, same as the not-yet-started state.
  // A bonus round in progress keeps saying "Study more" instead, so quitting
  // and coming back doesn't make it look like the main daily goal reset.
  const label = isDoneForNow ? 'Goal completed' : inProgress && session?.isExtra ? 'Study more' : 'Start';
  const subtitle = isDoneForNow
    ? 'study more →'
    : `${previewStudyCount}/${totalStudyCount} new · ${previewReviewCount}/${totalReviewCount} to review`;
  const handleClick = isDoneForNow ? startExtraRound : inProgress ? () => router.push('/practice') : startSession;

  return (
    // min-h roughly matches the visible area between <main>'s own top
    // padding and the fixed bottom NavBar (see layout.tsx) — centers the
    // logo/button block in the middle of the screen instead of it sitting
    // pinned near the top with a lot of empty space below on a tall phone.
    <div className="relative flex flex-col items-center justify-center gap-9 py-4 min-h-[calc(100dvh-11rem)]">
      {FIREFLIES_HOME.map((f, i) => (
        <span
          key={i}
          aria-hidden
          className={`${THEME_CONFIG[theme].particleAnimation} absolute w-1.5 h-1.5 rounded-full ${THEME_CONFIG[theme].particleColor} ${THEME_CONFIG[theme].particleGlow}`}
          style={{ top: f.top, left: f.left, animationDelay: `${f.delay}s` }}
        />
      ))}

      <div className="flex flex-col items-center gap-1">
        <Logo variant="full" size={140} />
        <p className="text-emerald-100/70 text-sm tracking-wide mt-1">Master spelling, one word at a time.</p>
      </div>

      <div className="w-full flex flex-col items-center gap-3">
        {nothingLeftAtAll ? (
          <div className="w-full max-w-[260px] rounded-full border bg-amber-50/40 backdrop-blur-sm border-amber-100/30 opacity-80 flex items-center justify-center gap-2 px-6 py-4">
            <CheckCircleIcon className="w-6 h-6 text-emerald-600" />
            <span className="font-semibold text-stone-800">All done today</span>
          </div>
        ) : (
          <button
            onClick={handleClick}
            className="group relative w-full max-w-[260px] rounded-full px-5 py-4 flex flex-col items-center gap-0.5 overflow-hidden shadow-[0_4px_16px_rgba(90,58,26,0.35)] hover:shadow-[0_8px_24px_rgba(90,58,26,0.45)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all duration-300 ease-out"
            style={{ backgroundImage: 'linear-gradient(135deg, #a9835e 0%, #8a6440 50%, #6b4a2c 100%)' }}
          >
            <span className="text-lg font-extrabold text-amber-50 tracking-wide">
              {label}
            </span>
            <span className="text-xs font-medium text-amber-100/75 text-center">
              {subtitle}
            </span>
            <span className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </button>
        )}
      </div>
    </div>
  );
}
