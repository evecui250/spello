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
import { FlameIcon, SproutIcon, StarIcon, LayersIcon, BookIcon, RefreshIcon, CheckCircleIcon, ArrowRightIcon } from '../components/icons';

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
    setLearningCount(Object.values(progress).filter(p => !p.fullyMastered && p.studiedTimes >= 1).length);
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

  const stats = [
    { icon: FlameIcon, value: streak, label: 'day streak', color: 'text-orange-500' },
    { icon: SproutIcon, value: learningCount, label: 'learning', color: 'text-blue-500' },
    { icon: StarIcon, value: masteredCount, label: 'mastered', color: 'text-emerald-600' },
    { icon: LayersIcon, value: WORDS.length, label: 'total words', color: 'text-indigo-600' },
  ];

  if (!ready) return null;

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      {/* Hero */}
      <div className="w-full rounded-3xl bg-gradient-to-br from-indigo-50 via-white to-purple-50 border border-indigo-100/70 px-8 py-10 flex flex-col items-center gap-3 text-center">
        <Logo variant="full" size={150} />
        <p className="text-slate-500 text-sm tracking-wide">Master spelling, one word at a time.</p>
      </div>

      {/* Stats */}
      <div className="w-full grid grid-cols-4 bg-white rounded-2xl border border-indigo-50 shadow-sm overflow-hidden">
        {stats.map(s => (
          <div
            key={s.label}
            className="flex flex-col items-center gap-1.5 px-2 py-5 border-r border-indigo-50 last:border-r-0"
          >
            <s.icon className={`w-5 h-5 ${s.color}`} />
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-slate-400 text-center leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full">
        {studyGoalDone ? (
          <div className="flex items-center gap-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl px-5 py-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <CheckCircleIcon className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-emerald-800">Study goal complete</div>
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="number" min={1} max={100} value={extraStudyCount}
                  onChange={e => setExtraStudyCount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-14 border border-emerald-200 rounded-lg px-2 py-1 text-sm text-center bg-white focus:outline-none focus:border-emerald-400"
                />
                <button
                  onClick={startExtraStudy}
                  className="text-sm font-semibold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 transition-colors"
                >
                  Study extra <ArrowRightIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : studyCount > 0 ? (
          <Link
            href="/practice/study"
            className="group flex items-center gap-4 bg-white border border-indigo-100 rounded-2xl px-5 py-4 shadow-sm hover:bg-indigo-50/60 transition-colors"
          >
            <div className="w-11 h-11 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <BookIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-slate-800">Study Words</div>
              <div className="text-sm text-slate-400">{studyCount} ready to learn</div>
            </div>
            <ArrowRightIcon className="w-5 h-5 text-indigo-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        ) : (
          <div className="flex items-center gap-4 bg-white border border-slate-100 rounded-2xl px-5 py-4 shadow-sm">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-300 flex items-center justify-center shrink-0">
              <BookIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-slate-400">Study Words</div>
              <div className="text-sm text-slate-400">Nothing new right now</div>
            </div>
          </div>
        )}

        {reviewCount > 0 ? (
          <Link
            href="/practice/review"
            className="group flex items-center gap-4 bg-white border border-purple-100 rounded-2xl px-5 py-4 shadow-sm hover:bg-purple-50/60 transition-colors"
          >
            <div className="w-11 h-11 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
              <RefreshIcon className="w-5 h-5" />
            </div>
            <div className="flex-1 text-left">
              <div className="font-semibold text-slate-800">Review Words</div>
              <div className="text-sm text-slate-400">{reviewCount} due today</div>
            </div>
            <ArrowRightIcon className="w-5 h-5 text-purple-300 group-hover:text-purple-500 group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        ) : (
          <div className="flex items-center gap-4 bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
              <RefreshIcon className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-slate-500">Nothing due to review</div>
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="number" min={1} max={100} value={extraReviewCount}
                  onChange={e => setExtraReviewCount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center bg-white focus:outline-none focus:border-purple-400"
                />
                <button
                  onClick={startExtraReview}
                  className="text-sm font-semibold text-purple-700 hover:text-purple-900 inline-flex items-center gap-1 transition-colors"
                >
                  Review extra <ArrowRightIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
