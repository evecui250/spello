'use client';

import { useEffect, useState } from 'react';
import { getAllProgress, getSettings, getStreak } from '../../lib/storage';
import { WORDS } from '../../lib/words';

const COIN_COLORS = ['bg-slate-300', 'bg-yellow-300', 'bg-yellow-400', 'bg-amber-400', 'bg-amber-500'];

export default function StatsPage() {
  const [coinCounts, setCoinCounts] = useState<number[]>([]);
  const [masteredCount, setMasteredCount] = useState(0);
  const [totalCoins, setTotalCoins] = useState(0);
  const [threshold, setThreshold] = useState(5);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const progress = getAllProgress();
    const settings = getSettings();
    const buckets = Array.from({ length: settings.masteryThreshold }, () => 0);
    let mastered = 0;
    let coinSum = 0;
    for (const w of WORDS) {
      const p = progress[w.id];
      const coins = p?.studiedTimes ?? 0;
      coinSum += coins;
      if (p?.fullyMastered) mastered++;
      else buckets[Math.min(coins, settings.masteryThreshold - 1)]++;
    }
    setCoinCounts(buckets);
    setMasteredCount(mastered);
    setTotalCoins(coinSum);
    setThreshold(settings.masteryThreshold);
    setStreak(getStreak().count);
  }, []);

  const total = WORDS.length;
  const bars = [
    ...coinCounts.map((count, coins) => ({
      label: coins === 0 ? 'No coins yet' : `🪙 × ${coins}`,
      count,
      color: COIN_COLORS[coins] ?? 'bg-amber-500',
    })),
    { label: `Mastered (🪙 × ${threshold})`, count: masteredCount, color: 'bg-green-500' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Statistics</h1>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">Daily Streak</span>
          <span className="text-2xl font-bold text-orange-500">{streak} 🔥</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">Words Mastered</span>
          <span className="text-2xl font-bold text-green-600">{masteredCount} / {total}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">Total coins earned</span>
          <span className="text-2xl font-bold text-amber-500">🪙 {totalCoins}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-5">
        <h2 className="font-semibold text-slate-700 mb-1">Coin breakdown</h2>
        <p className="text-slate-400 text-sm mb-4">
          Each coin is a day a word was successfully studied all the way to level 5.
        </p>
        <div className="flex flex-col gap-3">
          {bars.map(b => (
            <div key={b.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">{b.label}</span>
                <span className="text-slate-400">{b.count}</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-3 rounded-full ${b.color} transition-all`}
                  style={{ width: `${total > 0 ? (b.count / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stacked bar */}
      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-5">
        <h2 className="font-semibold text-slate-700 mb-3">Overall progress</h2>
        <div className="h-6 rounded-full overflow-hidden flex">
          {bars.map(b => (
            <div
              key={b.label}
              className={b.color}
              style={{ width: `${total > 0 ? (b.count / total) * 100 : 0}%` }}
              title={`${b.label}: ${b.count}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          {bars.map(b => (
            <div key={b.label} className="flex items-center gap-1 text-sm">
              <div className={`w-3 h-3 rounded-sm ${b.color}`} />
              <span className="text-slate-500">{b.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
