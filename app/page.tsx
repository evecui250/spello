'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSession, getStreak, getAllProgress } from '../lib/storage';
import { WORDS } from '../lib/words';

export default function HomePage() {
  const [session, setSession] = useState({ done: 0, total: 0 });
  const [streak, setStreak] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);

  useEffect(() => {
    const s = getSession();
    setSession({ done: s.done, total: s.total });
    setStreak(getStreak().count);
    const progress = getAllProgress();
    setMasteredCount(Object.values(progress).filter(p => p.mastered).length);
  }, []);

  const pct = session.total > 0 ? Math.round((session.done / session.total) * 100) : 0;
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - (session.total > 0 ? session.done / session.total : 0));

  return (
    <div className="flex flex-col items-center gap-8 py-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-indigo-700">Wortschatz B2</h1>
        <p className="text-slate-500 mt-1">German vocabulary trainer</p>
      </div>

      {/* Progress ring */}
      <div className="relative">
        <svg width={128} height={128} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={64} cy={64} r={r} fill="none" stroke="#e0e7ff" strokeWidth={10} />
          <circle
            cx={64} cy={64} r={r}
            fill="none" stroke="#6366f1" strokeWidth={10}
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-indigo-700">{pct}%</span>
          <span className="text-xs text-slate-400">today</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-6 text-center">
        <div className="bg-white rounded-2xl px-6 py-4 shadow-sm border border-indigo-50">
          <div className="text-2xl font-bold text-orange-500">{streak}</div>
          <div className="text-xs text-slate-500 mt-1">day streak 🔥</div>
        </div>
        <div className="bg-white rounded-2xl px-6 py-4 shadow-sm border border-indigo-50">
          <div className="text-2xl font-bold text-green-600">{masteredCount}</div>
          <div className="text-xs text-slate-500 mt-1">mastered</div>
        </div>
        <div className="bg-white rounded-2xl px-6 py-4 shadow-sm border border-indigo-50">
          <div className="text-2xl font-bold text-indigo-600">{WORDS.length}</div>
          <div className="text-xs text-slate-500 mt-1">total words</div>
        </div>
      </div>

      <Link
        href="/practice"
        className="bg-indigo-600 text-white px-10 py-4 rounded-2xl text-lg font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
      >
        Start Practice
      </Link>

      {session.total > 0 && (
        <p className="text-slate-500 text-sm">
          {session.done} / {session.total} words done today
        </p>
      )}
    </div>
  );
}
