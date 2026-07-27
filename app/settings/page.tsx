'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSettings, saveSettings, switchToLevel, clearAllProgress, Settings } from '../../lib/storage';
import { daysToWeeks, estimateProgressForecast, recommendedDailyReview, resizeTodayStudyBatch } from '../../lib/practice';
import { Level, wordsForLevel } from '../../lib/words';
import { scheduleSync } from '../../lib/sync';
import AccountPanel from '../../components/AccountPanel';

export default function SettingsPage() {
  const [studyBatchSize, setStudyBatchSize] = useState(15);
  const [dailyReview, setDailyReview] = useState(25);
  const [language, setLanguage] = useState('de');
  const [level, setLevel] = useState<Level>('A1');
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [requireArticle, setRequireArticle] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [showPaceInfo, setShowPaceInfo] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applySettings = (s: Settings) => {
    setStudyBatchSize(s.studyBatchSize);
    setDailyReview(s.dailyReview);
    setLanguage(s.language);
    setLevel(s.level);
    setAutoPlayAudio(s.autoPlayAudio);
    setRequireArticle(s.requireArticle);
  };

  const loadFromStorage = () => applySettings(getSettings());

  useEffect(loadFromStorage, []);

  // Switching level is switching profiles entirely — separate progress,
  // streak, daily stats/session, and pace settings, with no bleed-through
  // in either direction. Unlike every other control here, this does NOT
  // merge the just-changed field into current React state (that would carry
  // this level's studyBatchSize/dailyReview/etc. into the new level's fresh
  // profile) — it loads whatever that level's own profile already has (or
  // its untouched defaults, first time).
  const handleLevelChange = (newLevel: Level) => {
    const s = switchToLevel(newLevel);
    applySettings(s);
    scheduleSync();
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  };

  // Recomputed live as the sliders move, so the user can see the effect of
  // a pace change immediately.
  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize, dailyReview),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studyBatchSize, dailyReview, cleared],
  );

  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize),
    [studyBatchSize],
  );

  // Every control saves immediately on change — no separate Save step.
  // Callers pass the field(s) that just changed; everything else comes
  // from current state, which is already up to date by the time this runs.
  const persist = (patch: Partial<Settings>) => {
    const next: Settings = {
      studyBatchSize, dailyReview, language, level, autoPlayAudio, requireArticle, ...patch,
    };
    saveSettings(next);
    // Review's daily pool is always computed fresh from due words, so a
    // dailyReview change is already instant. Study's batch is fixed for the
    // day once drawn, so it needs an explicit resize to feel the change today.
    if (patch.studyBatchSize !== undefined) resizeTodayStudyBatch(patch.studyBatchSize);
    scheduleSync();
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  };

  const handleClearAll = () => {
    if (!window.confirm(`This will erase all learning progress and your streak for the ${level} level — every word starts over. Other levels aren't affected. This can't be undone. Continue?`)) return;
    clearAllProgress();
    scheduleSync();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Settings</h1>
        <span className={`text-sm font-medium text-emerald-300 transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>
          ✓ Saved
        </span>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6">
        <AccountPanel onSync={loadFromStorage} />
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block font-semibold text-stone-800 mb-1">Language</label>
            <select
              value={language}
              onChange={e => { setLanguage(e.target.value); persist({ language: e.target.value }); }}
              className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
            >
              <option value="de">German</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block font-semibold text-stone-800 mb-1">Level</label>
            <select
              value={level}
              onChange={e => handleLevelChange(e.target.value as Level)}
              className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
            >
              <option value="A1">A1</option>
              <option value="A2">A2</option>
              <option value="B1">B1</option>
              <option value="B2">B2</option>
            </select>
          </div>
        </div>
        <div className="-mt-4 flex flex-col gap-0.5">
          <p className="text-stone-500 text-sm">This vocabulary book has {wordsForLevel(level).length} words for {level}.</p>
        </div>

        <div>
          <label className="block font-semibold text-stone-800 mb-1">
            New words per day
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={30} value={studyBatchSize}
              onChange={e => {
                const v = Number(e.target.value);
                setStudyBatchSize(v);
                persist({ studyBatchSize: v });
              }}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-stone-800">{studyBatchSize}</span>
          </div>
        </div>

        <div>
          <label className="block font-semibold text-stone-800 mb-1">
            Max review words per day
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range" min={1} max={100} value={dailyReview}
              onChange={e => {
                const v = Number(e.target.value);
                setDailyReview(v);
                persist({ dailyReview: v });
              }}
              className="flex-1 accent-indigo-600"
            />
            <span className="w-8 text-center font-bold text-stone-800">{dailyReview}</span>
          </div>
          {dailyReview !== recommendedReview && (
            <div className="flex items-center justify-between gap-2 mt-2 bg-amber-100/60 rounded-lg px-3 py-2 text-sm">
              <span className="text-stone-800">
                💡 Recommended: <strong>{recommendedReview}</strong> for a {studyBatchSize}/day study pace
              </span>
              <button
                onClick={() => { setDailyReview(recommendedReview); persist({ dailyReview: recommendedReview }); }}
                className="shrink-0 bg-indigo-600 text-white px-3 py-1 rounded-lg font-semibold text-xs hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Use {recommendedReview}
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <div className="bg-amber-100/60 rounded-xl px-4 py-3 text-sm text-stone-800 flex items-center justify-between gap-3">
            <span className="font-semibold shrink-0 inline-flex items-center gap-1.5">
              At this pace
              <button
                type="button"
                onClick={() => setShowPaceInfo(v => !v)}
                aria-label="How mastery works"
                className="w-4 h-4 rounded-full bg-stone-400/70 text-white text-[10px] font-bold leading-none flex items-center justify-center hover:bg-stone-500/70 transition-colors"
              >
                ?
              </button>
            </span>
            <span className="text-right">
              {forecast.wordsRemaining === 0
                ? 'All words introduced'
                : `~${daysToWeeks(forecast.daysToIntroduceAll)} weeks to learn all`}
              {' · '}~{daysToWeeks(forecast.daysToMasterAll)} weeks to master all
            </span>
          </div>
          {showPaceInfo && (
            <div className="absolute top-full left-0 mt-2 z-10 w-full bg-amber-50/95 backdrop-blur-sm border border-amber-100 rounded-xl px-4 py-3 text-sm text-stone-700 shadow-lg">
              Each word gets a mastery score instead of a fixed review count.
              A correct review raises it and pushes the next review further
              away (spaced repetition); a mistake slows the next gain but
              never erases progress already made. After the first time you
              learn a word, plus about 3 clean reviews spread across a few
              months, it&apos;s fully mastered.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-stone-800">
              Auto-play pronunciation
            </label>
          </div>
          <input
            type="checkbox"
            checked={autoPlayAudio}
            onChange={e => { setAutoPlayAudio(e.target.checked); persist({ autoPlayAudio: e.target.checked }); }}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <label className="block font-semibold text-stone-800">
              Practice articles
            </label>
          </div>
          <input
            type="checkbox"
            checked={requireArticle}
            onChange={e => { setRequireArticle(e.target.checked); persist({ requireArticle: e.target.checked }); }}
            className="w-5 h-5 accent-indigo-600"
          />
        </div>
      </div>

      <div className="bg-red-50/70 backdrop-blur-sm rounded-2xl border border-red-200/50 shadow-sm p-6 flex flex-col gap-3">
        <div>
          <h2 className="font-semibold text-red-700">Danger zone</h2>
          <p className="text-stone-500 text-sm mt-1">
            Erase all word progress, coins, and your streak for the {level} level to start over from scratch. Other levels are untouched.
          </p>
        </div>
        <button
          onClick={handleClearAll}
          className="w-full bg-red-50 text-red-700 border-2 border-red-100 py-3 rounded-xl font-semibold hover:bg-red-100 active:scale-95 transition-all"
        >
          {cleared ? '✓ Cleared!' : `Clear all progress (${level})`}
        </button>
      </div>
    </div>
  );
}
