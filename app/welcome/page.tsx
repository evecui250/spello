'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveSettings, markOnboardingDone, Settings, MascotStageId } from '../../lib/storage';
import { estimateProgressForecast, recommendedDailyReview } from '../../lib/practice';
import { Level } from '../../lib/words';
import { scheduleSync } from '../../lib/sync';
import Logo from '../../components/Logo';
import DachshundMascot from '../../components/Mascot';
import AccountPanel from '../../components/AccountPanel';

const STEPS = ['language', 'pace', 'account', 'mascots'] as const;
type Step = typeof STEPS[number];

const MASCOT_INTRO: { id: MascotStageId; name: string; reviews: string }[] = [
  { id: 'puppy', name: 'Puppy', reviews: 'after first learning' },
  { id: 'short', name: 'Short Dachshund', reviews: 'after your 1st review' },
  { id: 'medium', name: 'Medium Dachshund', reviews: 'after your 2nd review' },
  { id: 'long-crowned', name: 'Long Dachshund with Crown', reviews: 'after your 3rd review — fully mastered' },
];

function StepDots({ step }: { step: Step }) {
  const i = STEPS.indexOf(step);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, idx) => (
        <span
          key={s}
          className={`w-2 h-2 rounded-full transition-colors ${idx === i ? 'bg-amber-200' : idx < i ? 'bg-amber-200/50' : 'bg-white/20'}`}
        />
      ))}
    </div>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('language');

  const [language, setLanguage] = useState('de');
  const [level, setLevel] = useState<Level>('B2');
  const [studyBatchSize, setStudyBatchSize] = useState(15);
  const [dailyReview, setDailyReview] = useState(25);
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [requireArticle, setRequireArticle] = useState(false);

  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize),
    [studyBatchSize],
  );
  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize),
    [studyBatchSize],
  );

  const finish = () => {
    const settings: Settings = {
      studyBatchSize, dailyReview, language, level, autoPlayAudio, requireArticle,
    };
    saveSettings(settings);
    scheduleSync();
    markOnboardingDone();
    router.push('/');
  };

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      <div className="flex flex-col items-center gap-3 text-center px-4">
        <Logo variant="icon" size={64} className="ring-2 ring-white/20" />
        <h1 className="text-xl font-bold text-amber-50 mt-1" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Welcome to Spello</h1>
        <StepDots step={step} />
      </div>

      {step === 'language' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4">
            <p className="text-stone-500 text-sm -mt-1">
              Defaults are fine if you&apos;re not sure — you can always change these later in Settings.
            </p>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block font-semibold text-stone-800 mb-1">Language</label>
                <select
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  className="w-full border-2 border-indigo-200 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
                >
                  <option value="de">German</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block font-semibold text-stone-800 mb-1">Level</label>
                <select
                  value={level}
                  onChange={e => setLevel(e.target.value as Level)}
                  className="w-full border-2 border-indigo-200 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
                >
                  <option value="A1">A1</option>
                  <option value="A2">A2</option>
                  <option value="B2">B2</option>
                </select>
              </div>
            </div>
            <p className="text-stone-400 text-sm">More languages and levels are coming soon.</p>
          </div>
          <button
            onClick={() => setStep('pace')}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Continue
          </button>
        </div>
      )}

      {step === 'pace' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-6">
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
                Max review words per day
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
                <div className="flex items-center justify-between gap-2 mt-2 bg-amber-100/60 rounded-lg px-3 py-2 text-sm">
                  <span className="text-amber-800">
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

            <div className="bg-amber-100/60 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3">
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

            <div className="flex items-center justify-between">
              <div>
                <label className="block font-semibold text-slate-700">
                  Practice articles
                </label>
                <p className="text-slate-400 text-sm">Also type der/die/das, not just the word.</p>
              </div>
              <input
                type="checkbox"
                checked={requireArticle}
                onChange={e => setRequireArticle(e.target.checked)}
                className="w-5 h-5 accent-indigo-600"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('language')}
              className="flex-1 bg-amber-50/75 text-stone-700 py-3.5 rounded-2xl font-semibold border border-amber-100/50 hover:bg-amber-50 active:scale-95 transition-all"
            >
              Back
            </button>
            <button
              onClick={() => setStep('account')}
              className="flex-[2] bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'account' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6">
            <AccountPanel />
          </div>
          <div className="flex flex-col items-center gap-3 w-full">
            <button
              onClick={() => setStep('mascots')}
              className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Continue
            </button>
            <p className="text-emerald-100/50 text-sm">Optional — you can skip this and sign in anytime from Settings.</p>
          </div>
        </div>
      )}

      {step === 'mascots' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4">
            <p className="text-stone-500 text-sm">
              Every word you learn grows its own dachshund as you review it successfully.
            </p>
            <div className="flex flex-col gap-3">
              {MASCOT_INTRO.map(m => (
                <div key={m.id} className="flex items-center gap-3">
                  <DachshundMascot stage={m.id} className="w-14 h-14 shrink-0" />
                  <div>
                    <div className="font-semibold text-stone-800">{m.name}</div>
                    <div className="text-stone-500 text-sm">{m.reviews}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={finish}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Start Learning
          </button>
        </div>
      )}
    </div>
  );
}
