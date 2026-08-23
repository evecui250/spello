'use client';

// TEMPORARY — Design B: "Accordion". Same 5 groups as Design A, but no
// navigation at all — every group is a collapsible card on one scrolling
// page. Collapsed by default (except Account, opened by default since
// sign-in state is usually the first thing worth seeing), each header
// still shows the same one-line summary so nothing is hidden at a
// glance, just not expanded until tapped. See useSettingsState for the
// shared wiring and the admin page's preview section for the comparison.

import { useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { THEME_CONFIG } from '../AppBackground';
import { Theme, FontScale } from '../../lib/storage';
import { Level } from '../../lib/words';
import AccountPanel from '../AccountPanel';
import ShareCard from '../ShareCard';
import BugReportButton from '../BugReportButton';
import SoundPicker from '../SoundPicker';
import { useSettingsState } from './useSettingsState';

type GroupId = 'account' | 'appearance' | 'learning' | 'more' | 'about';

const FONT_LABEL: Record<FontScale, string> = { small: 'Small', default: 'Default', large: 'Large' };

function Section({ id, icon, title, summary, open, onToggle, children }: {
  id: GroupId; icon: string; title: string; summary: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-amber-50/90 rounded-2xl border border-amber-100/50 shadow-sm overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left">
        <span className="text-xl w-7 text-center shrink-0">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-stone-800">{title}</span>
          {!open && <span className="block text-xs text-stone-400 truncate">{summary}</span>}
        </span>
        <span className={`text-stone-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t border-amber-100/60 flex flex-col gap-5">{children}</div>}
    </div>
  );
}

export default function SettingsDesignB() {
  const s = useSettingsState();
  const [open, setOpen] = useState<Record<GroupId, boolean>>({ account: true, appearance: false, learning: false, more: false, about: false });
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const toggle = (id: GroupId) => setOpen(o => ({ ...o, [id]: !o[id] }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Settings</h1>
        <span className={`text-sm font-medium text-emerald-300 transition-opacity ${s.saved ? 'opacity-100' : 'opacity-0'}`}>✓ Saved</span>
      </div>

      <Section id="account" icon="👤" title="Account" summary={s.signedInEmail ? `Signed in as ${s.signedInEmail}` : 'Not signed in'} open={open.account} onToggle={() => toggle('account')}>
        <AccountPanel onSync={s.loadFromStorage} />
      </Section>

      <Section id="appearance" icon="🎨" title="Appearance" summary={`${s.theme[0].toUpperCase()}${s.theme.slice(1)} theme · ${FONT_LABEL[s.fontScale]} text · ${s.soundName} sound`} open={open.appearance} onToggle={() => toggle('appearance')}>
        <div>
          <label className="block font-semibold text-stone-800 mb-3">Theme</label>
          <div className="grid grid-cols-5 gap-x-2 gap-y-3">
            {(Object.keys(THEME_CONFIG) as Theme[]).map(t => {
              const cfg = THEME_CONFIG[t];
              const isSelected = s.theme === t;
              return (
                <button key={t} type="button" onClick={() => s.handleThemeChange(t)} className="flex flex-col items-center gap-1">
                  <span className={`w-9 h-9 rounded-full bg-gradient-to-b ${cfg.gradient} transition-all ${isSelected ? 'ring-2 ring-offset-2 ring-offset-amber-50 ring-indigo-500 scale-110' : 'ring-1 ring-black/10'}`} />
                  <span className={`text-[11px] font-medium capitalize ${isSelected ? 'text-indigo-700' : 'text-stone-500'}`}>{t}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block font-semibold text-stone-800 mb-3">Font size</label>
          <div className="grid grid-cols-3 gap-2">
            {(['small', 'default', 'large'] as FontScale[]).map(v => {
              const isSelected = s.fontScale === v;
              return (
                <button key={v} type="button" onClick={() => s.handleFontScaleChange(v)} className={`flex flex-col items-center gap-1 rounded-xl py-3 border-2 transition-colors ${isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-stone-200'}`}>
                  <span className={`font-bold text-stone-800 ${v === 'small' ? 'text-sm' : v === 'large' ? 'text-lg' : 'text-base'}`}>Aa</span>
                  <span className={`text-xs font-medium ${isSelected ? 'text-indigo-700' : 'text-stone-500'}`}>{FONT_LABEL[v]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block font-semibold text-stone-800 mb-3">Correct-answer sound</label>
          <SoundPicker />
        </div>
      </Section>

      <Section id="learning" icon="📚" title="Learning" summary={`${s.level} · ${s.studyBatchSize} new/day · ${s.dailyReview} review/day`} open={open.learning} onToggle={() => toggle('learning')}>
        <div>
          <label className="block font-semibold text-stone-800 mb-1">Level</label>
          <select value={s.level} onChange={e => s.handleLevelChange(e.target.value as Level)} className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500">
            <option value="A1">A1</option><option value="A2">A2</option><option value="B1">B1</option><option value="B2">B2</option>
          </select>
          <p className="text-stone-500 text-sm mt-1">This vocabulary book has {s.wordsForLevel(s.level).length} words for {s.level}.</p>
          {s.LEVEL_SOURCE[s.level] && <p className="text-stone-400 text-xs mt-0.5">{s.LEVEL_SOURCE[s.level]}</p>}
        </div>
        <div>
          <label className="block font-semibold text-stone-800 mb-1">Learn with</label>
          <select value={s.nativeLanguage} onChange={e => { const v = e.target.value as 'en' | 'zh'; s.setNativeLanguage(v); s.persist({ nativeLanguage: v }); }} className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500">
            <option value="en">English</option><option value="zh">中文 (Chinese)</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold text-stone-800 mb-1">New words per day</label>
          <div className="flex items-center gap-4">
            <input type="range" min={1} max={30} value={s.studyBatchSize} onChange={e => { const v = Number(e.target.value); s.setStudyBatchSize(v); s.persist({ studyBatchSize: v }); }} className="flex-1 accent-indigo-600" />
            <span className="w-8 text-center font-bold text-stone-800">{s.studyBatchSize}</span>
          </div>
        </div>
        <div>
          <label className="block font-semibold text-stone-800 mb-1">Max review words per day</label>
          <div className="flex items-center gap-4">
            <input type="range" min={1} max={100} value={s.dailyReview} onChange={e => { const v = Number(e.target.value); s.setDailyReview(v); s.persist({ dailyReview: v }); }} className="flex-1 accent-indigo-600" />
            <span className="w-8 text-center font-bold text-stone-800">{s.dailyReview}</span>
          </div>
          {s.dailyReview !== s.recommendedReview && (
            <div className="flex items-center justify-between gap-2 mt-2 bg-amber-100/60 rounded-lg px-3 py-2 text-sm">
              <span className="text-stone-800">💡 Recommended: <strong>{s.recommendedReview}</strong></span>
              <button onClick={() => { s.setDailyReview(s.recommendedReview); s.persist({ dailyReview: s.recommendedReview }); }} className="shrink-0 bg-indigo-600 text-white px-3 py-1 rounded-lg font-semibold text-xs hover:bg-indigo-700 active:scale-95 transition-all">
                Use {s.recommendedReview}
              </button>
            </div>
          )}
        </div>
        <div className="bg-amber-100/60 rounded-xl px-4 py-3 text-sm text-stone-800 flex items-center justify-between gap-3">
          <span className="font-semibold">At this pace</span>
          <span>~{s.daysToWeeks(s.forecast.daysToMasterAll)} weeks to master all</span>
        </div>
        <div className="flex items-center justify-between">
          <label className="font-semibold text-stone-800">Auto-play pronunciation</label>
          <input type="checkbox" checked={s.autoPlayAudio} onChange={e => { s.setAutoPlayAudio(e.target.checked); s.persist({ autoPlayAudio: e.target.checked }); }} className="w-5 h-5 accent-indigo-600" />
        </div>
        <div className="flex items-center justify-between">
          <label className="font-semibold text-stone-800">Practice articles</label>
          <input type="checkbox" checked={s.requireArticle} onChange={e => { s.setRequireArticle(e.target.checked); s.persist({ requireArticle: e.target.checked }); }} className="w-5 h-5 accent-indigo-600" />
        </div>
        <div className="flex items-center justify-between">
          <label className="font-semibold text-stone-800">Sentence writing mode</label>
          <input type="checkbox" checked={s.sentenceWritingMode} onChange={e => { s.setSentenceWritingMode(e.target.checked); s.persist({ sentenceWritingMode: e.target.checked }); }} className="w-5 h-5 accent-indigo-600" />
        </div>
      </Section>

      <Section id="more" icon="✨" title="More" summary="Guide, sharing, mini-game" open={open.more} onToggle={() => toggle('more')}>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/welcome" className="text-center bg-amber-50 rounded-2xl border border-amber-100 shadow-sm p-4 font-semibold text-stone-700 hover:bg-amber-100/40 transition-colors">View welcome guide</Link>
          <ShareCard />
        </div>
        <Link href="/game?source=settings_preview" className="text-center bg-amber-50 rounded-2xl border border-amber-100 shadow-sm py-3 px-4 font-semibold text-stone-700 hover:bg-amber-100/40 active:scale-[0.99] transition-all">🎮 Try the new word-match game (preview)</Link>
      </Section>

      <Section id="about" icon="ℹ️" title="About" summary="Terms, privacy, reset" open={open.about} onToggle={() => toggle('about')}>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          <Link href="/terms" className="text-indigo-600 hover:text-indigo-800 underline">Terms of Service</Link>
          <Link href="/privacy" className="text-indigo-600 hover:text-indigo-800 underline">Privacy Policy</Link>
          <BugReportButton />
          <button type="button" onClick={() => setResetModalOpen(true)} className="text-red-600 hover:text-red-800 underline">Reset</button>
          {s.signedInEmail === s.ADMIN_EMAIL && <Link href="/admin" className="text-indigo-600 hover:text-indigo-800 underline">Admin</Link>}
        </div>
      </Section>

      {resetModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setResetModalOpen(false)}>
          <div className="w-full max-w-sm bg-amber-50 rounded-2xl shadow-xl p-5 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-red-700">Reset</h2>
              <button type="button" onClick={() => setResetModalOpen(false)} aria-label="Close" className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
            </div>
            <div>
              <p className="text-stone-500 text-sm mb-2">Erase all word progress for the {s.level} level to start over from scratch.</p>
              <button onClick={s.handleClearAll} className="w-full bg-red-50 text-red-700 border-2 border-red-100 py-3 rounded-xl font-semibold hover:bg-red-100 active:scale-95 transition-all">
                {s.cleared ? '✓ Cleared!' : `Clear all progress (${s.level})`}
              </button>
            </div>
            <div className="border-t border-red-200/50 pt-3">
              <p className="text-stone-500 text-sm mb-2">Or start over completely — every level's progress, streaks, and settings.</p>
              <button onClick={s.handleResetEverything} className="w-full bg-red-100 text-red-800 border-2 border-red-200 py-3 rounded-xl font-semibold hover:bg-red-200 active:scale-95 transition-all">Reset entire account</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
