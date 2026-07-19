'use client';

import { useEffect, useState } from 'react';
import { WORDS, CATEGORIES, Word } from '../../lib/words';
import { getAllProgress, WordProgress } from '../../lib/storage';
import SpeakerButton from '../../components/SpeakerButton';

const COIN_COLORS = [
  'bg-slate-100 text-slate-500',
  'bg-yellow-100 text-yellow-700',
  'bg-amber-100 text-amber-700',
  'bg-orange-100 text-orange-700',
  'bg-amber-200 text-amber-800',
];

export default function WordsPage() {
  const [progress, setProgress] = useState<Record<string, WordProgress>>({});
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');

  useEffect(() => {
    setProgress(getAllProgress());
  }, []);

  const filtered = WORDS.filter(w => {
    const p = progress[w.id];
    if (filterLevel === 'new' && p) return false;
    if (filterLevel === 'mastered' && !p?.fullyMastered) return false;
    if (filterLevel === 'learning' && (!p || p.fullyMastered)) return false;
    if (filterCategory !== 'all' && w.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return w.de.toLowerCase().includes(q) || w.en.toLowerCase().includes(q);
    }
    return true;
  });

  const badgeColor = (w: Word) => {
    const p = progress[w.id];
    if (!p) return 'bg-slate-100 text-slate-500';
    if (p.fullyMastered) return 'bg-green-100 text-green-700';
    return COIN_COLORS[Math.min(p.studiedTimes, COIN_COLORS.length - 1)];
  };

  const badgeText = (w: Word) => {
    const p = progress[w.id];
    if (!p) return 'New';
    if (p.fullyMastered) return 'Mastered ✓';
    return `🪙 ${p.studiedTimes}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-indigo-700">Word List</h1>

      <input
        type="search"
        placeholder="Search German or English…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="border-2 border-indigo-200 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500"
      />

      <div className="flex gap-2 flex-wrap">
        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          className="border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
        >
          <option value="all">All words</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="mastered">Mastered</option>
        </select>

        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <p className="text-slate-400 text-sm">{filtered.length} words</p>

      <div className="flex flex-col gap-2">
        {filtered.map(w => (
          <div key={w.id} className="bg-white rounded-xl border border-indigo-50 shadow-sm px-4 py-3 flex items-center justify-between">
            <div>
              <span className="font-semibold text-indigo-800">
                {w.article ? `${w.article} ` : ''}{w.de}
              </span>
              <SpeakerButton text={w.de} className="ml-1.5 text-indigo-400 hover:text-indigo-600 transition-colors align-middle" />
              {w.plural && <span className="text-slate-400 text-sm ml-2">· {w.plural}</span>}
              <div className="text-slate-500 text-sm">{w.en}</div>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${badgeColor(w)}`}>
              {badgeText(w)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
