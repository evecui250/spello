'use client';

import { useEffect, useState } from 'react';
import { getAllProgress, getStreak } from '../../lib/storage';
import { WORDS } from '../../lib/words';

export default function StatsPage() {
  const [counts, setCounts] = useState({ new: 0, l0: 0, l1: 0, l2: 0, mastered: 0 });
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const progress = getAllProgress();
    let n = 0, l0 = 0, l1 = 0, l2 = 0, m = 0;
    for (const w of WORDS) {
      const p = progress[w.id];
      if (!p || p.level === -1) n++;
      else if (p.mastered) m++;
      else if (p.level === 0) l0++;
      else if (p.level === 1) l1++;
      else if (p.level === 2) l2++;
    }
    setCounts({ new: n, l0, l1, l2, mastered: m });
    setStreak(getStreak().count);
  }, []);

  const total = WORDS.length;
  const bars = [
    { label: 'New', count: counts.new, color: 'bg-slate-300' },
    { label: 'Level 0', count: counts.l0, color: 'bg-yellow-400' },
    { label: 'Level 1', count: counts.l1, color: 'bg-blue-400' },
    { label: 'Level 2', count: counts.l2, color: 'bg-indigo-500' },
    { label: 'Mastered', count: counts.mastered, color: 'bg-green-500' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-indigo-700">Statistics</h1>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">Daily Streak</span>
          <span className="text-2xl font-bold text-orange-500">{streak} 🔥</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-700">Words Mastered</span>
          <span className="text-2xl font-bold text-green-600">{counts.mastered} / {total}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-indigo-50 shadow-sm p-5">
        <h2 className="font-semibold text-slate-700 mb-4">Progress breakdown</h2>
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
