'use client';

// TEMPORARY — shared state/logic for the 3 Settings redesign mockups
// (see SettingsDesignA/B/C + the admin page's preview section). Ported
// directly from app/settings/page.tsx so all 3 layouts are wired to the
// REAL settings storage (same as the sound picker preview before it) —
// clicking a control here genuinely changes the signed-in admin's own
// settings, so the comparison is a real interaction, not a static
// picture. Once a design is picked, its layout replaces
// app/settings/page.tsx directly and this file (plus the two rejected
// designs) gets deleted.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSettings, saveSettings, switchToLevel, clearAllProgress, resetEverything, Settings, getTheme, saveTheme, Theme, getFontScale, saveFontScale, FontScale, getSoundChoice, SoundChoice } from '../../lib/storage';
import { daysToWeeks, estimateProgressForecast, recommendedDailyReview, resizeTodayStudyBatch } from '../../lib/practice';
import { Level, wordsForLevel, LEVEL_SOURCE } from '../../lib/words';
import { scheduleSync, syncNow } from '../../lib/sync';
import { supabase } from '../../lib/supabase';
import { CHIME_OPTIONS } from '../../lib/sound';

const ADMIN_EMAIL = 'evecui250@gmail.com';

export function useSettingsState() {
  const router = useRouter();
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [studyBatchSize, setStudyBatchSize] = useState(5);
  const [dailyReview, setDailyReview] = useState(15);
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>('en');
  const [level, setLevel] = useState<Level>('A1');
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [requireArticle, setRequireArticle] = useState(false);
  const [sentenceWritingMode, setSentenceWritingMode] = useState(true);
  const [saved, setSaved] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [theme, setTheme] = useState<Theme>('forest');
  const [fontScale, setFontScale] = useState<FontScale>('default');
  const [soundChoice, setSoundChoice] = useState<SoundChoice>('triad-bloom');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const applySettings = (s: Settings) => {
    setStudyBatchSize(s.studyBatchSize);
    setDailyReview(s.dailyReview);
    setNativeLanguage(s.nativeLanguage);
    setLevel(s.level);
    setAutoPlayAudio(s.autoPlayAudio);
    setRequireArticle(s.requireArticle);
    setSentenceWritingMode(s.sentenceWritingMode);
  };

  const loadFromStorage = () => applySettings(getSettings());

  useEffect(loadFromStorage, []);
  useEffect(() => setTheme(getTheme()), []);
  useEffect(() => setFontScale(getFontScale()), []);
  useEffect(() => setSoundChoice(getSoundChoice()), []);
  const soundName = CHIME_OPTIONS.find(o => o.id === soundChoice)?.name ?? 'Triad Bloom';

  const handleFontScaleChange = (s: FontScale) => {
    setFontScale(s);
    saveFontScale(s);
  };

  const handleThemeChange = (t: Theme) => {
    setTheme(t);
    saveTheme(t);
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLevelChange = (newLevel: Level) => {
    const s = switchToLevel(newLevel);
    applySettings(s);
    syncNow();
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  };

  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize, dailyReview),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studyBatchSize, dailyReview, cleared],
  );

  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize),
    [studyBatchSize],
  );

  const persist = (patch: Partial<Settings>) => {
    const next: Settings = {
      studyBatchSize, dailyReview, language: 'de', nativeLanguage, level, autoPlayAudio, requireArticle,
      sentenceWritingMode, ...patch,
    };
    saveSettings(next);
    if (patch.studyBatchSize !== undefined) resizeTodayStudyBatch(patch.studyBatchSize);
    scheduleSync();
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1200);
  };

  const handleClearAll = async () => {
    if (!window.confirm(`This will erase all learning progress for the ${level} level — every word starts over. Other levels, and your account-wide streak/goal days, aren't affected. This can't be undone. Continue?`)) return;
    clearAllProgress();
    await syncNow();
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  };

  const handleResetEverything = async () => {
    if (!window.confirm('This will erase ALL progress, streaks, and settings for EVERY level — your account will start over completely, as if brand new. You\'ll stay signed in. This can\'t be undone. Continue?')) return;
    resetEverything();
    await syncNow();
    router.push('/welcome');
  };

  return {
    ADMIN_EMAIL,
    signedInEmail, loadFromStorage,
    studyBatchSize, dailyReview, nativeLanguage, level, autoPlayAudio, requireArticle, sentenceWritingMode,
    saved, cleared, theme, fontScale, soundChoice, setSoundChoice, soundName,
    handleFontScaleChange, handleThemeChange, handleLevelChange,
    forecast, recommendedReview, persist,
    setStudyBatchSize, setDailyReview, setNativeLanguage, setAutoPlayAudio, setRequireArticle, setSentenceWritingMode,
    handleClearAll, handleResetEverything,
    daysToWeeks, wordsForLevel, LEVEL_SOURCE,
  };
}
