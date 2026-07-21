'use client';

import { useEffect, useState } from 'react';
import { WORDS, CATEGORIES } from '../../lib/words';
import { getAllProgress, WordProgress } from '../../lib/storage';
import SpeakerButton from '../../components/SpeakerButton';
import DachshundMascot from '../../components/Mascot';

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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Word List</h1>

      <input
        type="search"
        placeholder="Search German or English…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="bg-amber-50/75 backdrop-blur-sm border-2 border-white/30 rounded-xl px-4 py-2 focus:outline-none focus:border-amber-300"
      />

      <div className="flex gap-2 flex-wrap">
        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-300"
        >
          <option value="all">All words</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="mastered">Mastered</option>
        </select>

        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-300"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <p className="text-emerald-100/70 text-sm">{filtered.length} words</p>

      <div className="flex flex-col gap-2">
        {filtered.map(w => (
          <div key={w.id} className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex items-center justify-between">
            <div>
              <span className="font-semibold text-indigo-800">
                {w.article ? `${w.article} ` : ''}{w.de}
              </span>
              <SpeakerButton word={w} className="ml-1.5 text-indigo-400 hover:text-indigo-600 transition-colors align-middle" />
              {w.plural && <span className="text-slate-400 text-sm ml-2">· {w.plural}</span>}
              <div className="text-slate-500 text-sm">{w.en}</div>
            </div>
            <span className="shrink-0">
              {progress[w.id] ? (
                <DachshundMascot stage={progress[w.id].mascotStage} className="w-9 h-9" />
              ) : (
                <span className="flex items-center justify-center px-2.5 py-1.5 rounded-full bg-slate-100">
                  <span className="text-xs font-medium text-slate-500">New</span>
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
