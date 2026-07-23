'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getStreak, getAllProgress, getSettings, setExtraStudyLimit, setExtraReviewLimit,
  isOnboardingDone, getDailySession, startDailySession, DailySession,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords } from '../lib/practice';
import { WORDS } from '../lib/words';
import { SYNCED_EVENT } from '../lib/sync';
import Logo from '../components/Logo';
import {
  FlameIcon, SproutIcon, StarIcon, LayersIcon, ArrowRightIcon, CheckCircleIcon, BookIcon,
} from '../components/icons';

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
  const [extraStudyCount, setExtraStudyCount] = useState(10);
  const [extraReviewCount, setExtraReviewCount] = useState(10);
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
      // "Learning" = has earned its first puppy (cleared round 5 at least
      // once) and isn't fully mastered yet — matches the Words page's
      // definition. A word still mid-ladder (rounds 1-4, no puppy earned
      // yet) doesn't count here, same as it shows "New" there.
      setLearningCount(Object.values(progress).filter(p => p.studiedTimes > 0 && !p.fullyMastered).length);
      const settings = getSettings();
      const ds = getDailySession();
      setSession(ds);
      if (!ds) {
        // Nothing started today yet — preview what Start would pull in.
        setPreviewStudyCount(buildStudyWords(settings.studyBatchSize).length);
        setPreviewReviewCount(buildReviewWords(settings.dailyReview).length);
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

  const startExtraStudy = () => {
    setExtraStudyLimit(extraStudyCount);
    router.push('/practice/study');
  };

  const startExtraReview = () => {
    setExtraReviewLimit(extraReviewCount);
    router.push('/practice/review');
  };

  const stats: BubbleStat[] = [
    { icon: FlameIcon, value: streak, label: 'day streak', ring: 'border-amber-200/40', iconColor: 'text-amber-300', drift: -8, delay: 0 },
    { icon: SproutIcon, value: learningCount, label: 'learning', ring: 'border-sky-200/40', iconColor: 'text-sky-300', drift: 8, delay: 0.7 },
    { icon: StarIcon, value: masteredCount, label: 'mastered', ring: 'border-emerald-200/40', iconColor: 'text-emerald-300', drift: -6, delay: 1.4 },
    { icon: LayersIcon, value: WORDS.length, label: 'total words', ring: 'border-violet-200/40', iconColor: 'text-violet-300', drift: 7, delay: 2.1 },
  ];

  if (!ready) return null;

  const isDone = session?.phase === 'done';
  const inProgress = !!session && !isDone;

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
        <p className="text-emerald-100/70 text-xs tracking-wide mt-1">Master spelling, one word at a time.</p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {stats.map(s => <StatBubble key={s.label} stat={s} />)}
      </div>

      <div className="w-full flex flex-col items-center gap-3">
        {isDone ? (
          <div className="w-full rounded-2xl border bg-amber-50/40 backdrop-blur-sm border-amber-100/30 opacity-80 flex items-center justify-center gap-2 px-6 py-5">
            <CheckCircleIcon className="w-6 h-6 text-emerald-600" />
            <span className="font-semibold text-stone-800">All done today</span>
          </div>
        ) : (
          <button
            onClick={inProgress ? () => router.push('/practice') : startSession}
            className="w-full rounded-2xl px-6 py-6 flex flex-col items-center gap-1 shadow-lg hover:scale-[1.02] active:scale-[0.99] transition-transform"
            style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, #f0b558, #a5590f)', boxShadow: '0 0 20px 2px rgba(245,158,11,0.35)' }}
          >
            <span className="inline-flex items-center gap-2 text-xl font-bold text-white">
              <BookIcon className="w-5 h-5" />
              {inProgress ? 'Continue' : 'Start'}
            </span>
            <span className="text-sm text-white/85">
              {inProgress ? "Pick up where you left off" : `${previewStudyCount} new · ${previewReviewCount} to review`}
            </span>
          </button>
        )}

        {isDone && (
          <div className="w-full flex gap-3">
            <div className="flex-1 rounded-xl border border-amber-100/40 bg-amber-50/40 backdrop-blur-sm px-3 py-2.5 flex items-center justify-center gap-1.5">
              <input
                type="number" min={1} max={100} value={extraStudyCount}
                onChange={e => setExtraStudyCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-9 bg-transparent text-stone-700 text-xs text-center focus:outline-none"
              />
              <button onClick={startExtraStudy} className="text-[11px] font-semibold text-amber-700 hover:text-amber-900 inline-flex items-center gap-0.5">
                study extra <ArrowRightIcon className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 rounded-xl border border-amber-100/40 bg-amber-50/40 backdrop-blur-sm px-3 py-2.5 flex items-center justify-center gap-1.5">
              <input
                type="number" min={1} max={100} value={extraReviewCount}
                onChange={e => setExtraReviewCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-9 bg-transparent text-stone-700 text-xs text-center focus:outline-none"
              />
              <button onClick={startExtraReview} className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 inline-flex items-center gap-0.5">
                review extra <ArrowRightIcon className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
