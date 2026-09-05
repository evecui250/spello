'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WORDS, glossFor, Word } from '../lib/words';
import { getMergedProgressAcrossLevels, getSettings, getTheme, Theme, THEME_CHANGED_EVENT, getDailyWordLog, today, WordProgress, MascotStageId, getAllCustomWordsAcrossLevels } from '../lib/storage';
import { THEME_CONFIG } from './AppBackground';
import { speakWord } from '../lib/speech';
import { getOrCreateDeviceId } from '../lib/telemetry';
import { supabase } from '../lib/supabase';
import { GAME_MIN_WORDS_REQUIRED } from '../lib/practice';
import { PointsIcon } from './icons';

// The actual "match the German word to its meaning" game, shared by every
// real entry point: app/game/page.tsx (a bookmarkable standalone link,
// source=settings_preview by default), DailySessionFlow's post-congrats
// bonus round (source=daily_flow), and Progress page's four per-stage
// rapid-review buttons (source=puppy_review/short_review/medium_review/
// mastered_review, via app/game/page.tsx's own ?source= routing) — same
// game every time, just tagged differently in game_plays, pointed at a
// different word pool (see focus), and given a different way out (onQuit/
// homeHref).

// A learner-recognizable word: reached its first mascot stage (puppy) or
// beyond — matches "already learnt" the same way the rest of the app
// already defines it (see Progress page's own stage breakdown). Pulled
// across every level (getMergedProgressAcrossLevels), not just the
// currently active one, since the game itself isn't level-specific.
// Includes learner-added custom words (see lib/practice.ts's
// hasEnoughWordsForGame, which gates whether this game is even reachable,
// and allWordsForLevel's own comment) — a custom word earns its way into
// this game the same as any corpus word once it's actually learned.
//
// focus=<stage> narrows this to ONLY that one mascot stage — the Progress
// page's per-stage "rapid review" buttons (source=puppy_review/short_review/
// medium_review/mastered_review, one per stage, see REVIEW_SOURCE there):
// mastered words in particular are retired from the normal SRS schedule for
// good (see recordMilestonePass), so that one is the ONLY remaining way to
// see them again; the other three stages still get their normal scheduled
// reviews too, this is just extra practice in between. Once the pool is
// restricted this way, pickRoundWords below needs no changes of its own —
// every round it draws already comes entirely from this same
// single-stage pool.
function getLearnedWords(focus?: MascotStageId): Word[] {
  const progress = getMergedProgressAcrossLevels();
  const all = [...WORDS, ...getAllCustomWordsAcrossLevels()];
  if (focus) return all.filter(w => progress[w.id]?.mascotStage === focus);
  return all.filter(w => !!progress[w.id]?.mascotStage);
}

const GAME_DURATION = 60;
const PAIRS_PER_ROUND = 5;
// Reserved out of each round's 5 slots for "mastered" (long-crowned) words
// specifically, whenever any exist — see pickRoundWords below for why.
const MASTERED_SLOTS = 2;
const POINTS_PER_MATCH = 1;

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function mostRecentDate(p?: WordProgress): string {
  if (!p) return '';
  const a = p.lastPracticed ?? '';
  const b = p.lastReviewedAt ?? '';
  return a > b ? a : b;
}

// Which words fill a round's board, in priority order:
//   1. Up to MASTERED_SLOTS words already at the final (long-crowned)
//      stage — the SRS schedule never brings these back for review once
//      mastered, so this game is genuinely the only remaining chance to
//      see them again. Reserved unconditionally (not just a fallback), so
//      a learner who touched >= PAIRS_PER_ROUND words today doesn't
//      accidentally crowd mastered words out of every single round.
//   2. Words touched (learned or reviewed) TODAY specifically — the
//      game's actual purpose is reinforcing what's fresh, so these fill
//      the rest of the board first.
//   3. Anything else already learned, sorted by MOST RECENT activity
//      first (not random) — confirmed real: a small today's-words pool
//      meant every round redrew the exact same 5 words. `usedIds` (see
//      the caller) already excludes words seen earlier this game
//      session, and recency ordering here means once that's spent,
//      yesterday's words come up before older ones, maximizing how much
//      vocabulary gets touched over a full game rather than looping a
//      handful of words.
function pickRoundWords(
  pool: Word[],
  todayIds: Set<string>,
  masteredIds: Set<string>,
  usedIds: Set<string>,
  progress: Record<string, WordProgress>,
): Word[] {
  const source = pool.filter(w => !usedIds.has(w.id));
  const masteredPool = shuffled(source.filter(w => masteredIds.has(w.id)));
  const picked: Word[] = masteredPool.slice(0, Math.min(MASTERED_SLOTS, PAIRS_PER_ROUND));
  const pickedIds = new Set(picked.map(w => w.id));

  const todayPool = shuffled(source.filter(w => todayIds.has(w.id) && !pickedIds.has(w.id)));
  for (const w of todayPool) {
    if (picked.length >= PAIRS_PER_ROUND) break;
    picked.push(w);
    pickedIds.add(w.id);
  }

  if (picked.length < PAIRS_PER_ROUND) {
    const restPool = [...source.filter(w => !pickedIds.has(w.id))]
      .sort((a, b) => mostRecentDate(progress[b.id]).localeCompare(mostRecentDate(progress[a.id])));
    for (const w of restPool) {
      if (picked.length >= PAIRS_PER_ROUND) break;
      picked.push(w);
      pickedIds.add(w.id);
    }
  }
  return shuffled(picked.slice(0, Math.min(PAIRS_PER_ROUND, pool.length)));
}

