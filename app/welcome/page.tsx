'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveSettings, markOnboardingDone, Settings } from '../../lib/storage';
import { estimateProgressForecast, recommendedDailyReview } from '../../lib/practice';
import { scheduleSync } from '../../lib/sync';
import Logo from '../../components/Logo';

export default function WelcomePage() {
  const router = useRouter();
  const [studyBatchSize, setStudyBatchSize] = useState(15);
  const [dailyReview, setDailyReview] = useState(25);
  const [masteryThreshold, setMasteryThreshold] = useState(3);
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);

  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize, dailyReview, masteryThreshold),
    [studyBatchSize, dailyReview, masteryThreshold],
  );
  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize, masteryThreshold),
    [studyBatchSize, masteryThreshold],
  );

  const finish = (settings: Settings) => {
    saveSettings(settings);
    scheduleSync();
    markOnboardingDone();
    router.push('/');
  };

  const handleStart = () => {
    finish({
      studyBatchSize, dailyReview, masteryThreshold,
      language: 'de', level: 'B2', autoPlayAudio, requireArticle: false,
    });
  };

  const handleSkip = () => {
    markOnboardingDone();
    router.push('/');
  };

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      <div className="w-full rounded-3xl bg-gradient-to-br from-indigo-50 via-white to-purple-50 border border-indigo-100/70 px-8 py-10 flex flex-col items-center gap-3 text-center">
        <Logo variant="full" size={140} />
        <h1 className="text-xl font-bold text-indigo-700 mt-1">Welcome to Spello</h1>
        <p className="text-slate-500 text-sm max-w-sm">
          You'll be learning German vocabulary at the B2 level. Set your pace below — you can always change it later in Settings.
        </p>
      </div>

      <div className="w-full bg-white rounded-2xl border border-indigo-50 shadow-sm p-6 flex flex-col gap-6">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            New words per day
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={30} value={studyBatchSize}
              onChange={e => setStudyBatchSize(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{studyBatchSize}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Review words per day
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={100} value={dailyReview}
              onChange={e => setDailyReview(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{dailyReview}</span>
          </div>
          {dailyReview !== recommendedReview && (
            <div className="flex items-center justify-between gap-2 mt-2 bg-indigo-50 rounded-lg px-3 py-2 text-sm">
              <span className="text-indigo-700">
                Recommended: <strong>{recommendedReview}</strong> for this study pace
              </span>
              <button
                onClick={() => setDailyReview(recommendedReview)}
                className="shrink-0 bg-indigo-600 text-white px-3 py-1 rounded-lg font-semibold text-xs hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Use {recommendedReview}
              </button>
            </div>
          )}
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Repetitions days
          </label>
          <p className="text-slate-400 text-sm mb-3">
            How many successful reviews a word needs before it's retired as mastered.
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={7} value={masteryThreshold}
              onChange={e => setMasteryThreshold(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{masteryThreshold}</span>
          </div>
        </div>

        <div className="bg-indigo-50 rounded-xl px-4 py-3 text-sm text-indigo-700 flex items-center justify-between gap-3">
          <span className="font-semibold shrink-0">At this pace</span>
          <span className="text-right">
            ~{forecast.daysToIntroduceAll} days to learn all · ~{forecast.daysToMasterAll} days to master all
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-slate-700">
              Auto-play pronunciation
            </label>
            <p className="text-slate-400 text-sm">Speaks new words aloud automatically.</p>
          </div>
          <input
            type="checkbox"
            checked={autoPlayAudio}
            onChange={e => setAutoPlayAudio(e.target.checked)}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 w-full">
        <button
          onClick={handleStart}
          className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
        >
          Start Learning
        </button>
        <button onClick={handleSkip} className="text-slate-400 text-sm hover:text-slate-600 transition-colors">
          Skip, use recommended defaults
        </button>
      </div>
    </div>
  );
}
