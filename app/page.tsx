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
  FlameIcon, SproutIcon, StarIcon, LayersIcon, BookIcon, StackedBooksIcon, ArrowRightIcon,
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

const FIREFLIES = [
  { top: '18%', left: '12%', delay: 0 },
  { top: '30%', left: '82%', delay: 0.6 },
  { top: '55%', left: '20%', delay: 1.2 },
  { top: '15%', left: '55%', delay: 1.8 },
  { top: '68%', left: '90%', delay: 0.3 },
  { top: '40%', left: '6%', delay: 2.1 },
  { top: '10%', left: '88%', delay: 1.5 },
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
    <div className="flex flex-col gap-6 py-2">
      {/* Forest scene */}
      <div className="relative overflow-hidden rounded-3xl px-5 pt-8 pb-6 bg-gradient-to-b from-[#0f3d3a] via-[#155c4a] to-[#0c2e25]">
        {/* Light shafts + mist, purely decorative */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-10 left-[10%] w-1/2 h-2/3 bg-[radial-gradient(ellipse_at_top,rgba(255,244,200,0.20),transparent_65%)]" />
          <div className="absolute -top-4 right-[5%] w-2/5 h-1/2 bg-[radial-gradient(ellipse_at_top,rgba(190,255,230,0.14),transparent_65%)]" />
          <div className="animate-mist absolute top-1/3 left-0 w-[130%] h-24 bg-white/5 blur-2xl rounded-full" />
          {FIREFLIES.map((f, i) => (
            <span
              key={i}
              className="animate-firefly absolute w-1.5 h-1.5 rounded-full bg-amber-200 shadow-[0_0_8px_3px_rgba(252,211,77,0.7)]"
              style={{ top: f.top, left: f.left, animationDelay: `${f.delay}s` }}
            />
          ))}
        </div>

        {/* Treeline silhouette along the bottom edge */}
        <svg aria-hidden className="pointer-events-none absolute bottom-0 left-0 w-full h-16" viewBox="0 0 100 20" preserveAspectRatio="none">
          <defs>
            <pattern id="treesBack" width="11" height="20" patternUnits="userSpaceOnUse">
              <polygon points="5.5,3 0,20 11,20" fill="#0a3327" opacity="0.55" />
            </pattern>
            <pattern id="treesFront" width="8" height="20" patternUnits="userSpaceOnUse" patternTransform="translate(3,0)">
              <polygon points="4,7 0,20 8,20" fill="#062018" opacity="0.9" />
            </pattern>
          </defs>
          <rect width="100" height="20" fill="url(#treesBack)" />
          <rect width="100" height="20" fill="url(#treesFront)" />
        </svg>

        {/* Content */}
        <div className="relative flex flex-col items-center gap-1 mb-7">
          <Logo variant="icon" size={44} className="ring-2 ring-white/20" />
          <p className="text-emerald-100/70 text-xs tracking-wide mt-1">Master spelling, one word at a time.</p>
        </div>

        <div className="relative flex flex-wrap justify-center gap-3 mb-9">
          {stats.map(s => <StatBubble key={s.label} stat={s} />)}
        </div>

        <div className="relative flex justify-center items-start gap-6 sm:gap-10 pb-2">
          {/* Study book */}
          <div className="flex flex-col items-center gap-2 w-32">
            {studyGoalDone ? (
              <div className="flex flex-col items-center gap-1 w-24 h-24 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 justify-center">
                <BookIcon className="w-7 h-7 text-emerald-200" />
                <span className="text-[10px] text-emerald-100/80 text-center px-1">Goal complete</span>
              </div>
            ) : studyCount > 0 ? (
              <Link
                href="/practice/study"
                className="animate-book-glow flex flex-col items-center gap-1 w-24 h-24 rounded-2xl justify-center transition-transform bg-amber-50/10 backdrop-blur-md border border-amber-200/30 hover:scale-105"
              >
                <BookIcon className="w-7 h-7 text-amber-200" />
                <span className="text-lg font-bold text-white leading-none">{studyCount}</span>
              </Link>
            ) : (
              <div className="flex flex-col items-center gap-1 w-24 h-24 rounded-2xl justify-center bg-white/5 backdrop-blur-md border border-white/10">
                <BookIcon className="w-7 h-7 text-white/30" />
              </div>
            )}
            <div className="text-xs font-medium text-emerald-50/90">To Learn</div>
            {studyGoalDone || studyCount === 0 ? (
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
            ) : null}
          </div>

          {/* Review book */}
          <div className="flex flex-col items-center gap-2 w-32">
            {reviewCount > 0 ? (
              <Link
                href="/practice/review"
                className="animate-book-glow flex flex-col items-center gap-1 w-24 h-24 rounded-2xl justify-center transition-transform bg-sky-50/10 backdrop-blur-md border border-sky-200/30 hover:scale-105"
              >
                <StackedBooksIcon className="w-7 h-7 text-sky-200" />
                <span className="text-lg font-bold text-white leading-none">{reviewCount}</span>
              </Link>
            ) : (
              <div className="flex flex-col items-center gap-1 w-24 h-24 rounded-2xl justify-center bg-white/5 backdrop-blur-md border border-white/10">
                <StackedBooksIcon className="w-7 h-7 text-white/30" />
              </div>
            )}
            <div className="text-xs font-medium text-emerald-50/90">To Review</div>
            {reviewCount === 0 ? (
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
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