type Phase = 'intro' | 'playing' | 'over';

interface Props {
  // Tags every recorded game_plays row (see that migration) so the admin
  // dashboard can split "played from Settings' preview" vs. "today's real
  // bonus round" vs. each per-stage rapid review from Progress apart.
  source: 'settings_preview' | 'daily_flow' | 'puppy_review' | 'short_review' | 'medium_review' | 'mastered_review';
  // When provided, replaces the standalone page's own "← Home" link with
  // a quit action instead, and adds a second way out on the results
  // screen — DailySessionFlow's post-congrats round has no page chrome of
  // its own to navigate away with, and the whole point there is "play
  // again and again, or finish for today," not a one-shot preview.
  onQuit?: () => void;
  // Only ever passed alongside onQuit, from DailySessionFlow's bonus
  // round now that there are two games (see GamePicker) — when present,
  // the results screen leads with "Choose a game" instead of "Play
  // again" as the primary action (still available, just demoted to a
  // secondary link) so returning to the picker is the obvious next step.
  onChooseGame?: () => void;
  // Narrows the word pool to only ONE mascot stage — see getLearnedWords'
  // own comment. Every other prop below is cosmetic text overrides for
  // that same mode (app/game/page.tsx's ?source=*_review cases), so this
  // one screen doesn't need a parallel "StageReviewGame" component of its
  // own just to say different words around the identical game.
  focus?: MascotStageId;
  title?: string;
  subtitle?: string;
  notEnoughMessage?: (have: number, need: number) => string;
  homeHref?: string;
  homeLabel?: string;
  // Both the top-bar quit button (with its own trailing " →") and the
  // results screen's plain quit link reuse this one label, rather than
  // taking two separately-overridable strings that would always change
  // together anyway.
  quitLabel?: string;
}

