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

// A fine-grain noise texture (baked as a data-URI SVG filter) so the leather
// reads as worn material rather than a flat CSS gradient.
const GRAIN_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// An ancient, weathered tome: mottled leather, a frayed corner, a cracked
// wax seal, and a tattered ribbon bookmark — something you'd find half
// buried under moss, not a clean modern icon.
function Tome({
  href, title, count, tone, mottle, tilt, sealTone, sealTextClass, muted, complete,
}: {
  href: string;
  title: string;
  count: number;
  tone: string;
  mottle: string;
  tilt: string;
  sealTone: string;
  sealTextClass: string;
  muted: boolean;
  complete: boolean;
}) {
  const cover = (
    <>
      {/* grain + worn light/dark patches — reads as leather, not flat color */}
      <div className="absolute inset-0 rounded-md opacity-25 mix-blend-overlay pointer-events-none" style={{ backgroundImage: GRAIN_BG }} />
      <div className="absolute inset-0 rounded-md pointer-events-none" style={{ backgroundImage: mottle }} />
      {/* frayed corner, exposing a lighter layer beneath the leather */}
      <div className="absolute top-0 right-0 w-5 h-5 bg-black/25" style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
      <div className="absolute left-0 top-0 bottom-0 w-2.5 bg-black/35 rounded-l-md" />
      <div className="absolute inset-2.5 border border-black/25 rounded-sm" />
      <div className={`absolute inset-[13px] border rounded-sm ${muted ? 'border-white/5' : 'border-white/10'}`} />
      <div className="absolute inset-0 flex flex-col items-center justify-between py-4 px-2">
        <span
          className={`font-serif uppercase tracking-[0.15em] text-sm ${muted ? 'text-white/35' : 'text-amber-50/90'}`}
          style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7), 0 -1px 0 rgba(255,255,255,0.08)' }}
        >
          {title}
        </span>
        {!muted && (
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ring-1 ring-black/40 shadow-inner ${sealTone}`}
            style={{ backgroundImage: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.3), transparent 55%), radial-gradient(circle at 70% 75%, rgba(0,0,0,0.25), transparent 50%)' }}
          >
            {complete
              ? <CheckCircleIcon className="w-5 h-5 text-emerald-50" />
              : <span className={`font-bold text-sm ${sealTextClass}`}>{count}</span>}
          </div>
        )}
        {/* tattered ribbon bookmark, hanging out from between the pages */}
        {!muted && (
          <div
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-2.5 h-5 bg-red-950/70"
            style={{ clipPath: 'polygon(0 0, 100% 0, 100% 65%, 50% 100%, 0 65%)' }}
          />
        )}
      </div>
    </>
  );

  const shapeClass = `relative w-28 h-36 rounded-md shadow-[0_10px_25px_rgba(0,0,0,0.5)] border ${tone} ${tilt}`;

  if (muted) {
    return <div className={`${shapeClass} opacity-70`}>{cover}</div>;
  }
  return (
    <Link href={href} className={`${shapeClass} animate-book-glow transition-transform hover:scale-105 hover:rotate-0`}>
      {cover}
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

      <div className="flex justify-center items-start gap-8 sm:gap-14">
        {/* Learn tome */}
        <div className="flex flex-col items-center gap-2">
          <Tome
            href="/practice/study"
            title="Learn"
            count={studyGoalDone ? 0 : studyCount}
            tone="border-amber-900/50 bg-gradient-to-br from-amber-800 via-amber-950 to-stone-950"
            mottle="radial-gradient(circle at 22% 18%, rgba(217,164,90,0.22), transparent 40%), radial-gradient(circle at 78% 72%, rgba(0,0,0,0.3), transparent 45%), radial-gradient(circle at 55% 15%, rgba(0,0,0,0.18), transparent 35%)"
            tilt="-rotate-2"
            sealTone="bg-[radial-gradient(circle_at_30%_30%,#c8791f,#5c2a0c)]"
            sealTextClass="text-amber-950"
            muted={!studyGoalDone && studyCount === 0}
            complete={studyGoalDone}
          />
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

        {/* Review tome */}
        <div className="flex flex-col items-center gap-2">
          <Tome
            href="/practice/review"
            title="Review"
            count={reviewCount}
            tone="border-slate-500/30 bg-gradient-to-br from-slate-700 via-indigo-950 to-slate-950"
            mottle="radial-gradient(circle at 25% 20%, rgba(148,163,184,0.18), transparent 40%), radial-gradient(circle at 75% 75%, rgba(0,0,0,0.32), transparent 45%), radial-gradient(circle at 50% 12%, rgba(0,0,0,0.2), transparent 35%)"
            tilt="rotate-2"
            sealTone="bg-[radial-gradient(circle_at_30%_30%,#3b7fa8,#0c2c40)]"
            sealTextClass="text-sky-50"
            muted={reviewCount === 0}
            complete={false}
          />
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
    </div>
  );
}
