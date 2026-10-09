'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSettings, saveSettings, switchToLevel, getImportedBookByShareCode, markOnboardingDone, Settings, MascotStageId, getTheme, saveTheme, Theme, saveLocalAvatarId, saveLocalNickname } from '../../lib/storage';
import { daysToWeeks, estimateProgressForecast, recommendedDailyReview } from '../../lib/practice';
import { Level } from '../../lib/words';
import { scheduleSync } from '../../lib/sync';
import { fetchSharedBook, addSharedBook, normalizeBookCode, SharedBook } from '../../lib/bookImport';
import { AVATAR_CATALOG, heroImageFor, getDisplayProfile, setAvatarId as saveRemoteAvatarId, setNickname as saveRemoteNickname } from '../../lib/shop';
import DachshundMascot from '../../components/Mascot';
import { THEME_CONFIG } from '../../components/AppBackground';

const STEPS = ['level', 'theme', 'pace', 'mascots', 'pet'] as const;
type Step = typeof STEPS[number];

// day is the cumulative day-count from introduction (see lib/srs.ts's
// OFFSET_AFTER_STAGE — the 1/3/5-day gaps between successive reviews,
// added up: 1, then +1=2, then +3=5, then +5=10) — the "Day N" title is
// what actually answers "when do I see this word again", which is more
// useful up front than the mascot's own name.
const MASCOT_INTRO: { id: MascotStageId; day: number; desc: string }[] = [
  { id: 'puppy', day: 1, desc: 'New word: introduced' },
  { id: 'short', day: 2, desc: 'First review: familiar' },
  { id: 'medium', day: 5, desc: 'Second review: strong' },
  { id: 'long-crowned', day: 10, desc: 'Third review: mastered!' },
];

