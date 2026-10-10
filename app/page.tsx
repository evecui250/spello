'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getAllProgress, getSettings, today, PROGRESS_CHANGED_EVENT,
  isOnboardingDone, getDailySession, startDailySession, resetDailyGoalsForExtraRound, DailySession,
  getPetAgeDays, formatPetAge, levelDisplayName,
} from '../lib/storage';
import { buildStudyWords, buildReviewWords } from '../lib/practice';
import { SYNCED_EVENT } from '../lib/sync';
import { getDisplayProfile, getCachedDisplayProfile, heroImageFor, avatarImageFor, EquippedAccessories, NO_ACCESSORIES } from '../lib/shop';
import { CheckCircleIcon } from '../components/icons';
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
  const [petAgeDays, setPetAgeDays] = useState(0);
  const [bookName, setBookName] = useState('');

  // The learner's chosen pet + nickname — works whether or not they're
  // signed in (see lib/shop.ts's getDisplayProfile).
  const [avatarId, setAvatarId] = useState('dachshund');
  const [equipped, setEquipped] = useState<EquippedAccessories>(NO_ACCESSORIES);
  const [nickname, setNickname] = useState<string | null>(null);
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
    // Last-shown pet/nickname, before the first paint (see
    // getCachedDisplayProfile) — loadProfile() refreshes it right after.
    const cached = getCachedDisplayProfile();
    if (cached) {
      setAvatarId(cached.avatarId);
      setEquipped(cached.equipped);
      setNickname(cached.nickname);
    }
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
      setPetAgeDays(getPetAgeDays());
      setBookName(levelDisplayName(settings.level));
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
    // One column, vertically centered as a whole between the top of the
    // screen and the tab bar, so leftover height splits evenly above and
    // below instead of opening a gap in the middle. The pet is framed in
    // a rounded square beside the greeting (owner call: a lone pet
    // floating in the background felt abrupt); the session card is the
    // main element. Fills exactly one screen on every phone size.
    <div
      className="relative flex flex-col justify-center mx-auto w-full max-w-sm py-2"
      // Spacing and the pet window grow with screen height (clamp), so a
      // tall phone fills with the content itself rather than empty bands;
      // the minimums are what fits an iPhone SE.
      style={{ minHeight: 'calc(100dvh - 7rem - var(--safe-top) - var(--safe-bottom))', gap: 'clamp(1.25rem, 3.6dvh, 2.25rem)' }}
    >
      <div className="flex items-center gap-4">
        {/* Display only — pet and nickname are changed in Profile. */}
        <div
          style={{ width: 'clamp(7rem, 16dvh, 9.5rem)', height: 'clamp(7rem, 16dvh, 9.5rem)' }}
          className="relative shrink-0 rounded-[1.75rem] overflow-hidden bg-gradient-to-b from-white/25 to-white/5 ring-1 ring-white/25 shadow-lg flex items-end justify-center"
        >
          <img
            ref={petImgRef}
            src={`${BASE}/${heroImageFor(avatarId)}`}
            alt="Your pet"
            onLoad={() => setPetLoaded(true)}
            className={`h-[93%] w-auto object-contain translate-y-1 drop-shadow-[0_6px_10px_rgba(0,0,0,0.3)] transition-opacity duration-300 ${petLoaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </div>
        <div className="min-w-0 flex-1">
          {nickname ? (
            <>
              <p className="text-lg font-medium text-on-bg/75 leading-tight">{greetingWord()},</p>
              <h1 className="text-[2rem] leading-tight font-bold text-on-bg truncate" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                {nickname}
              </h1>
            </>
          ) : (
            <h1 className="text-[2rem] leading-tight font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
              {greetingWord()}!
            </h1>
          )}
          {/* The pet's age = days studied (see getPetAgeDays) — it only
              ever grows, unlike the streak (which lives on Progress). */}
          {petAgeDays > 0 && (
            <p className="mt-1 text-sm font-semibold text-on-bg/85">Pet age: {formatPetAge(petAgeDays)}</p>
          )}
        </div>
      </div>

      {/* One card shape in every state, so the screen doesn't reshape
          itself once the goal is done. */}
      <div className="w-full bg-white/10 backdrop-blur-md rounded-3xl border border-white/15 shadow-sm p-5 flex flex-col" style={{ gap: 'clamp(1.25rem, 2.8dvh, 1.75rem)' }}>
        <div className="text-sm font-semibold text-on-bg/70 truncate">Today · {bookName}</div>
        {isDoneForNow ? (
          <div className="flex items-center gap-3">
            <CheckCircleIcon className="w-10 h-10 text-good shrink-0" />
            <div>
              <div className="font-bold text-on-bg text-xl leading-tight">{nothingLeftAtAll ? 'All done for today' : "Today's goal done"}</div>
              <div className="text-sm text-on-bg/65">{nothingLeftAtAll ? 'Come back tomorrow for more.' : 'Nice work! Want a few more?'}</div>
            </div>
          </div>
        ) : (
          // Two plain columns split by a hairline — number and label on one
          // line, no boxes inside the card.
          <div className="flex items-center">
            {[
              { icon: 'icon_learn_new.png', n: previewStudyCount, total: totalStudyCount, label: 'new words' },
              { icon: 'icon_review.png', n: previewReviewCount, total: totalReviewCount, label: 'to review' },
            ].map((t, i) => (
              <div key={t.label} className={`flex-1 min-w-0 flex items-center gap-3 ${i ? 'pl-4 border-l border-white/15' : 'pr-4'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${BASE}/${t.icon}`} alt="" className="w-11 h-11 object-contain shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="text-3xl font-bold text-on-bg leading-none">{t.n}</span>
                    <span className="text-sm text-on-bg/70">{t.label}</span>
                  </div>
                  {inProgress && t.n !== t.total && (
                    <div className="text-xs text-on-bg/55 mt-0.5">of {t.total} today</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!nothingLeftAtAll && (
          <button onClick={handleClick} className={`${gradientButton} py-4`} style={gradientStyle}>
            <span className="text-xl font-extrabold text-on-bg tracking-wide">{isDoneForNow ? 'Study more' : label} →</span>
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
            className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 px-3 py-3 hover:bg-white/15 transition-colors"
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
          className="flex-1 min-w-0 flex items-center justify-center gap-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 px-3 py-3 hover:bg-white/15 transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/${avatarImageFor(avatarId, equipped)}`} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
          <span className="font-semibold text-on-bg text-sm truncate">Chat</span>
        </button>
      </div>

    </div>
  );
}
