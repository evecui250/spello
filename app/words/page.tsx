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

  // A word only "earns" its puppy the first time it clears round 5 —
  // studiedTimes stays 0 while it's still mid-ladder (rounds 1-4), even
  // though it already has a progress record. Until then it still reads as
  // New, same as a word that hasn't been touched at all.
  const earned = (p?: WordProgress) => !!p && p.studiedTimes > 0;

  const filtered = WORDS.filter(w => {
    const p = progress[w.id];
    if (filterLevel === 'new' && earned(p)) return false;
    if (filterLevel === 'mastered' && !p?.fullyMastered) return false;
    if (filterLevel === 'learning' && (!earned(p) || p?.fullyMastered)) return false;
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
        className="bg-amber-50/75 backdrop-blur-sm border-2 border-white/30 rounded-xl px-4 py-2 text-stone-800 placeholder:text-stone-500 focus:outline-none focus:border-amber-300"
      />

      <div className="flex gap-2 flex-wrap">
        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-300"
        >
          <option value="all">All words</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="mastered">Mastered</option>
        </select>

        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-amber-50/75 backdrop-blur-sm border border-white/30 rounded-lg px-3 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-amber-300"
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
              <span className="font-semibold text-stone-800">
                {w.article ? `${w.article} ` : ''}{w.de}
              </span>
              <SpeakerButton word={w} className="ml-1.5 text-indigo-600 hover:text-indigo-800 transition-colors align-middle" />
              {w.plural && <span className="text-stone-500 text-sm ml-2">· {w.plural}</span>}
              <div className="text-stone-500 text-sm">{w.en}</div>
            </div>
            <span className="shrink-0">
              {earned(progress[w.id]) ? (
                <DachshundMascot stage={progress[w.id].mascotStage} className="w-9 h-9" />
              ) : (
                <span className="flex items-center justify-center px-2.5 py-1.5 rounded-full bg-slate-100">
                  <span className="text-xs font-medium text-stone-500">New</span>
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
