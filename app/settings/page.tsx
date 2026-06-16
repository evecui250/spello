'use client';

import { useEffect, useState } from 'react';
import { getSettings, saveSettings } from '../../lib/storage';

export default function SettingsPage() {
  const [dailyNew, setDailyNew] = useState(10);
  const [dailyReview, setDailyReview] = useState(20);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = getSettings();
    setDailyNew(s.dailyNew);
    setDailyReview(s.dailyReview);
  }, []);

  const handleSave = () => {
    saveSettings({ dailyNew, dailyReview });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-indigo-700">Settings</h1>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-6 flex flex-col gap-6">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            New words per day
          </label>
          <p className="text-slate-400 text-sm mb-3">Words you haven't seen yet.</p>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={30} value={dailyNew}
              onChange={e => setDailyNew(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{dailyNew}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Review words per day
          </label>
          <p className="text-slate-400 text-sm mb-3">Words you've seen before.</p>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={50} value={dailyReview}
              onChange={e => setDailyReview(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-indigo-700">{dailyReview}</span>
          </div>
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
    </div>
  );
}
