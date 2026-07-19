'use client';

import { useEffect, useState } from 'react';
import { getSettings, saveSettings, clearAllProgress } from '../../lib/storage';

export default function SettingsPage() {
  const [studyBatchSize, setStudyBatchSize] = useState(10);
  const [dailyReview, setDailyReview] = useState(20);
  const [masteryThreshold, setMasteryThreshold] = useState(5);
  const [language, setLanguage] = useState('de');
  const [level, setLevel] = useState('B2');
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const s = getSettings();
    setStudyBatchSize(s.studyBatchSize);
    setDailyReview(s.dailyReview);
    setMasteryThreshold(s.masteryThreshold);
    setLanguage(s.language);
    setLevel(s.level);
    setAutoPlayAudio(s.autoPlayAudio);
  }, []);

  const handleSave = () => {
    saveSettings({ studyBatchSize, dailyReview, masteryThreshold, language, level, autoPlayAudio });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearAll = () => {
    if (!window.confirm("This will erase all learning progress and your streak — every word starts over. This can't be undone. Continue?")) return;
    clearAllProgress();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-indigo-700">Settings</h1>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-6 flex flex-col gap-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block font-semibold text-slate-700 mb-1">Language</label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="w-full border-2 border-indigo-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="de">German</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block font-semibold text-slate-700 mb-1">Level</label>
            <select
              value={level}
              onChange={e => setLevel(e.target.value)}
              className="w-full border-2 border-indigo-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              <option value="B2">B2</option>
            </select>
          </div>
        </div>
        <p className="text-slate-400 text-sm -mt-4">More languages and levels are coming soon.</p>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Words per study session
          </label>
          <p className="text-slate-400 text-sm mb-3">
            New and in-progress words (round 1-4) pulled into each study batch.
          </p>
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
          <p className="text-slate-400 text-sm mb-3">Words that have earned at least one coin.</p>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={50} value={dailyReview}
              onChange={e => setDailyReview(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{dailyReview}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Reviews to fully master a word
          </label>
          <p className="text-slate-400 text-sm mb-3">
            Coins (round 5 passes) a word needs to be fully mastered and retired.
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={10} value={masteryThreshold}
              onChange={e => setMasteryThreshold(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{masteryThreshold}</span>
          </div>
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
            onChange={e => setAutoPlayAudio(e.target.checked)}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>

        <button
          onClick={handleSave}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
        >
          {saved ? '✓ Saved!' : 'Save settings'}
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-sm text-amber-700">
        Changes take effect at the start of your next practice session.
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
