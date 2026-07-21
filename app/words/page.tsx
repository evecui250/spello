'use client';

import { useEffect, useState } from 'react';
import { WORDS, CATEGORIES, Word } from '../../lib/words';
import { getAllProgress, WordProgress, MascotStageId } from '../../lib/storage';
import SpeakerButton from '../../components/SpeakerButton';
import DachshundMascot from '../../components/Mascot';

const STAGE_BADGE_BG: Record<MascotStageId, string> = {
  puppy: 'bg-slate-100',
  short: 'bg-amber-50',
  medium: 'bg-amber-100',
  'long-crowned': 'bg-green-100',
};
const STAGE_BADGE_COLOR: Record<MascotStageId, string> = {
  puppy: 'text-slate-500',
  short: 'text-amber-700',
  medium: 'text-amber-800',
  'long-crowned': 'text-emerald-700',
};

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

  const badgeBg = (w: Word) => {
    const p = progress[w.id];
    return p ? STAGE_BADGE_BG[p.mascotStage] : 'bg-slate-100';
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Word List</h1>

      <input
        type="search"
        placeholder="Search German or English…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="bg-amber-50/90 border-2 border-white/30 rounded-xl px-4 py-2 focus:outline-none focus:border-amber-300"
      />

      <div className="flex gap-2 flex-wrap">
        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          className="bg-amber-50/90 border border-white/30 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-300"
        >
          <option value="all">All words</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="mastered">Mastered</option>
        </select>

        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-amber-50/90 border border-white/30 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-amber-300"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <p className="text-emerald-100/70 text-sm">{filtered.length} words</p>

      <div className="flex flex-col gap-2">
        {filtered.map(w => (
          <div key={w.id} className="bg-amber-50/95 rounded-xl border border-amber-100 shadow-sm px-4 py-3 flex items-center justify-between">
            <div>
              <span className="font-semibold text-indigo-800">
                {w.article ? `${w.article} ` : ''}{w.de}
              </span>
              <SpeakerButton word={w} className="ml-1.5 text-indigo-400 hover:text-indigo-600 transition-colors align-middle" />
              {w.plural && <span className="text-slate-400 text-sm ml-2">· {w.plural}</span>}
              <div className="text-slate-500 text-sm">{w.en}</div>
            </div>
            <span className={`flex items-center justify-center px-2.5 py-1.5 rounded-full shrink-0 ${badgeBg(w)}`}>
              {progress[w.id] ? (
                <DachshundMascot
                  stage={progress[w.id].mascotStage}
                  className={`w-9 h-5 ${STAGE_BADGE_COLOR[progress[w.id].mascotStage]}`}
                />
              ) : (
                <span className="text-xs font-medium text-slate-500">New</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
