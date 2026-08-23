'use client';

// TEMPORARY — Design A: "iOS drill-down". The root screen shows only 5
// group rows, each with a one-line summary of its current values and a
// chevron — nothing expands in place. Tapping a row slides to that
// group's own screen (a back header + its controls), the same pattern as
// iPhone Settings' own root menu. See useSettingsState for the shared
// wiring and the admin page's preview section for how this gets compared
// against Designs B/C.

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

function Row({ onClick, title, summary, icon, chevron = true }: { onClick?: () => void; title: string; summary?: string; icon: string; chevron?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left disabled:cursor-default"
    >
      <span className="text-xl w-7 text-center shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-medium text-stone-800">{title}</span>
        {summary && <span className="block text-xs text-stone-400 truncate">{summary}</span>}
      </span>
      {chevron && onClick && <span className="text-stone-300 shrink-0">›</span>}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-stone-200/70 ml-14" />;
}

export default function SettingsDesignA() {
  const s = useSettingsState();
  const [group, setGroup] = useState<GroupId | null>(null);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  const groupTitle: Record<GroupId, string> = {
    account: 'Account', appearance: 'Appearance', learning: 'Learning', more: 'More', about: 'About',
  };

  const card = 'bg-amber-50/90 rounded-2xl border border-amber-100/50 shadow-sm overflow-hidden divide-y-0';

  if (group === null) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Settings</h1>
          <span className={`text-sm font-medium text-emerald-300 transition-opacity ${s.saved ? 'opacity-100' : 'opacity-0'}`}>✓ Saved</span>
        </div>
        <div className={card}>
          <Row icon="👤" title="Account" summary={s.signedInEmail ? `Signed in as ${s.signedInEmail}` : 'Not signed in'} onClick={() => setGroup('account')} />
          <Divider />
          <Row icon="🎨" title="Appearance" summary={`${s.theme[0].toUpperCase()}${s.theme.slice(1)} theme · ${FONT_LABEL[s.fontScale]} text · ${s.soundName} sound`} onClick={() => setGroup('appearance')} />
          <Divider />
          <Row icon="📚" title="Learning" summary={`${s.level} · ${s.studyBatchSize} new/day · ${s.dailyReview} review/day`} onClick={() => setGroup('learning')} />
          <Divider />
          <Row icon="✨" title="More" summary="Guide, sharing, mini-game" onClick={() => setGroup('more')} />
          <Divider />
          <Row icon="ℹ️" title="About" summary="Terms, privacy, reset" onClick={() => setGroup('about')} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setGroup(null)} className="text-indigo-200 hover:text-white font-medium flex items-center gap-1">
          <span className="text-lg leading-none">‹</span> Settings
        </button>
      </div>
      <h1 className="text-2xl font-bold text-amber-50 -mt-4" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{groupTitle[group]}</h1>

      {group === 'account' && (
        <div className="bg-amber-50/90 rounded-2xl border border-amber-100/50 shadow-sm p-6">
          <AccountPanel onSync={s.loadFromStorage} />
        </div>
      )}

      {group === 'appearance' && (
        <div className="flex flex-col gap-4">
          <div className={card + ' p-5'}>
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
          <div className={card + ' p-5'}>
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
          <div className={card + ' p-5'}>
            <label className="block font-semibold text-stone-800 mb-3">Correct-answer sound</label>
            <SoundPicker />
          </div>
        </div>
      )}

      {group === 'learning' && (
        <div className={card + ' p-5 flex flex-col gap-6'}>
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
        </div>
      )}

      {group === 'more' && (
        <div className="flex flex-col gap-3">
          <Link href="/welcome" className="text-center bg-amber-50/90 rounded-2xl border border-amber-100/50 shadow-sm p-4 font-semibold text-stone-700 hover:bg-amber-50 transition-colors">View welcome guide</Link>
          <ShareCard />
          <Link href="/game?source=settings_preview" className="text-center bg-amber-50/90 rounded-2xl border border-amber-100/50 shadow-sm py-3 px-4 font-semibold text-stone-700 hover:bg-amber-50 active:scale-[0.99] transition-all">🎮 Try the new word-match game (preview)</Link>
        </div>
      )}

      {group === 'about' && (
        <div className={card}>
          <Link href="/terms" className="block px-4 py-3.5 font-medium text-stone-800 hover:bg-amber-100/40">Terms of Service</Link>
          <Divider />
          <Link href="/privacy" className="block px-4 py-3.5 font-medium text-stone-800 hover:bg-amber-100/40">Privacy Policy</Link>
          <Divider />
          <div className="px-4 py-3.5"><BugReportButton /></div>
          <Divider />
          <button type="button" onClick={() => setResetModalOpen(true)} className="w-full text-left px-4 py-3.5 font-medium text-red-600 hover:bg-red-50/60">Reset</button>
          {s.signedInEmail === s.ADMIN_EMAIL && (<><Divider /><Link href="/admin" className="block px-4 py-3.5 font-medium text-stone-800 hover:bg-amber-100/40">Admin</Link></>)}
        </div>
      )}

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