export default function WordMatchGame({
  source, onQuit, onChooseGame, focus, title = 'Wortpaare', subtitle, notEnoughMessage,
  homeHref = '/', homeLabel = '← Home', quitLabel = 'Finish for today',
}: Props) {
  const [theme, setTheme] = useState<Theme>('forest');
  const [learnedWords, setLearnedWords] = useState<Word[]>([]);
  const [phase, setPhase] = useState<Phase>('intro');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [matchedCount, setMatchedCount] = useState(0);
  // Only signed-in players actually earn a point for a completed game
  // (see lib/shop.ts's GAME_PLAY_DAILY_POINT_CAP) — set alongside the
  // game_plays insert below rather than shown unconditionally.
  const [earnedPoint, setEarnedPoint] = useState(false);

  const [roundWords, setRoundWords] = useState<Word[]>([]);
  const [shuffledEn, setShuffledEn] = useState<string[]>([]);
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());
  const [selectedGerman, setSelectedGerman] = useState<string | null>(null);
  const [selectedEnglish, setSelectedEnglish] = useState<string | null>(null);
  const [wrongFlash, setWrongFlash] = useState<{ german: string; english: string } | null>(null);
  const [justScored, setJustScored] = useState(false);
  // Words already seen THIS game session — a ref, not state, since it's
  // only ever read/written inside drawRound and never needs to trigger a
  // render on its own. Reset on startGame; also reset mid-game once it's
  // grown to cover (almost) the whole pool, so the game keeps cycling
  // through everything rather than getting stuck unable to find fresh
  // words for the rest of the session.
  const usedIdsRef = useRef<Set<string>>(new Set());

  const nativeLanguage = getSettings().nativeLanguage;
  const cfg = THEME_CONFIG[theme];

  useEffect(() => {
    const loadTheme = () => setTheme(getTheme());
    loadTheme();
    window.addEventListener(THEME_CHANGED_EVENT, loadTheme);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, loadTheme);
  }, []);

  useEffect(() => {
    setLearnedWords(getLearnedWords(focus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canPlay = learnedWords.length >= GAME_MIN_WORDS_REQUIRED;

  function drawRound() {
    const log = getDailyWordLog()[today()];
    const todayIds = new Set([...(log?.learned ?? []), ...(log?.reviewed ?? [])]);
    const progress = getMergedProgressAcrossLevels();
    const masteredIds = new Set(
      learnedWords.filter(w => progress[w.id]?.mascotStage === 'long-crowned').map(w => w.id),
    );

    // Not enough not-yet-seen words left to fill a round -> the game has
    // cycled through everything available; start a fresh cycle instead
    // of drawing from an ever-shrinking (or empty) "fresh" pool.
    const freshCount = learnedWords.filter(w => !usedIdsRef.current.has(w.id)).length;
    if (freshCount < Math.min(PAIRS_PER_ROUND, learnedWords.length)) {
      usedIdsRef.current = new Set();
    }

    const pool = pickRoundWords(learnedWords, todayIds, masteredIds, usedIdsRef.current, progress);
    pool.forEach(w => usedIdsRef.current.add(w.id));
    setRoundWords(pool);
    setShuffledEn(shuffled(pool.map(w => glossFor(w, nativeLanguage))));
    setMatchedIds(new Set());
    setSelectedGerman(null);
    setSelectedEnglish(null);
  }

  function startGame() {
    setMatchedCount(0);
    setTimeLeft(GAME_DURATION);
    usedIdsRef.current = new Set();
    drawRound();
    setPhase('playing');
  }

  // Countdown — ticks only while actually playing.
  useEffect(() => {
    if (phase !== 'playing') return;
    if (timeLeft <= 0) {
      setPhase('over');
      return;
    }
    const t = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, timeLeft]);

  // Records one completed game (see the game_plays migration) the moment
  // the timer runs out -- best-effort/silent, same as bug_reports/
  // usage_pings: a learner should never notice this fail, and it never
  // blocks the results screen from showing regardless of outcome.
  useEffect(() => {
    if (phase !== 'over') return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user.id) setEarnedPoint(true);
        await supabase.from('game_plays').insert({
          device_id: getOrCreateDeviceId(),
          user_id: session?.user.id ?? null,
          source,
          pairs_matched: matchedCount,
        });
      } catch {
        // best-effort
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Evaluate a pair once both sides are picked (same mechanic as
  // MatchingQuizPage/the end-of-section matching quiz, just timed and
  // continuously re-drawing instead of paging through fixed content).
  useEffect(() => {
    if (!selectedGerman || !selectedEnglish || phase !== 'playing') return;
    const word = roundWords.find(w => w.id === selectedGerman);
    if (!word) return;
    if (glossFor(word, nativeLanguage) === selectedEnglish) {
      setMatchedIds(prev => new Set(prev).add(selectedGerman));
      setSelectedGerman(null);
      setSelectedEnglish(null);
      setMatchedCount(c => c + POINTS_PER_MATCH);
      setJustScored(true);
      setTimeout(() => setJustScored(false), 400);
      return;
    }
    setWrongFlash({ german: selectedGerman, english: selectedEnglish });
    const timer = setTimeout(() => {
      setWrongFlash(null);
      setSelectedGerman(null);
      setSelectedEnglish(null);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGerman, selectedEnglish, phase]);

  // Board cleared with time still on the clock -> fresh round, same timer.
  useEffect(() => {
    if (phase !== 'playing' || roundWords.length === 0) return;
    if (matchedIds.size === roundWords.length) {
      const t = setTimeout(() => drawRound(), 350);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedIds, roundWords, phase]);

  const pickGerman = (id: string) => {
    if (matchedIds.has(id) || wrongFlash) return;
    setSelectedGerman(id);
    // Speaks on every tap of a German word, right or wrong -- not just
    // when it happens to complete a correct pair (confirmed real: that
    // read as "the sound only plays when I tap the English side").
    const word = roundWords.find(w => w.id === id);
    if (word) speakWord(word);
  };
  const pickEnglish = (text: string) => {
    if (wrongFlash) return;
    const alreadyMatched = roundWords.some(w => matchedIds.has(w.id) && glossFor(w, nativeLanguage) === text);
    if (alreadyMatched) return;
    setSelectedEnglish(text);
  };

  const timerFraction = Math.max(0, timeLeft / GAME_DURATION);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-on-bg" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{title}</h1>
        {onQuit ? (
          <button type="button" onClick={onQuit} className="text-sm font-semibold text-on-bg/80 hover:text-on-bg underline">
            {quitLabel} →
          </button>
        ) : (
          <Link href={homeHref} className="text-sm font-semibold text-on-bg/80 hover:text-on-bg underline">
            {homeLabel}
          </Link>
        )}
      </div>

      {phase === 'intro' && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-4 items-center text-center">
          <h2 className="text-lg font-bold text-ink">Match words against the clock</h2>
          {subtitle && <p className="text-ink-soft text-sm -mt-2">{subtitle}</p>}
          {canPlay ? (
            <>
              <p className="text-ink-soft text-xs">{GAME_DURATION}s per game · {PAIRS_PER_ROUND} pairs per board</p>
              <button
                type="button"
                onClick={startGame}
                className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all"
                style={{ backgroundImage: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-deep) 100%)' }}
              >
                Start
              </button>
            </>
          ) : (
            <p className="text-label bg-paper-dim/70 rounded-xl px-4 py-3 text-sm">
              {notEnoughMessage
                ? notEnoughMessage(learnedWords.length, GAME_MIN_WORDS_REQUIRED)
                : `Learn at least ${GAME_MIN_WORDS_REQUIRED} words first to unlock this game — you have ${learnedWords.length} so far.`}
            </p>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className={`font-bold text-lg text-ink transition-transform ${justScored ? 'scale-125' : ''}`}>
              {matchedCount} matched
            </div>
            <div className="font-semibold text-sm text-ink-soft">
              {timeLeft}s
            </div>
          </div>
          {/* Same color throughout the countdown, however little time is
              left — no red/urgent recoloring, which read as stressful
              rather than motivating. */}
          <div className="w-full h-2.5 rounded-full bg-paper-dim/70 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${timerFraction * 100}%`, backgroundImage: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-deep) 100%)' }}
            />
          </div>

          {/* Interleaved single grid, not two independent columns — see
              MatchingQuizPage's identical layout for why: CSS Grid sizes
              each row to its tallest cell across both columns, so a
              two-line German word (more likely at a larger font size)
              doesn't drag its own column out of alignment with the other. */}
          <div className="grid grid-cols-2 gap-3">
            {roundWords.map((w, i) => {
              const isMatched = matchedIds.has(w.id);
              const isSelected = selectedGerman === w.id;
              const isWrong = wrongFlash?.german === w.id;
              let germanCls = 'border-2 border-accent/30 bg-paper/80 text-ink hover:border-accent/70';
              if (isMatched) germanCls = 'border-2 border-good-deep bg-good/25 text-good-deep opacity-0 scale-90 pointer-events-none';
              else if (isWrong) germanCls = 'border-2 border-clay bg-clay/20 text-clay';
              else if (isSelected) germanCls = 'border-2 border-accent bg-accent/10 text-label';

              const text = shuffledEn[i];
              const enIsMatched = roundWords.some(rw => matchedIds.has(rw.id) && glossFor(rw, nativeLanguage) === text);
              const enIsSelected = selectedEnglish === text;
              const enIsWrong = wrongFlash?.english === text;
              let enCls = 'border-2 border-accent/30 bg-paper/80 text-ink hover:border-accent/70';
              if (enIsMatched) enCls = 'border-2 border-good-deep bg-good/25 text-good-deep opacity-0 scale-90 pointer-events-none';
              else if (enIsWrong) enCls = 'border-2 border-clay bg-clay/20 text-clay';
              else if (enIsSelected) enCls = 'border-2 border-accent bg-accent/10 text-label';

              return (
                <Fragment key={w.id}>
                  <button
                    onClick={() => pickGerman(w.id)}
                    disabled={isMatched || !!wrongFlash}
                    className={`px-3 py-2.5 rounded-xl font-semibold text-sm text-left transition-all duration-300 ${germanCls}`}
                  >
                    {w.article ? `${w.article} ` : ''}{w.de}
                  </button>
                  <button
                    onClick={() => pickEnglish(text)}
                    disabled={enIsMatched || !!wrongFlash}
                    className={`px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all duration-300 ${enCls}`}
                  >
                    {text}
                  </button>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-3 items-center text-center">
          <h2 className="text-lg font-bold text-ink">Time&apos;s up!</h2>
          <div className="text-3xl font-extrabold text-label">{matchedCount} pairs matched</div>
          {earnedPoint && (
            <div className="flex items-center gap-1 text-label font-mono font-bold text-sm">
              <PointsIcon className="w-4 h-4" /> +1 point
            </div>
          )}
          {onChooseGame ? (
            <>
              <button
                type="button"
                onClick={onChooseGame}
                className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all mt-2"
                style={{ backgroundImage: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-deep) 100%)' }}
              >
                Choose a game →
              </button>
              <button
                type="button"
                onClick={startGame}
                className="text-ink-soft hover:text-ink text-sm font-medium underline transition-colors"
              >
                Play again
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startGame}
              className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all mt-2"
              style={{ backgroundImage: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-deep) 100%)' }}
            >
              Play again
            </button>
          )}
          {onQuit && (
            <button
              type="button"
              onClick={onQuit}
              className="text-ink-soft hover:text-ink text-sm font-medium underline transition-colors"
            >
              {quitLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
