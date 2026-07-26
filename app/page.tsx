'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getStreak, getAllProgress, getSettings, today, MAX_ROUND,
  isOnboardingDone, getDailySession, startDailySession, resetDailyGoalsForExtraRound, DailySession,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords } from '../lib/practice';
import { wordsForLevel } from '../lib/words';
import { SYNCED_EVENT } from '../lib/sync';
import Logo from '../components/Logo';
import {
  FlameIcon, SproutIcon, StarIcon, LayersIcon, CheckCircleIcon,
} from '../components/icons';

// Once today's main goal is done, "Study more" pulls a smaller bonus round
// instead of the user's full daily pace — repeatable as many times as there
// are still words available.
const EXTRA_STUDY_SIZE = 5;
const EXTRA_REVIEW_SIZE = 10;

interface BubbleStat {
  icon: (props: { className?: string }) => React.JSX.Element;
  value: number;
  label: string;
  ring: string;
  iconColor: string;
  drift: number;
  delay: number;
}

function StatBubble({ stat }: { stat: BubbleStat }) {
  const Icon = stat.icon;
  return (
    <div
      className={`animate-bubble-float flex flex-col items-center justify-center gap-0.5 w-[4.6rem] h-[4.6rem] shrink-0 rounded-full bg-white/10 backdrop-blur-md border ${stat.ring} shadow-[0_0_20px_rgba(0,0,0,0.15)]`}
      style={{ animationDelay: `${stat.delay}s`, ['--drift' as string]: `${stat.drift}px` }}
    >
      <Icon className={`w-4 h-4 ${stat.iconColor}`} />
      <div className="text-lg font-bold text-white leading-none">{stat.value}</div>
      <div className="text-[8px] text-white/70 text-center leading-tight px-1">{stat.label}</div>
    </div>
  );
}

const FIREFLIES_HOME = [
  { top: '4%', left: '18%', delay: 0.4 },
  { top: '8%', left: '78%', delay: 1.1 },
];

export default function HomePage() {
  const router = useRouter();
  const [streak, setStreak] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [learningCount, setLearningCount] = useState(0);
  const [session, setSession] = useState<DailySession | null>(null);
  const [previewStudyCount, setPreviewStudyCount] = useState(0);
  const [previewReviewCount, setPreviewReviewCount] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
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
      setStreak(getStreak().count);
      const progress = getAllProgress();
      setMasteredCount(Object.values(progress).filter(p => p.fullyMastered).length);
      // "Learning" = has earned its first puppy (cleared round 4 at least
      // once) and isn't fully mastered yet — matches the Words page's
      // definition. A word still mid-ladder (rounds 1-4, no puppy earned
      // yet) doesn't count here, same as it shows "New" there.
      setLearningCount(Object.values(progress).filter(p => p.studiedTimes > 0 && !p.fullyMastered).length);
      const settings = getSettings();
      setTotalWords(wordsForLevel(settings.level).length);
      const ds = getDailySession();
      setSession(ds);
      if (!ds) {
        // Nothing started today yet — preview what Start would pull in.
        setPreviewStudyCount(buildStudyWords(settings.studyBatchSize).length);
        setPreviewReviewCount(buildReviewWords(settings.dailyReview).length);
      } else if (ds.phase === 'done') {
        // Today's goal is met — preview the smaller bonus round instead.
        setPreviewStudyCount(buildStudyWords(EXTRA_STUDY_SIZE).length);
        setPreviewReviewCount(buildReviewWords(EXTRA_REVIEW_SIZE).length);
      } else {
        // Mid-session — show what's actually still left in today's batch,
        // not the original starting size.
        const t = today();
        setPreviewStudyCount(ds.studyWordIds.filter(id => (progress[id]?.round ?? 1) < MAX_ROUND).length);
        setPreviewReviewCount(ds.reviewWordIds.filter(id => !(progress[id]?.nextReviewDue && progress[id].nextReviewDue > t)).length);
      }
      setReady(true);
    };
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => window.removeEventListener(SYNCED_EVENT, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const stats: BubbleStat[] = [
    { icon: FlameIcon, value: streak, label: 'day streak', ring: 'border-amber-200/40', iconColor: 'text-amber-300', drift: -8, delay: 0 },
    { icon: SproutIcon, value: learningCount, label: 'learning', ring: 'border-sky-200/40', iconColor: 'text-sky-300', drift: 8, delay: 0.7 },
    { icon: StarIcon, value: masteredCount, label: 'mastered', ring: 'border-emerald-200/40', iconColor: 'text-emerald-300', drift: -6, delay: 1.4 },
    { icon: LayersIcon, value: totalWords, label: 'total words', ring: 'border-violet-200/40', iconColor: 'text-violet-300', drift: 7, delay: 2.1 },
  ];

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
    : `${previewStudyCount} new · ${previewReviewCount} to review`;
  const handleClick = isDoneForNow ? startExtraRound : inProgress ? () => router.push('/practice') : startSession;

  return (
    <div className="relative flex flex-col items-center gap-9 py-4">
      {FIREFLIES_HOME.map((f, i) => (
        <span
          key={i}
          aria-hidden
          className="animate-firefly absolute w-1.5 h-1.5 rounded-full bg-amber-200 shadow-[0_0_8px_3px_rgba(252,211,77,0.7)]"
          style={{ top: f.top, left: f.left, animationDelay: `${f.delay}s` }}
        />
      ))}

      <div className="flex flex-col items-center gap-1">
        <Logo variant="full" size={140} />
        <p className="text-emerald-100/70 text-sm tracking-wide mt-1">Master spelling, one word at a time.</p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {stats.map(s => <StatBubble key={s.label} stat={s} />)}
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
