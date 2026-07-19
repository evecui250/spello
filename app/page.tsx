'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getStreak, getAllProgress, getSettings, isStudyGoalDoneToday, setExtraStudyLimit,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords } from '../lib/practice';
import { WORDS } from '../lib/words';
import Logo from '../components/Logo';

export default function HomePage() {
  const router = useRouter();
  const [streak, setStreak] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [learningCount, setLearningCount] = useState(0);
  const [studyCount, setStudyCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [studyGoalDone, setStudyGoalDone] = useState(false);
  const [extraCount, setExtraCount] = useState(10);

  useEffect(() => {
    setStreak(getStreak().count);
    const progress = getAllProgress();
    setMasteredCount(Object.values(progress).filter(p => p.fullyMastered).length);
    setLearningCount(Object.values(progress).filter(p => !p.fullyMastered && p.studiedTimes >= 1).length);
    const settings = getSettings();
    setStudyCount(buildStudyWords(settings.studyBatchSize).length);
    setReviewCount(buildReviewWords(settings.dailyReview).length);
    setStudyGoalDone(isStudyGoalDoneToday());
  }, []);

  const startExtraStudy = () => {
    setExtraStudyLimit(extraCount);
    router.push('/practice/study');
  };

  return (
    <div className="flex flex-col items-center gap-8 py-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo variant="full" size={180} />
        <p className="text-slate-500 -mt-2">Master spelling, one word at a time.</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-md">
        <div className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-indigo-50 text-center">
          <div className="text-2xl font-bold text-orange-500">{streak}</div>
          <div className="text-xs text-slate-500 mt-1">day streak 🔥</div>
        </div>
        <div className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-indigo-50 text-center">
          <div className="text-2xl font-bold text-blue-500">{learningCount}</div>
          <div className="text-xs text-slate-500 mt-1">learning</div>
        </div>
        <div className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-indigo-50 text-center">
          <div className="text-2xl font-bold text-green-600">{masteredCount}</div>
          <div className="text-xs text-slate-500 mt-1">mastered</div>
        </div>
        <div className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-indigo-50 text-center">
          <div className="text-2xl font-bold text-indigo-600">{WORDS.length}</div>
          <div className="text-xs text-slate-500 mt-1">total words</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        {studyGoalDone ? (
          <>
            <div className="text-center px-8 py-4 rounded-2xl text-lg font-semibold bg-green-50 text-green-700 border-2 border-green-100">
              ✓ Today's study goal complete
            </div>
            <div className="flex items-center gap-2 justify-center">
              <span className="text-slate-500 text-sm">Study extra:</span>
              <input
                type="number" min={1} max={100} value={extraCount}
                onChange={e => setExtraCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-16 border-2 border-indigo-200 rounded-lg px-2 py-1 text-center focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={startExtraStudy}
                className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg font-semibold text-sm hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Study Extra →
              </button>
            </div>
          </>
        ) : (
          <Link
            href="/practice/study"
            className={`text-center px-8 py-4 rounded-2xl text-lg font-semibold shadow-md active:scale-95 transition-all ${
              studyCount > 0
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-indigo-100 text-indigo-300 pointer-events-none'
            }`}
          >
            Study Words {studyCount > 0 && `(${studyCount})`}
          </Link>
        )}
        <Link
          href="/practice/review"
          className={`text-center px-8 py-4 rounded-2xl text-lg font-semibold shadow-md active:scale-95 transition-all ${
            reviewCount > 0
              ? 'bg-white text-indigo-700 border-2 border-indigo-200 hover:bg-indigo-50'
              : 'bg-white text-indigo-200 border-2 border-indigo-50 pointer-events-none'
          }`}
        >
          Review Words {reviewCount > 0 && `(${reviewCount})`}
        </Link>
      </div>
    </div>
  );
}
