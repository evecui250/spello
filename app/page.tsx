'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getAllProgress, getSettings, today, PROGRESS_CHANGED_EVENT,
  isOnboardingDone, getDailySession, startDailySession, resetDailyGoalsForExtraRound, DailySession,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords } from '../lib/practice';
import { SYNCED_EVENT } from '../lib/sync';
import { getDisplayProfile, heroImageFor, avatarImageFor, EquippedAccessories, NO_ACCESSORIES } from '../lib/shop';
import { CheckCircleIcon, SettingsGearIcon } from '../components/icons';
import PetNicknameModal from '../components/PetNicknameModal';
import Link from 'next/link';

// Once today's main goal is done, "Study more" pulls a smaller bonus round
// instead of the user's full daily pace — repeatable as many times as there
// are still words available. Real, confirmed report: these are meant to be
// SMALLER than the learner's own pace, but as flat constants they weren't
// smaller than anything for a learner who'd set their own dailyReview
// (Settings allows as low as 1) below 10 — "study more"/"review more"
// could then hand them MORE words than their own configured setting,
// exactly backwards from the intent. Capping each at the learner's own
// setting (extraStudySize/extraReviewSize below) guarantees "more" always
// means "a bonus round of at most your own normal pace," never more.
const EXTRA_STUDY_SIZE = 5;
const EXTRA_REVIEW_SIZE = 10;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Three bands, no separate "Gute Nacht" — that's a send-off, not a
// greeting, so Guten Abend just carries through the rest of the night.
function greetingWord(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'Guten Morgen';
  if (hour < 17) return 'Guten Tag';
  return 'Guten Abend';
}

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<DailySession | null>(null);
  const [previewStudyCount, setPreviewStudyCount] = useState(0);
  const [previewReviewCount, setPreviewReviewCount] = useState(0);
  const [totalStudyCount, setTotalStudyCount] = useState(0);
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  // Whether the current book has ANY sentence-notebook activity at all
  // (mistakes or perfects) — an A1 learner who hasn't reached round-1
  // sentence writing yet has neither, and the row shouldn't appear at
  // all until there's something for it to show.
  const [hasNotebookActivity, setHasNotebookActivity] = useState(false);
  const [ready, setReady] = useState(false);

  // The learner's chosen pet + nickname — works whether or not they're
  // signed in (see lib/shop.ts's getDisplayProfile).
  const [avatarId, setAvatarId] = useState('dachshund');
  const [equipped, setEquipped] = useState<EquippedAccessories>(NO_ACCESSORIES);
  const [nickname, setNickname] = useState<string | null>(null);
  const [petModalOpen, setPetModalOpen] = useState(false);
  // These portraits are large (~1-1.5MB), uncached PNGs on a first visit —
  // without this, some mobile browsers paint a faint bordered box in the
  // <img>'s space (worse with the drop-shadow filter below) while it's
  // still loading, which briefly flashes then vanishes once decoded.
  // Hiding it until onLoad fires skips that box entirely; a cached revisit
  // still fires onLoad almost immediately, so the fade-in there is
  // imperceptible.
  const [petLoaded, setPetLoaded] = useState(false);
  const petImgRef = useRef<HTMLImageElement>(null);

  const loadProfile = () => {
    getDisplayProfile().then(profile => {
      setAvatarId(profile.avatarId);
      setEquipped(profile.equipped);
      setNickname(profile.nickname);
    });
  };

  useEffect(() => {
    setPetLoaded(false);
    // A cached image can finish loading before React attaches the onLoad
    // listener below (or even synchronously, in the same tick the <img>
    // is created) -- a real, confirmed gap: the pet silently never
    // appeared until navigating away and back forced a fresh mount that
    // happened to win the race. Checking .complete right after render
    // catches the case onLoad would otherwise miss.
    if (petImgRef.current?.complete && petImgRef.current.naturalWidth > 0) {
      setPetLoaded(true);
    }
  }, [avatarId]);

  useEffect(() => {
    loadProfile();
    window.addEventListener(SYNCED_EVENT, loadProfile);
    return () => window.removeEventListener(SYNCED_EVENT, loadProfile);
  }, []);

  useEffect(() => {
    if (!isOnboardingDone()) {
      router.replace('/welcome');
      return;
    }
    // Runs on mount (whatever's already in local storage), and again once
    // a signed-in pull-and-merge finishes — otherwise a returning user who
    // lands here before that async pull resolves sees a stale/empty local
    // state until they happen to visit Settings, the only page that used to
    // trigger the pull.
    const load = () => {
      const progress = getAllProgress();
      const settings = getSettings();
      const ds = getDailySession();
      setSession(ds);
      if (!ds) {
        // Nothing started today yet — preview what Start would pull in.
        // Remaining equals the total here, since nothing's done yet.
        const studyCount = buildStudyWords(settings.studyBatchSize).length;
        const reviewCount = buildReviewWords(settings.dailyReview).length;
        setPreviewStudyCount(studyCount);
        setPreviewReviewCount(reviewCount);
        setTotalStudyCount(studyCount);
        setTotalReviewCount(reviewCount);
      } else if (ds.phase === 'done') {
        // Today's goal is met — preview the smaller bonus round instead.
        // See EXTRA_STUDY_SIZE/EXTRA_REVIEW_SIZE's own comment for why
        // this is capped at the learner's own setting, not just the flat
        // constant.
        const studyCount = buildStudyWords(Math.min(EXTRA_STUDY_SIZE, settings.studyBatchSize)).length;
        const reviewCount = buildReviewWords(Math.min(EXTRA_REVIEW_SIZE, settings.dailyReview)).length;
        setPreviewStudyCount(studyCount);
        setPreviewReviewCount(reviewCount);
        setTotalStudyCount(studyCount);
        setTotalReviewCount(reviewCount);
      } else {
        // Mid-session — show what's actually still left against today's
        // original batch size, so "5/15 new" reflects 10 already done.
        const t = today();
        setPreviewStudyCount(ds.studyWordIds.filter(id => !progress[id]?.mascotStage).length);
        setPreviewReviewCount(ds.reviewWordIds.filter(id => {
          const p = progress[id];
          return !p?.fullyMastered && !(p?.nextReviewDue && p.nextReviewDue > t);
        }).length);
        setTotalStudyCount(ds.studyWordIds.length);
        setTotalReviewCount(ds.reviewWordIds.length);
      }
      // Scoped to the current book only (not merged across every level) —
      // per feedback, the notebook row should reflect whichever book
      // the learner is actually studying right now, same as Start's own
      // counts above.
      const allProgress = Object.values(progress);
      setMistakeCount(allProgress.filter(p => !!p.lastMistake).length);
      setHasNotebookActivity(allProgress.some(p => !!p.lastMistake || !!p.exampleSentence));
      setReady(true);
    };
    load();
    window.addEventListener(SYNCED_EVENT, load);
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => {
      window.removeEventListener(SYNCED_EVENT, load);
      window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSession = () => {
    const settings = getSettings();
    const studyIds = buildStudyWords(settings.studyBatchSize).map(w => w.id);
    const reviewIds = buildReviewWords(settings.dailyReview).map(w => w.id);
    startDailySession(studyIds, reviewIds);
    router.push('/practice');
  };

  // Today's main goal is already done — pull a smaller bonus round instead
  // of the full daily pace, and un-latch the goal flags so finishing it
  // earns its own congrats card (with the day's running total, not just
  // this round's).
  const startExtraRound = () => {
    const settings = getSettings();
    const studyIds = buildStudyWords(Math.min(EXTRA_STUDY_SIZE, settings.studyBatchSize)).map(w => w.id);
    const reviewIds = buildReviewWords(Math.min(EXTRA_REVIEW_SIZE, settings.dailyReview)).map(w => w.id);
    resetDailyGoalsForExtraRound();
    startDailySession(studyIds, reviewIds, true);
    router.push('/practice');
  };

  if (!ready) return null;

  const isDoneForNow = session?.phase === 'done';
  const inProgress = !!session && !isDoneForNow;
  // Only when there's truly nothing left anywhere (whole vocab exhausted,
  // nothing due) does the button retire into a plain non-interactive pill —
  // otherwise "done for today" still offers a bonus round via the same button.
  const nothingLeftAtAll = isDoneForNow && previewStudyCount === 0 && previewReviewCount === 0;

  // Mid-session still says "Start" (not "Continue") — just with the counts
  // updated to whatever's actually left, same as the not-yet-started state.
  // A bonus round in progress keeps saying "Study more" instead, so quitting
  // and coming back doesn't make it look like the main daily goal reset.
  const label = isDoneForNow ? 'Goal completed' : inProgress && session?.isExtra ? 'Study more' : 'Start';
  const handleClick = isDoneForNow ? startExtraRound : inProgress ? () => router.push('/practice') : startSession;

  const gradientButton = 'group relative w-full rounded-full px-5 py-3.5 overflow-hidden shadow-[0_4px_16px_rgba(90,58,26,0.35)] active:scale-[0.98] transition-all duration-300 ease-out';
  const gradientStyle = { backgroundImage: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-deep) 100%)' };
  const shine = <span className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/25 to-transparent" />;

  return (
    // Three bands filling exactly one phone screen (main's own top/bottom
    // padding and the fixed nav subtracted): greeting on top, the pet
    // centered in whatever height is left, and every action grouped at the
    // bottom where a thumb reaches — so there's no dead band on tall
    // phones and nothing to scroll on small ones. Capped to a phone-width
    // column so it doesn't spread out on a laptop.
    <div
      className="relative flex flex-col mx-auto w-full max-w-sm"
      style={{ minHeight: 'calc(100dvh - 7rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))' }}
    >
      <div className="w-full flex items-start justify-between gap-3">
        <div>
          {nickname ? (
            <>
              <p className="text-sm font-medium text-on-bg/70">{greetingWord()},</p>
              <h1 className="text-2xl font-bold text-on-bg -mt-0.5" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                {nickname}
              </h1>
            </>
          ) : (
            <h1 className="text-2xl font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
              {greetingWord()}!
            </h1>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPetModalOpen(true)}
          aria-label="Choose pet and nickname"
          className="shrink-0 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-on-bg/80 hover:text-on-bg flex items-center justify-center transition-colors"
        >
          <SettingsGearIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Decorative only (see PetChat's Chat button below for why tapping
          it no longer opens chat). Sized by screen height, so it fills a
          tall phone and still leaves room on an iPhone SE. */}
      <div className="flex-1 flex items-center justify-center py-3">
        <img
          ref={petImgRef}
          src={`${BASE}/${heroImageFor(avatarId)}`}
          alt="Your pet"
          onLoad={() => setPetLoaded(true)}
          style={{ height: 'clamp(120px, 34dvh, 300px)' }}
          className={`w-auto max-w-full object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.35)] transition-opacity duration-300 ${petLoaded ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>

      <div className="w-full flex flex-col gap-3">
        {/* One card shape in every state, so the screen doesn't reshape
            itself once the goal is done. */}
        <div className="w-full bg-white/10 backdrop-blur-md rounded-3xl border border-white/15 shadow-sm p-4 flex flex-col gap-4">
          {isDoneForNow ? (
            <div className="flex items-center gap-3 px-1">
              <CheckCircleIcon className="w-9 h-9 text-good shrink-0" />
              <div>
                <div className="font-bold text-on-bg text-lg leading-tight">{nothingLeftAtAll ? 'All done for today' : "Today's goal done"}</div>
                <div className="text-sm text-on-bg/65">{nothingLeftAtAll ? 'Come back tomorrow for more.' : 'Nice work! Want a few more?'}</div>
              </div>
            </div>
          ) : (
            <div className="flex">
              <div className="flex-1 flex items-center justify-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${BASE}/icon_learn_new.png`} alt="" className="w-9 h-9 object-contain shrink-0" />
                <div className="leading-tight">
                  <div className="font-bold text-on-bg text-xl">{previewStudyCount}</div>
                  <div className="text-xs text-on-bg/65">{inProgress && previewStudyCount !== totalStudyCount ? `new · of ${totalStudyCount}` : 'new words'}</div>
                </div>
              </div>
              <div className="w-px bg-white/15 shrink-0" />
              <div className="flex-1 flex items-center justify-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${BASE}/icon_review.png`} alt="" className="w-9 h-9 object-contain shrink-0" />
                <div className="leading-tight">
                  <div className="font-bold text-on-bg text-xl">{previewReviewCount}</div>
                  <div className="text-xs text-on-bg/65">{inProgress && previewReviewCount !== totalReviewCount ? `review · of ${totalReviewCount}` : 'to review'}</div>
                </div>
              </div>
            </div>
          )}
          {!nothingLeftAtAll && (
            <button onClick={handleClick} className={gradientButton} style={gradientStyle}>
              <span className="text-lg font-extrabold text-on-bg tracking-wide">{isDoneForNow ? 'Study more' : label} →</span>
              {shine}
            </button>
          )}
        </div>

        {/* Notebook only once this book has any sentence-notebook activity,
            with a count only when there's something to redo; Chat is the
            sole entrance to Text to Pet, the pet's small avatar as icon. */}
        <div className="w-full flex gap-3">
          {hasNotebookActivity && (
            <Link
              href="/mistakes"
              className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 px-3 py-2.5 hover:bg-white/15 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${BASE}/icon_mistake_notebook.png`} alt="" className="w-7 h-7 object-contain shrink-0" />
              <span className="font-semibold text-on-bg text-sm truncate">Notebook</span>
              {mistakeCount > 0 && (
                <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
                  {mistakeCount}
                </span>
              )}
            </Link>
          )}
          <button
            type="button"
            onClick={() => router.push('/pet-chat/')}
            className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 px-3 py-2.5 hover:bg-white/15 transition-colors"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${BASE}/${avatarImageFor(avatarId, equipped)}`} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
            <span className="font-semibold text-on-bg text-sm truncate">Chat</span>
          </button>
        </div>
      </div>

      {petModalOpen && (
        <PetNicknameModal onClose={() => setPetModalOpen(false)} onProfileChange={loadProfile} />
      )}
    </div>
  );
}
