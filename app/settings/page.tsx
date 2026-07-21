'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSettings, saveSettings, clearAllProgress, Settings } from '../../lib/storage';
import { estimateProgressForecast, recommendedDailyReview } from '../../lib/practice';
import { scheduleSync } from '../../lib/sync';
import AccountPanel from '../../components/AccountPanel';

export default function SettingsPage() {
  const [studyBatchSize, setStudyBatchSize] = useState(15);
  const [dailyReview, setDailyReview] = useState(25);
  const [masteryThreshold, setMasteryThreshold] = useState(3);
  const [language, setLanguage] = useState('de');
  const [level, setLevel] = useState('B2');
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [requireArticle, setRequireArticle] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadFromStorage = () => {
    const s = getSettings();
    setStudyBatchSize(s.studyBatchSize);
    setDailyReview(s.dailyReview);
    setMasteryThreshold(s.masteryThreshold);
    setLanguage(s.language);
    setLevel(s.level);
    setAutoPlayAudio(s.autoPlayAudio);
    setRequireArticle(s.requireArticle);
  };

  useEffect(loadFromStorage, []);

  // Recomputed live as the sliders move, so the user can see the effect of
  // a pace change immediately.
  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize, dailyReview, masteryThreshold),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studyBatchSize, dailyReview, masteryThreshold, cleared],
  );

  // A word needs (masteryThreshold - 1) more successful reviews after its
  // introduction day to be mastered — this is roughly how many review slots
  // per day are needed to keep up with a given study pace.
  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize, masteryThreshold),
    [studyBatchSize, masteryThreshold],
  );

  // Every control saves immediately on change — no separate Save step.
  // Callers pass the field(s) that just changed; everything else comes
  // from current state, which is already up to date by the time this runs.
  const persist = (patch: Partial<Settings>) => {
    const next: Settings = {
      studyBatchSize, dailyReview, masteryThreshold, language, level, autoPlayAudio, requireArticle, ...patch,
    };
    saveSettings(next);
    scheduleSync();
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  };

  const handleClearAll = () => {
    if (!window.confirm("This will erase all learning progress and your streak — every word starts over. This can't be undone. Continue?")) return;
    clearAllProgress();
    scheduleSync();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Settings</h1>
        <span className={`text-sm font-medium text-emerald-300 transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>
          ✓ Saved
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-6">
        <AccountPanel onSync={loadFromStorage} />
      </div>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-6 flex flex-col gap-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block font-semibold text-slate-700 mb-1">Language</label>
            <select
              value={language}
              onChange={e => { setLanguage(e.target.value); persist({ language: e.target.value }); }}
              className="w-full border-2 border-indigo-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="de">German</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block font-semibold text-slate-700 mb-1">Level</label>
            <select
              value={level}
              onChange={e => { setLevel(e.target.value); persist({ level: e.target.value }); }}
              className="w-full border-2 border-indigo-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="B2">B2</option>
            </select>
          </div>
        </div>
        <p className="text-slate-400 text-sm -mt-4">More languages and levels are coming soon.</p>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            New words per day
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={30} value={studyBatchSize}
              onChange={e => {
                const v = Number(e.target.value);
                setStudyBatchSize(v);
                persist({ studyBatchSize: v });
              }}
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
              onChange={e => {
                const v = Number(e.target.value);
                setDailyReview(v);
                persist({ dailyReview: v });
              }}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{dailyReview}</span>
          </div>
          {dailyReview !== recommendedReview && (
            <div className="flex items-center justify-between gap-2 mt-2 bg-indigo-50 rounded-lg px-3 py-2 text-sm">
              <span className="text-indigo-700">
                💡 Recommended: <strong>{recommendedReview}</strong> — keeps up with {studyBatchSize}/session at {masteryThreshold} reviews to master
              </span>
              <button
                onClick={() => { setDailyReview(recommendedReview); persist({ dailyReview: recommendedReview }); }}
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
            Coins (round 5 passes) a word needs to be fully mastered and retired.
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={7} value={masteryThreshold}
              onChange={e => {
                const v = Number(e.target.value);
                setMasteryThreshold(v);
                persist({ masteryThreshold: v });
              }}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{masteryThreshold}</span>
          </div>
        </div>

        <div className="bg-indigo-50 rounded-xl px-4 py-3 text-sm text-indigo-700 flex items-center justify-between gap-3">
          <span className="font-semibold shrink-0">At this pace</span>
          <span className="text-right">
            {forecast.wordsRemaining === 0
              ? 'All words introduced'
              : `~${forecast.daysToIntroduceAll} days to learn all`}
            {' · '}~{forecast.daysToMasterAll} days to master all
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-slate-700">
              Auto-play pronunciation
            </label>
            <p className="text-slate-400 text-sm">Speaks Round 1 words aloud automatically.</p>
          </div>
          <input
            type="checkbox"
            checked={autoPlayAudio}
            onChange={e => { setAutoPlayAudio(e.target.checked); persist({ autoPlayAudio: e.target.checked }); }}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-slate-700">
              Practice der/die/das
            </label>
            <p className="text-slate-400 text-sm">Also blanks the article for nouns, so you have to recall the gender too.</p>
          </div>
          <input
            type="checkbox"
            checked={requireArticle}
            onChange={e => { setRequireArticle(e.target.checked); persist({ requireArticle: e.target.checked }); }}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-sm text-amber-700">
        Changes apply starting with your next practice session — an in-progress one keeps its original settings.
      </div>

      <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-6 flex flex-col gap-3">
        <div>
          <h2 className="font-semibold text-red-700">Danger zone</h2>
          <p className="text-slate-400 text-sm mt-1">
            Erase all word progress, coins, and your streak to start over from scratch.
          </p>
        </div>
        <button
          onClick={handleClearAll}
          className="w-full bg-red-50 text-red-700 border-2 border-red-100 py-3 rounded-xl font-semibold hover:bg-red-100 active:scale-95 transition-all"
        >
          {cleared ? '✓ Cleared!' : 'Clear all progress'}
        </button>
      </div>
    </div>
  );
}
