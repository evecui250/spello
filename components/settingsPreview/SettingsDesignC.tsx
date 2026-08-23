'use client';

// TEMPORARY — Design C: "Compact list + sheet". The densest of the 3: a
// single flat, grouped list (plain section labels, thin dividers, one
// line per setting) closest to iPhone Settings.app itself. A row showing
// a value opens a small bottom sheet with just that one control; a
// on/off row shows its switch right there, no sheet needed. Nothing on
// the list itself ever expands in place. See useSettingsState for the
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

const FONT_LABEL: Record<FontScale, string> = { small: 'Small', default: 'Default', large: 'Large' };
type SheetId = 'account' | 'theme' | 'font' | 'sound' | 'level' | 'language' | 'newwords' | 'maxreview' | 'reset' | null;

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/70 px-1 mt-1">{children}</div>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-amber-50/90 rounded-2xl border border-amber-100/50 shadow-sm divide-y divide-stone-200/70 overflow-hidden">{children}</div>;
}

function ValueRow({ label, value, onClick, danger }: { label: string; value?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
      <span className={`font-medium ${danger ? 'text-red-600' : 'text-stone-800'}`}>{label}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        {value && <span className="text-stone-400 text-sm truncate max-w-[9rem]">{value}</span>}
        <span className="text-stone-300">›</span>
      </span>
    </button>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="font-medium text-stone-800">{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 accent-indigo-600 shrink-0" />
    </div>
  );
}

function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="block px-4 py-3 font-medium text-stone-800 hover:bg-amber-100/40">{children}</Link>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-amber-50 rounded-t-2xl sm:rounded-2xl shadow-xl p-5 flex flex-col gap-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-stone-800">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export default function SettingsDesignC() {
  const s = useSettingsState();
  const [sheet, setSheet] = useState<SheetId>(null);
  const close = () => setSheet(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Settings</h1>
        <span className={`text-sm font-medium text-emerald-300 transition-opacity ${s.saved ? 'opacity-100' : 'opacity-0'}`}>✓ Saved</span>
      </div>

      <div>
        <GroupLabel>Account</GroupLabel>
        <Card>
          <ValueRow label="Account" value={s.signedInEmail ?? 'Not signed in'} onClick={() => setSheet('account')} />
        </Card>
      </div>

      <div>
        <GroupLabel>Appearance</GroupLabel>
        <Card>
          <ValueRow label="Theme" value={`${s.theme[0].toUpperCase()}${s.theme.slice(1)}`} onClick={() => setSheet('theme')} />
          <ValueRow label="Font size" value={FONT_LABEL[s.fontScale]} onClick={() => setSheet('font')} />
          <ValueRow label="Sound" value={s.soundName} onClick={() => setSheet('sound')} />
        </Card>
      </div>

      <div>
        <GroupLabel>Learning</GroupLabel>
        <Card>
          <ValueRow label="Level" value={s.level} onClick={() => setSheet('level')} />
          <ValueRow label="Learn with" value={s.nativeLanguage === 'zh' ? '中文' : 'English'} onClick={() => setSheet('language')} />
          <ValueRow label="New words per day" value={String(s.studyBatchSize)} onClick={() => setSheet('newwords')} />
          <ValueRow label="Max review per day" value={String(s.dailyReview)} onClick={() => setSheet('maxreview')} />
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-stone-500">
            <span>At this pace</span>
            <span>~{s.daysToWeeks(s.forecast.daysToMasterAll)} weeks to master all</span>
          </div>
          <SwitchRow label="Auto-play pronunciation" checked={s.autoPlayAudio} onChange={v => { s.setAutoPlayAudio(v); s.persist({ autoPlayAudio: v }); }} />
          <SwitchRow label="Practice articles" checked={s.requireArticle} onChange={v => { s.setRequireArticle(v); s.persist({ requireArticle: v }); }} />
          <SwitchRow label="Sentence writing mode" checked={s.sentenceWritingMode} onChange={v => { s.setSentenceWritingMode(v); s.persist({ sentenceWritingMode: v }); }} />
        </Card>
      </div>

      <div>
        <GroupLabel>More</GroupLabel>
        <Card>
          <LinkRow href="/welcome">View welcome guide</LinkRow>
          <div className="px-4 py-3"><ShareCard /></div>
          <LinkRow href="/game?source=settings_preview">🎮 Try the new word-match game (preview)</LinkRow>
        </Card>
      </div>

      <div>
        <GroupLabel>About</GroupLabel>
        <Card>
          <LinkRow href="/terms">Terms of Service</LinkRow>
          <LinkRow href="/privacy">Privacy Policy</LinkRow>
          <div className="px-4 py-3"><BugReportButton /></div>
          <ValueRow label="Reset" onClick={() => setSheet('reset')} danger />
          {s.signedInEmail === s.ADMIN_EMAIL && <LinkRow href="/admin">Admin</LinkRow>}
        </Card>
      </div>

      {sheet === 'account' && <Sheet title="Account" onClose={close}><AccountPanel onSync={s.loadFromStorage} /></Sheet>}

      {sheet === 'theme' && (
        <Sheet title="Theme" onClose={close}>
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
        </Sheet>
      )}

      {sheet === 'font' && (
        <Sheet title="Font size" onClose={close}>
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
        </Sheet>
      )}

      {sheet === 'sound' && <Sheet title="Correct-answer sound" onClose={close}><SoundPicker /></Sheet>}

      {sheet === 'level' && (
        <Sheet title="Level" onClose={close}>
          <select value={s.level} onChange={e => s.handleLevelChange(e.target.value as Level)} className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500">
            <option value="A1">A1</option><option value="A2">A2</option><option value="B1">B1</option><option value="B2">B2</option>
          </select>
          <p className="text-stone-500 text-sm mt-1">This vocabulary book has {s.wordsForLevel(s.level).length} words for {s.level}.</p>
          {s.LEVEL_SOURCE[s.level] && <p className="text-stone-400 text-xs mt-0.5">{s.LEVEL_SOURCE[s.level]}</p>}
        </Sheet>
      )}

      {sheet === 'language' && (
        <Sheet title="Learn with" onClose={close}>
          <select value={s.nativeLanguage} onChange={e => { const v = e.target.value as 'en' | 'zh'; s.setNativeLanguage(v); s.persist({ nativeLanguage: v }); }} className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500">
            <option value="en">English</option><option value="zh">中文 (Chinese)</option>
          </select>
          <p className="text-stone-500 text-sm mt-1">Word meanings and example sentences are shown in this language.</p>
        </Sheet>
      )}

      {sheet === 'newwords' && (
        <Sheet title="New words per day" onClose={close}>
          <div className="flex items-center gap-4">
            <input type="range" min={1} max={30} value={s.studyBatchSize} onChange={e => { const v = Number(e.target.value); s.setStudyBatchSize(v); s.persist({ studyBatchSize: v }); }} className="flex-1 accent-indigo-600" />
            <span className="w-8 text-center font-bold text-stone-800">{s.studyBatchSize}</span>
          </div>
        </Sheet>
      )}

      {sheet === 'maxreview' && (
        <Sheet title="Max review words per day" onClose={close}>
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
        </Sheet>
      )}

      {sheet === 'reset' && (
        <Sheet title="Reset" onClose={close}>
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
        </Sheet>
      )}
    </div>
  );
}
