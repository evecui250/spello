'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WORDS, glossFor, Word } from '../../lib/words';
import { getMergedProgressAcrossLevels, getSettings, getTheme, Theme, THEME_CHANGED_EVENT, getDailyWordLog, today } from '../../lib/storage';
import { THEME_CONFIG } from '../../components/AppBackground';
import { speakWord } from '../../lib/speech';

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
// Below this many learned words, there simply isn't enough vocabulary to
// fill even one round's board — the game stays locked with an explanatory
// message instead of a Start button.
const MIN_WORDS_REQUIRED = 5;
const PAIRS_PER_ROUND = 5;
// Reserved out of each round's 5 slots for "mastered" (long-crowned) words
// specifically, whenever any exist — see pickRoundWords below for why.
const MASTERED_SLOTS = 2;
const POINTS_PER_MATCH = 1;

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
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
//   3. Anything else already learned, as a fallback so a round is never
//      short a pair just because today's/mastered pools ran dry.
function pickRoundWords(pool: Word[], todayIds: Set<string>, masteredIds: Set<string>): Word[] {
  const masteredPool = shuffled(pool.filter(w => masteredIds.has(w.id)));
  const picked: Word[] = masteredPool.slice(0, Math.min(MASTERED_SLOTS, PAIRS_PER_ROUND));
  const pickedIds = new Set(picked.map(w => w.id));

  const todayPool = shuffled(pool.filter(w => todayIds.has(w.id) && !pickedIds.has(w.id)));
  for (const w of todayPool) {
    if (picked.length >= PAIRS_PER_ROUND) break;
    picked.push(w);
    pickedIds.add(w.id);
  }

  if (picked.length < PAIRS_PER_ROUND) {
    const restPool = shuffled(pool.filter(w => !pickedIds.has(w.id)));
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

  const canPlay = learnedWords.length >= MIN_WORDS_REQUIRED;

  function drawRound() {
    const log = getDailyWordLog()[today()];
    const todayIds = new Set([...(log?.learned ?? []), ...(log?.reviewed ?? [])]);
    const masteredProgress = getMergedProgressAcrossLevels();
    const masteredIds = new Set(
      learnedWords.filter(w => masteredProgress[w.id]?.mascotStage === 'long-crowned').map(w => w.id),
    );
    const pool = pickRoundWords(learnedWords, todayIds, masteredIds);
    setRoundWords(pool);
    setShuffledEn(shuffled(pool.map(w => glossFor(w, nativeLanguage))));
    setMatchedIds(new Set());
    setSelectedGerman(null);
    setSelectedEnglish(null);
  }

  function startGame() {
    setMatchedCount(0);
    setTimeLeft(GAME_DURATION);
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
              Learn at least {MIN_WORDS_REQUIRED} words first to unlock this
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
