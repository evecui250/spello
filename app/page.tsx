'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getStreak, getAllProgress, getSettings, isStudyGoalDoneToday, setExtraStudyLimit,
  setExtraReviewLimit, getTodayStudyBatch, getWordProgress, MAX_ROUND, isOnboardingDone,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords, wordsById } from '../lib/practice';
import { WORDS } from '../lib/words';
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

// A plain panel button — icon, label, and a count or a checkmark once
// today's goal is met. No skeuomorphism, just a clear tappable bar.
function SectionButton({
  href, label, count, Icon, accent, muted, complete,
}: {
  href: string;
  label: string;
  count: number;
  Icon: (props: { className?: string }) => React.JSX.Element;
  accent: string;
  muted: boolean;
  complete: boolean;
}) {
  const body = (
    <div
      className={`flex-1 flex items-center gap-3 rounded-2xl border px-4 py-4 transition-transform ${
        muted
          ? 'bg-amber-50/40 backdrop-blur-sm border-amber-100/30 opacity-70'
          : 'bg-amber-50/75 backdrop-blur-sm border-amber-100/50 shadow-sm hover:scale-[1.03]'
      }`}
    >
      <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${accent}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="font-semibold text-stone-800">{label}</div>
        <div className="text-sm text-stone-500">
          {complete ? 'All done today' : `${count} word${count === 1 ? '' : 's'}`}
        </div>
      </div>
      {complete && <CheckCircleIcon className="w-5 h-5 text-emerald-600 shrink-0" />}
    </div>
  );

  if (muted) return body;
  return (
    <Link href={href} className="flex-1 flex">
      {body}
    </Link>
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
  const [extraStudyCount, setExtraStudyCount] = useState(10);
  const [extraReviewCount, setExtraReviewCount] = useState(10);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isOnboardingDone()) {
      router.replace('/welcome');
      return;
    }
    setStreak(getStreak().count);
    const progress = getAllProgress();
    setMasteredCount(Object.values(progress).filter(p => p.fullyMastered).length);
    // "Learning" = has any progress at all and isn't fully mastered yet —
    // matches the Words page's definition, which counts round 1-4 words
    // (no coin earned yet) as learning too, not just round-5-with-a-coin ones.
    setLearningCount(Object.values(progress).filter(p => !p.fullyMastered).length);
    const settings = getSettings();
    // If today's study batch was already drawn (and possibly partly
    // finished), show how many of it are left rather than a fresh count.
    const todayBatch = getTodayStudyBatch();
    const remainingToday = todayBatch
      ? wordsById(todayBatch).filter(w => getWordProgress(w.id).round < MAX_ROUND).length
      : buildStudyWords(settings.studyBatchSize).length;
    setStudyCount(remainingToday);
    setReviewCount(buildReviewWords(settings.dailyReview).length);
    setStudyGoalDone(isStudyGoalDoneToday());
    setReady(true);
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
      {/* How many words have reached the mastered (crowned) stage */}
      <div className="absolute top-0 right-0 flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/15 rounded-full pl-1.5 pr-3 py-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/mascot_long-crowned.png`}
          alt="Mastered (crowned) dachshunds"
          className="w-7 h-7 object-contain"
        />
        <span className="font-bold text-white text-sm">{masteredCount}</span>
      </div>

      {FIREFLIES_HOME.map((f, i) => (
        <span
          key={i}
          aria-hidden
          className="animate-firefly absolute w-1.5 h-1.5 rounded-full bg-amber-200 shadow-[0_0_8px_3px_rgba(252,211,77,0.7)]"
          style={{ top: f.top, left: f.left, animationDelay: `${f.delay}s` }}
        />
      ))}

      <div className="flex flex-col items-center gap-1">
        <Logo variant="icon" size={52} className="ring-2 ring-white/20" />
        <p className="text-emerald-100/70 text-xs tracking-wide mt-1">Master spelling, one word at a time.</p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        {stats.map(s => <StatBubble key={s.label} stat={s} />)}
      </div>

      <div className="w-full flex flex-col gap-3">
        <div className="flex gap-3">
          <SectionButton
            href="/practice/study"
            label="Study"
            count={studyGoalDone ? 0 : studyCount}
            Icon={BookIcon}
            accent="bg-amber-600"
            muted={!studyGoalDone && studyCount === 0}
            complete={studyGoalDone}
          />
          <SectionButton
            href="/practice/review"
            label="Review"
            count={reviewCount}
            Icon={RefreshIcon}
            accent="bg-sky-700"
            muted={reviewCount === 0}
            complete={false}
          />
        </div>

        {((studyGoalDone || studyCount === 0) || reviewCount === 0) && (
          <div className="flex gap-3">
            <div className="flex-1 flex justify-center">
              {(studyGoalDone || studyCount === 0) && (
                <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/15 rounded-lg px-2 py-1">
                  <input
                    type="number" min={1} max={100} value={extraStudyCount}
                    onChange={e => setExtraStudyCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-9 bg-transparent text-white text-xs text-center focus:outline-none"
                  />
                  <button
                    onClick={startExtraStudy}
                    className="text-[11px] font-semibold text-amber-200 hover:text-amber-100 inline-flex items-center gap-0.5 transition-colors"
                  >
                    extra <ArrowRightIcon className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 flex justify-center">
              {reviewCount === 0 && (
                <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-md border border-white/15 rounded-lg px-2 py-1">
                  <input
                    type="number" min={1} max={100} value={extraReviewCount}
                    onChange={e => setExtraReviewCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-9 bg-transparent text-white text-xs text-center focus:outline-none"
                  />
                  <button
                    onClick={startExtraReview}
                    className="text-[11px] font-semibold text-sky-200 hover:text-sky-100 inline-flex items-center gap-0.5 transition-colors"
                  >
                    extra <ArrowRightIcon className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
