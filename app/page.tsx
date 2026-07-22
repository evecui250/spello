'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getStreak, getAllProgress, getSettings, isStudyGoalDoneToday, isReviewGoalDoneToday, setExtraStudyLimit,
  setExtraReviewLimit, getTodayStudyBatch, getWordProgress, MAX_ROUND, isOnboardingDone,
  setStudyGoalDoneFlag, setReviewGoalDoneFlag,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords, wordsById } from '../lib/practice';
import { WORDS } from '../lib/words';
import { SYNCED_EVENT } from '../lib/sync';
import Logo from '../components/Logo';
import {
  FlameIcon, SproutIcon, StarIcon, LayersIcon, ArrowRightIcon, CheckCircleIcon,
  BookIcon, RefreshIcon,
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

// A panel button — a glowing gradient medallion, label, and a count or a
// checkmark once today's goal is met. When there's nothing left to do, an
// "extra" stepper lives right in the same card instead of floating loose
// below it — it's a sibling of the Link (not nested inside it), so its
// input/button stay independently clickable.
function SectionButton({
  href, label, count, Icon, gradient, glow, muted, complete, extra,
}: {
  href: string;
  label: string;
  count: number;
  Icon: (props: { className?: string }) => React.JSX.Element;
  gradient: string;
  glow: string;
  muted: boolean;
  complete: boolean;
  extra?: { value: number; onChange: (n: number) => void; onStart: () => void; tone: string };
}) {
  return (
    <div
      className={`flex-1 rounded-2xl border overflow-hidden transition-transform ${
        muted
          ? 'bg-amber-50/40 backdrop-blur-sm border-amber-100/30 opacity-80'
          : 'bg-amber-50/75 backdrop-blur-sm border-amber-100/50 shadow-sm hover:scale-[1.03]'
      }`}
    >
      <Link href={href} className="flex items-center gap-3 px-4 py-4">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 ring-1 ring-black/10"
          style={{ backgroundImage: gradient, boxShadow: `0 0 14px 1px ${glow}` }}
        >
          <Icon className="w-5 h-5 text-white drop-shadow-sm" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="font-semibold text-stone-800">{label}</div>
          <div className="text-sm text-stone-500">
            {complete ? 'All done today' : `${count} word${count === 1 ? '' : 's'}`}
          </div>
        </div>
        {complete && <CheckCircleIcon className="w-5 h-5 text-emerald-600 shrink-0" />}
      </Link>
      {extra && (
        <div className="flex items-center gap-1.5 border-t border-amber-900/10 px-3 py-2">
          <input
            type="number" min={1} max={100} value={extra.value}
            onChange={e => extra.onChange(Math.max(1, Number(e.target.value) || 1))}
            className="w-9 bg-transparent text-stone-700 text-xs text-center focus:outline-none"
          />
          <button
            onClick={extra.onStart}
            className={`text-[11px] font-semibold inline-flex items-center gap-0.5 transition-colors ${extra.tone}`}
          >
            extra <ArrowRightIcon className="w-3 h-3" />
          </button>
        </div>
      )}
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
  const [studyCount, setStudyCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [studyGoalDone, setStudyGoalDone] = useState(false);
  const [reviewGoalDone, setReviewGoalDone] = useState(false);
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
    // state (e.g. "nothing to review") until they happen to visit Settings,
    // the only page that used to trigger the pull.
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
      // If today's study batch was already drawn (and possibly partly
      // finished), show how many of it are left rather than a fresh count.
      const todayBatch = getTodayStudyBatch();
      const remainingToday = todayBatch
        ? wordsById(todayBatch).filter(w => getWordProgress(w.id).round < MAX_ROUND).length
        : buildStudyWords(settings.studyBatchSize).length;
      const dueForReview = buildReviewWords(settings.dailyReview).length;
      // Genuinely nothing left to do today (no new words to draw, or no
      // review due yet) means the goal is met, not "stuck at 0" — otherwise
      // the card sits dim forever instead of matching the other one's
      // bright "all done" look once nothing's actionable.
      if (remainingToday === 0 && !isStudyGoalDoneToday()) setStudyGoalDoneFlag(true);
      if (dueForReview === 0 && !isReviewGoalDoneToday()) setReviewGoalDoneFlag(true);
      setStudyCount(remainingToday);
      setReviewCount(dueForReview);
      setStudyGoalDone(isStudyGoalDoneToday());
      setReviewGoalDone(isReviewGoalDoneToday());
      setReady(true);
    };
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => window.removeEventListener(SYNCED_EVENT, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      <div className="w-full flex gap-3">
        <SectionButton
          href="/practice/study"
          label="Study"
          count={studyGoalDone ? 0 : studyCount}
          Icon={BookIcon}
          gradient="radial-gradient(circle at 32% 28%, #f0b558, #a5590f)"
          glow="rgba(245,158,11,0.35)"
          muted={!studyGoalDone && studyCount === 0}
          complete={studyGoalDone}
          extra={(studyGoalDone || studyCount === 0) ? {
            value: extraStudyCount, onChange: setExtraStudyCount, onStart: startExtraStudy,
            tone: 'text-amber-700 hover:text-amber-900',
          } : undefined}
        />
        <SectionButton
          href="/practice/review"
          label="Review"
          count={reviewCount}
          Icon={RefreshIcon}
          gradient="radial-gradient(circle at 32% 28%, #4fd1c5, #0f6d63)"
          glow="rgba(45,212,191,0.35)"
          muted={!reviewGoalDone && reviewCount === 0}
          complete={reviewGoalDone}
          extra={reviewCount === 0 ? {
            value: extraReviewCount, onChange: setExtraReviewCount, onStart: startExtraReview,
            tone: 'text-teal-700 hover:text-teal-900',
          } : undefined}
        />
      </div>
    </div>
  );
}