function StepDots({ step }: { step: Step }) {
  const i = STEPS.indexOf(step);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, idx) => (
        <span
          key={s}
          className={`w-2 h-2 rounded-full transition-colors ${idx === i ? 'bg-amber-200' : idx < i ? 'bg-amber-200/50' : 'bg-white/20'}`}
        />
      ))}
    </div>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('level');

  // Lazily seeded from whatever's already saved (relevant when this page is
  // revisited from Settings after onboarding is done) — falls back to the
  // same defaults a first-time visitor gets, so clicking through without
  // changing anything just re-saves what was already there instead of
  // silently resetting it to these defaults.
  const existing = useMemo(() => getSettings(), []);
  const [level, setLevel] = useState<Level>(existing.level);
  // Optional class book code (see components/JoinBookModal.tsx): when one
  // is found, finishing adds that book and makes it the active one, so a
  // student whose class shares its word list starts right on it instead
  // of on A1–B2.
  const [bookCode, setBookCode] = useState('');
  const [sharedBook, setSharedBook] = useState<SharedBook | null>(null);
  const [codeStatus, setCodeStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [codeError, setCodeError] = useState('');
  const [finishing, setFinishing] = useState(false);

  const lookUpCode = async () => {
    const c = normalizeBookCode(bookCode);
    setSharedBook(null);
    if (c.length !== 6) { setCodeStatus('error'); setCodeError('A book code has 6 letters and numbers.'); return; }
    setCodeStatus('loading');
    try {
      const book = await fetchSharedBook(c);
      if (book) { setSharedBook(book); setCodeStatus('idle'); }
      else { setCodeStatus('error'); setCodeError('No book found with that code. Check it and try again.'); }
    } catch (e) {
      setCodeStatus('error');
      setCodeError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };
  const [nativeLanguage, setNativeLanguage] = useState<'en' | 'zh'>(existing.nativeLanguage);
  const [studyBatchSize, setStudyBatchSize] = useState(existing.studyBatchSize);
  const [dailyReview, setDailyReview] = useState(existing.dailyReview);
  const [autoPlayAudio, setAutoPlayAudio] = useState(existing.autoPlayAudio);
  const [requireArticle, setRequireArticle] = useState(existing.requireArticle);
  // Theme lives in its own storage key, not Settings (see lib/storage.ts) —
  // saved immediately on tap, same as Settings' own picker, rather than
  // deferred to `finish` below, so AppBackground (rendered globally from
  // the root layout, covering this page too) actually shows the new
  // background live as part of picking it, not just after onboarding ends.
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const handleThemeChange = (t: Theme) => {
    setThemeState(t);
    saveTheme(t);
  };

  // Loaded via getDisplayProfile (not always the untouched defaults) since
  // this same page is also reachable from Settings' "View welcome guide"
  // link after onboarding is already done — a signed-in learner revisiting
  // it should see their real pet/nickname, not a reset-looking default.
  const [avatarId, setAvatarIdState] = useState('dachshund');
  const [nickname, setNicknameState] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    getDisplayProfile().then(profile => {
      setAvatarIdState(profile.avatarId);
      setNicknameState(profile.nickname ?? '');
      setSignedIn(profile.signedIn);
    });
  }, []);
  const pickAvatar = (id: string) => {
    setAvatarIdState(id);
    if (signedIn) saveRemoteAvatarId(id);
    else saveLocalAvatarId(id);
  };

  const forecast = useMemo(
    () => estimateProgressForecast(studyBatchSize, dailyReview),
    [studyBatchSize, dailyReview],
  );
  const recommendedReview = useMemo(
    () => recommendedDailyReview(studyBatchSize),
    [studyBatchSize],
  );

  const finish = async () => {
    let finalLevel: Level = level;
    if (sharedBook) {
      setFinishing(true);
      try {
        // Already added (welcome revisited from Settings) -> just switch to it.
        const existingBook = getImportedBookByShareCode(sharedBook.code);
        const fresh = existingBook ? null : await fetchSharedBook(sharedBook.code, true);
        const id = existingBook?.id ?? (fresh ? addSharedBook(fresh).id : null);
        if (!id) throw new Error('This book is no longer available.');
        switchToLevel(id);
        finalLevel = id;
      } catch (e) {
        setFinishing(false);
        setStep('level');
        setCodeStatus('error');
        setCodeError(e instanceof Error ? e.message : 'Could not add this book.');
        return;
      }
    }
    const settings: Settings = {
      studyBatchSize, dailyReview, language: 'de', nativeLanguage, level: finalLevel, autoPlayAudio, requireArticle,
      sentenceWritingMode: true,
    };
    saveSettings(settings);
    if (signedIn) saveRemoteNickname(nickname);
    else saveLocalNickname(nickname);
    scheduleSync();
    markOnboardingDone();
    router.push('/');
  };

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      <div className="flex flex-col items-center gap-3 text-center px-4">
        <h1 className="text-xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Welcome to Spello</h1>
        <StepDots step={step} />
      </div>

      {step === 'level' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4">
            <p className="text-stone-500 text-sm -mt-1">
              Defaults are fine if you&apos;re not sure — you can always change this later in Profile.
            </p>
            <div className={sharedBook ? 'hidden' : ''}>
              <label className="block font-semibold text-stone-800 mb-1">Level</label>
              <select
                value={level}
                onChange={e => setLevel(e.target.value as Level)}
                className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="A1">A1</option>
                <option value="A2">A2</option>
                <option value="B1">B1</option>
                <option value="B2">B2</option>
              </select>
            </div>
            {sharedBook ? (
              <p className="text-stone-400 text-sm">You&apos;ll study your class&apos;s book — you can switch to A1–B2 any time in Profile.</p>
            ) : (
              <p className="text-stone-400 text-sm">Not sure which level? A1 is the easiest, for absolute beginners — B2 is the most advanced available right now.</p>
            )}
            <div className="border-t border-amber-100 pt-4">
              <label className="block font-semibold text-stone-800 mb-1">Book code from your class? <span className="font-normal text-stone-400">(optional)</span></label>
              <div className="flex gap-2">
                <input
                  value={bookCode}
                  onChange={e => { setBookCode(e.target.value.toUpperCase().slice(0, 8)); setSharedBook(null); setCodeStatus('idle'); }}
                  onKeyDown={e => { if (e.key === 'Enter') lookUpCode(); }}
                  placeholder="ABC234"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 font-mono tracking-[0.2em] uppercase focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={lookUpCode}
                  disabled={!bookCode.trim() || codeStatus === 'loading'}
                  className="bg-indigo-600 text-white px-4 rounded-lg font-semibold text-sm disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
                >
                  {codeStatus === 'loading' ? '…' : 'Find'}
                </button>
              </div>
              {sharedBook && (
                <p className="mt-2 text-sm text-stone-700">
                  ✓ <span className="font-semibold">{sharedBook.name}</span> · {sharedBook.wordCount} words
                  <button type="button" onClick={() => { setSharedBook(null); setBookCode(''); }} className="ml-2 text-stone-400 underline">remove</button>
                </p>
              )}
              {codeStatus === 'error' && <p className="mt-2 text-sm text-red-700">{codeError}</p>}
            </div>
            <div>
              <label className="block font-semibold text-stone-800 mb-1">Learn with</label>
              <select
                value={nativeLanguage}
                onChange={e => setNativeLanguage(e.target.value as 'en' | 'zh')}
                className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 focus:outline-none focus:border-indigo-500"
              >
                <option value="en">English</option>
                <option value="zh">中文 (Chinese)</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => setStep('theme')}
            className="w-full bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Continue
          </button>
        </div>
      )}

      {step === 'theme' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-1">
            <label className="block font-semibold text-stone-800 mb-1">Pick a theme</label>
            <p className="text-stone-500 text-sm mb-3">Changes the app's background — you can always change this later in Profile.</p>
            <div className="grid grid-cols-5 gap-x-2 gap-y-3">
              {(Object.keys(THEME_CONFIG) as Theme[]).map(t => {
                const cfg = THEME_CONFIG[t];
                const isSelected = theme === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleThemeChange(t)}
                    className="flex flex-col items-center gap-1"
                  >
                    <span
                      className={`w-9 h-9 rounded-full bg-gradient-to-b ${cfg.gradient} transition-all ${
                        isSelected ? 'ring-2 ring-offset-2 ring-offset-amber-50 ring-indigo-500 scale-110' : 'ring-1 ring-black/10'
                      }`}
                    />
                    <span className={`text-[11px] font-medium capitalize ${isSelected ? 'text-indigo-700' : 'text-stone-500'}`}>
                      {t}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('level')}
              className="flex-1 bg-amber-50/75 text-stone-700 py-3.5 rounded-2xl font-semibold border border-amber-100/50 hover:bg-amber-50 active:scale-95 transition-all"
            >
              Back
            </button>
            <button
              onClick={() => setStep('pace')}
              className="flex-[2] bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'pace' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-6">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                New words per day
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range" min={1} max={30} value={studyBatchSize}
                  onChange={e => setStudyBatchSize(Number(e.target.value))}
                  className="flex-1 accent-indigo-600"
                />
                <span className="w-8 text-center font-bold text-indigo-700">{studyBatchSize}</span>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Max review words per day
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range" min={1} max={100} value={dailyReview}
                  onChange={e => setDailyReview(Number(e.target.value))}
                  className="flex-1 accent-indigo-600"
                />
                <span className="w-8 text-center font-bold text-indigo-700">{dailyReview}</span>
              </div>
              {dailyReview !== recommendedReview && (
                <div className="flex items-center justify-between gap-2 mt-2 bg-amber-100/60 rounded-lg px-3 py-2 text-sm">
                  <span className="text-amber-800">
                    Recommended: <strong>{recommendedReview}</strong> for this study pace
                  </span>
                  <button
                    onClick={() => setDailyReview(recommendedReview)}
                    className="shrink-0 bg-indigo-600 text-white px-3 py-1 rounded-lg font-semibold text-xs hover:bg-indigo-700 active:scale-95 transition-all"
                  >
                    Use {recommendedReview}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-amber-100/60 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-center justify-between gap-3">
              <span className="font-semibold shrink-0">At this pace</span>
              <span className="text-right">
                ~{daysToWeeks(forecast.daysToMasterAll)} weeks to master all
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="block font-semibold text-slate-700">
                  Auto-play pronunciation
                </label>
                <p className="text-slate-400 text-sm">Speaks new words aloud automatically.</p>
              </div>
              <input
                type="checkbox"
                checked={autoPlayAudio}
                onChange={e => setAutoPlayAudio(e.target.checked)}
                className="w-5 h-5 accent-indigo-600"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="block font-semibold text-slate-700">
                  Practice articles
                </label>
                <p className="text-slate-400 text-sm">Also type der/die/das, not just the word.</p>
              </div>
              <input
                type="checkbox"
                checked={requireArticle}
                onChange={e => setRequireArticle(e.target.checked)}
                className="w-5 h-5 accent-indigo-600"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('theme')}
              className="flex-1 bg-amber-50/75 text-stone-700 py-3.5 rounded-2xl font-semibold border border-amber-100/50 hover:bg-amber-50 active:scale-95 transition-all"
            >
              Back
            </button>
            <button
              onClick={() => setStep('mascots')}
              className="flex-[2] bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'mascots' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4">
            <p className="text-stone-500 text-sm">
              Every word you learn grows its own dachshund as you review it successfully.
            </p>
            <div className="flex flex-col gap-3">
              {MASCOT_INTRO.map(m => (
                <div key={m.id} className="flex items-center gap-3">
                  <DachshundMascot stage={m.id} className="w-14 h-14 shrink-0" />
                  <div>
                    <div className="font-semibold text-stone-800">Day {m.day}</div>
                    <div className="text-stone-500 text-sm">{m.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setStep('pace')}
              className="flex-1 bg-amber-50/75 text-stone-700 py-3.5 rounded-2xl font-semibold border border-amber-100/50 hover:bg-amber-50 active:scale-95 transition-all"
            >
              Back
            </button>
            <button
              onClick={() => setStep('pet')}
              className="flex-[2] bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'pet' && (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4">
            <p className="text-stone-500 text-sm -mt-1">
              Pick a pet and, if you&apos;d like, a nickname — you can always change these later in Profile.
            </p>
            <div>
              <label className="block font-semibold text-stone-800 mb-2">Your pet</label>
              <div className="flex gap-3 flex-wrap">
                {AVATAR_CATALOG.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={a.comingSoon}
                    onClick={() => pickAvatar(a.id)}
                    className={`relative w-14 h-14 rounded-full overflow-hidden border-2 transition-colors ${
                      avatarId === a.id ? 'border-indigo-500' : 'border-amber-100'
                    } ${a.comingSoon ? 'opacity-50' : ''}`}
                    title={a.comingSoon ? `${a.name} — coming soon` : a.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${heroImageFor(a.id)}`}
                      alt={a.name}
                      className="w-full h-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block font-semibold text-stone-800 mb-1">Nickname (optional)</label>
              <input
                type="text"
                value={nickname}
                onChange={e => setNicknameState(e.target.value)}
                maxLength={24}
                placeholder="What should we call you?"
                className="w-full border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-stone-400 text-sm mt-1">Leave blank to stay anonymous.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep('mascots')}
              className="flex-1 bg-amber-50/75 text-stone-700 py-3.5 rounded-2xl font-semibold border border-amber-100/50 hover:bg-amber-50 active:scale-95 transition-all"
            >
              Back
            </button>
            <button
              onClick={finish}
              disabled={finishing}
              className="flex-[2] bg-indigo-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-60"
            >
              {finishing ? 'Adding your book…' : 'Start Learning'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
