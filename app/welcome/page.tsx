'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSettings, saveSettings, markOnboardingDone, Settings, MascotStageId } from '../../lib/storage';
import { daysToWeeks, estimateProgressForecast, recommendedDailyReview } from '../../lib/practice';
import { Level } from '../../lib/words';
import { scheduleSync } from '../../lib/sync';
import DachshundMascot from '../../components/Mascot';

const STEPS = ['level', 'pace', 'mascots'] as const;
type Step = typeof STEPS[number];

// Same stage labels as Word List/Progress (STAGE_LABEL there) — avoids
// "dachshund" (many learners won't recognize the breed name) and skips
// explaining what actually happens in each round (translate, hints,
// etc.) in favor of just the rhythm: how many days apart each review is.
// Gaps mirror lib/srs.ts's OFFSET_AFTER_STAGE (1, 3, 5 days) exactly.
const MASCOT_GROWTH: { id: MascotStageId; label: string }[] = [
  { id: 'puppy', label: 'New' },
  { id: 'short', label: 'Familiar' },
  { id: 'medium', label: 'Strong' },
  { id: 'long-crowned', label: 'Mastered' },
];
const GROWTH_GAP_DAYS = [1, 3, 5];

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
  const [step, setStep] = useState<Step>('level');

  // Lazily seeded from whatever's already saved (relevant when this page is
  // revisited from Settings after onboarding is done) — falls back to the
  // same defaults a first-time visitor gets, so clicking through without
  // changing anything just re-saves what was already there instead of
  // silently resetting it to these defaults.
  const existing = useMemo(() => getSettings(), []);
  const [level, setLevel] = useState<Level>(existing.level);
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>(existing.nativeLanguage);
  const [studyBatchSize, setStudyBatchSize] = useState(existing.studyBatchSize);
  const [dailyReview, setDailyReview] = useState(existing.dailyReview);
  const [autoPlayAudio, setAutoPlayAudio] = useState(existing.autoPlayAudio);
  const [requireArticle, setRequireArticle] = useState(existing.requireArticle);

  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize, dailyReview),
    [studyBatchSize, dailyReview],
  );
  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize),
    [studyBatchSize],
  );

  const finish = () => {
    const settings: Settings = {
      studyBatchSize, dailyReview, language: 'de', nativeLanguage, level, autoPlayAudio, requireArticle,
      sentenceWritingMode: true,
    };
    saveSettings(settings);
    scheduleSync();
    markOnboardingDone();
    router.push('/');
  };

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      <div className="flex flex-col items-center gap-3 text-center px-4">
        <h1 className="text-xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Welcome to Spello</h1>
        <StepDots step={step} />
      </div>

      {step === 'level' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4">
            <p className="text-stone-500 text-sm -mt-1">
              Defaults are fine if you&apos;re not sure — you can always change this later in Settings.
            </p>
            <div>
              <label className="block font-semibold text-stone-800 mb-1">Level</label>
              <select
                value={level}
                onChange={e => setLevel(e.target.value as Level)}
                className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="A1">A1</option>
                <option value="A2">A2</option>
                <option value="B1">B1</option>
                <option value="B2">B2</option>
              </select>
            </div>
            <p className="text-stone-400 text-sm">Not sure which level? A1 is the easiest, for absolute beginners — B2 is the most advanced available right now.</p>
            <div>
              <label className="block font-semibold text-stone-800 mb-1">Learn with</label>
              <select
                value={nativeLanguage}
                onChange={e => setNativeLanguage(e.target.value as 'en' | 'zh')}
                className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="en">English</option>
                <option value="zh">中文 (Chinese)</option>
              </select>
            </div>
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
                ~{daysToWeeks(forecast.daysToMasterAll)} weeks to master all
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
              onClick={() => setStep('level')}
              className="flex-1 bg-amber-50/75 text-stone-700 py-3.5 rounded-2xl font-semibold border border-amber-100/50 hover:bg-amber-50 active:scale-95 transition-all"
            >
              Back
            </button>
            <button
              onClick={() => setStep('mascots')}
              className="flex-[2] bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'mascots' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4">
            <p className="text-stone-500 text-sm">
              Every word grows through 4 stages as you review it on schedule:
            </p>
            <div className="flex flex-col items-center">
              {MASCOT_GROWTH.map((m, i) => (
                <div key={m.id} className="flex flex-col items-center">
                  <div className="flex items-center gap-3">
                    <DachshundMascot stage={m.id} className="w-11 h-11 shrink-0" />
                    <span className="text-sm font-semibold text-stone-700">{m.label}</span>
                  </div>
                  {i < MASCOT_GROWTH.length - 1 && (
                    <div className="flex flex-col items-center py-0.5">
                      <span className="text-indigo-400 text-base leading-none">↓</span>
                      <span className="text-stone-400 text-[11px] whitespace-nowrap">+{GROWTH_GAP_DAYS[i]} days</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setStep('pace')}
              className="flex-1 bg-amber-50/75 text-stone-700 py-3.5 rounded-2xl font-semibold border border-amber-100/50 hover:bg-amber-50 active:scale-95 transition-all"
            >
              Back
            </button>
            <button
              onClick={finish}
              className="flex-[2] bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Start Learning
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
