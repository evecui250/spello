'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WORDS, glossFor, Word } from '../../lib/words';
import { getMergedProgressAcrossLevels, getSettings, getTheme, Theme, THEME_CHANGED_EVENT, getDailyWordLog, today, WordProgress } from '../../lib/storage';
import { THEME_CONFIG } from '../../components/AppBackground';
import { speakWord } from '../../lib/speech';
import { getOrCreateDeviceId } from '../../lib/telemetry';
import { supabase } from '../../lib/supabase';
import { GAME_MIN_WORDS_REQUIRED } from '../../lib/practice';

// PREVIEW PAGE — not linked from the main flow yet (see Settings' own
// "Try the new game" link for the only current entry point). Once this is
// actually wired into "after today's congrats card, once per day", it'll
// need a real once-per-day gate the same way DailyStats/DailySession
// already gate everything else — deliberately not built yet since this is
// still just for trying the game itself out.

// A learner-recognizable word: reached its first mascot stage (puppy) or
// beyond — matches "already learnt" the same way the rest of the app
// already defines it (see Progress page's own stage breakdown). Pulled
// across every level (getMergedProgressAcrossLevels), not just the
// currently active one, since the game itself isn't level-specific.
function getLearnedWords(): Word[] {
  const progress = getMergedProgressAcrossLevels();
  return WORDS.filter(w => !!progress[w.id]?.mascotStage);
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

export default function GamePage() {
  const [theme, setTheme] = useState<Theme>('forest');
  const [learnedWords, setLearnedWords] = useState<Word[]>([]);
  const [phase, setPhase] = useState<Phase>('intro');
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [matchedCount, setMatchedCount] = useState(0);

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
  // Which entry point sent the learner here -- see the game_plays
  // migration, which this tags every recorded play with. Plain
  // window.location (not Next's useSearchParams) specifically to avoid
  // the Suspense-boundary requirement that hook needs under
  // `output: 'export'` -- same reasoning as DailySessionFlow's own
  // previewSignInNudge param. Defaults to 'settings_preview' since that's
  // this game's only real entry point right now (see this file's own top
  // comment) -- Settings' own link passes this explicitly too, so the
  // default only matters for a bookmarked/typed-in URL with no query
  // string at all.
  const [source, setSource] = useState<'settings_preview' | 'daily_flow'>('settings_preview');

  const nativeLanguage = getSettings().nativeLanguage;
  const cfg = THEME_CONFIG[theme];

  useEffect(() => {
    const loadTheme = () => setTheme(getTheme());
    loadTheme();
    window.addEventListener(THEME_CHANGED_EVENT, loadTheme);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, loadTheme);
  }, []);

  useEffect(() => {
    setLearnedWords(getLearnedWords());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('source') === 'daily_flow') setSource('daily_flow');
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
      speakWord(word);
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
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Word Match</h1>
        <Link href="/" className="text-sm font-semibold text-amber-100/80 hover:text-amber-100 underline">
          ← Home
        </Link>
      </div>

      {phase === 'intro' && (
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-4 items-center text-center">
          <div className="text-5xl">🎮</div>
          <h2 className="text-lg font-bold text-stone-800">Match words against the clock</h2>
          {canPlay ? (
            <>
              <p className="text-stone-400 text-xs">{GAME_DURATION}s per game · {PAIRS_PER_ROUND} pairs per board</p>
              <button
                type="button"
                onClick={startGame}
                className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all"
                style={{ backgroundImage: cfg.buttonGradient }}
              >
                Start
              </button>
            </>
          ) : (
            <p className="text-amber-700 bg-amber-100/70 rounded-xl px-4 py-3 text-sm">
              Learn at least {GAME_MIN_WORDS_REQUIRED} words first to unlock this
              game — you have {learnedWords.length} so far.
            </p>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className={`font-bold text-lg text-stone-800 transition-transform ${justScored ? 'scale-125' : ''}`}>
              {matchedCount} matched
            </div>
            <div className="font-semibold text-sm text-stone-500">
              {timeLeft}s
            </div>
          </div>
          {/* Same color throughout the countdown, however little time is
              left — no red/urgent recoloring, which read as stressful
              rather than motivating. */}
          <div className="w-full h-2.5 rounded-full bg-stone-200/70 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${timerFraction * 100}%`, backgroundImage: cfg.buttonGradient }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              {roundWords.map(w => {
                const isMatched = matchedIds.has(w.id);
                const isSelected = selectedGerman === w.id;
                const isWrong = wrongFlash?.german === w.id;
                let cls = 'border-2 border-indigo-200 bg-white/80 text-slate-700 hover:border-indigo-400';
                if (isMatched) cls = 'border-2 border-green-400 bg-green-100 text-green-700 opacity-0 scale-90 pointer-events-none';
                else if (isWrong) cls = 'border-2 border-red-400 bg-red-100 text-red-700';
                else if (isSelected) cls = 'border-2 border-indigo-500 bg-indigo-50 text-indigo-700';
                return (
                  <button
                    key={w.id}
                    onClick={() => pickGerman(w.id)}
                    disabled={isMatched || !!wrongFlash}
                    className={`px-3 py-2.5 rounded-xl font-semibold text-sm text-left transition-all duration-300 ${cls}`}
                  >
                    {w.article ? `${w.article} ` : ''}{w.de}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2">
              {shuffledEn.map(text => {
                const isMatched = roundWords.some(w => matchedIds.has(w.id) && glossFor(w, nativeLanguage) === text);
                const isSelected = selectedEnglish === text;
                const isWrong = wrongFlash?.english === text;
                let cls = 'border-2 border-indigo-200 bg-white/80 text-slate-700 hover:border-indigo-400';
                if (isMatched) cls = 'border-2 border-green-400 bg-green-100 text-green-700 opacity-0 scale-90 pointer-events-none';
                else if (isWrong) cls = 'border-2 border-red-400 bg-red-100 text-red-700';
                else if (isSelected) cls = 'border-2 border-indigo-500 bg-indigo-50 text-indigo-700';
                return (
                  <button
                    key={text}
                    onClick={() => pickEnglish(text)}
                    disabled={isMatched || !!wrongFlash}
                    className={`px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all duration-300 ${cls}`}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-3 items-center text-center">
          <div className="text-5xl">⏱️</div>
          <h2 className="text-lg font-bold text-stone-800">Time&apos;s up!</h2>
          <div className="text-3xl font-extrabold text-indigo-700">{matchedCount} pairs matched</div>
          <button
            type="button"
            onClick={startGame}
            className="w-full max-w-[220px] text-white py-3.5 rounded-full font-bold text-lg shadow-md active:scale-95 transition-all mt-2"
            style={{ backgroundImage: cfg.buttonGradient }}
          >
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
