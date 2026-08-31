'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getDailySession, getTheme, Theme, THEME_CHANGED_EVENT, PROGRESS_CHANGED_EVENT, SessionPhase } from '../lib/storage';
import { hasEnoughWordsForGame } from '../lib/practice';
import { THEME_CONFIG } from './AppBackground';

type Stage = 'review' | 'learn' | 'play';

const ALL_STAGES: { id: Stage; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'learn', label: 'Learn' },
  { id: 'play', label: 'Play' },
];

// Discrete, not proportional — the marker sits at exactly one of the 3
// points, not somewhere fractionally between them, per request. Review
// covers every review-* phase plus 'report' (still the review results
// screen); Learn covers every study-* phase; Play lights up once the
// congrats card is showing, the real bonus round is (phase 'play'), or
// the day is fully done. `gameUnlocked` is false for the same reason the
// bonus round itself is skipped straight to 'done' (see
// DailySessionFlow's handleCloseCongrats/hasEnoughWordsForGame) —
// congrats/done then reads as "learn" instead, since that's genuinely as
// far as this learner (most commonly an A1 learner in their first day or
// two) can go today. There's no third dot to fall short of at all in
// that case — see the STAGES filter below.
function stageForPhase(phase: SessionPhase, gameUnlocked: boolean): Stage {
  if (phase === 'play' || phase === 'congrats' || phase === 'done') return gameUnlocked ? 'play' : 'learn';
  if (phase.startsWith('study')) return 'learn';
  return 'review';
}

// A horizontal "where am I today" bar: Review, Learn, Play, equally
// spaced, matching the actual order today's session runs in (review
// first, then study, then the bonus game — see startDailySession). The
// current point is always exactly one of the three, never in between.
// Rendered from app/layout.tsx (stacked directly above NavBar as one
// combined fixed bottom bar, always on screen during learning regardless
// of device) — this component decides for itself whether that's
// appropriate right now by checking the route, rather than the layout
// needing to know which pages care about it.
export default function StudyRoadmap() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>('forest');
  const [stage, setStage] = useState<Stage | null>(null);
  // Whether the Word Match game is actually reachable yet (see
  // hasEnoughWordsForGame) — re-read alongside `stage` on every progress
  // change, since crossing the word-count threshold mid-session (finishing
  // today's last new word) should make "Play" appear without needing a
  // reload.
  const [gameUnlocked, setGameUnlocked] = useState(false);

  useEffect(() => {
    const loadTheme = () => setTheme(getTheme());
    loadTheme();
    window.addEventListener(THEME_CHANGED_EVENT, loadTheme);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, loadTheme);
  }, []);

  useEffect(() => {
    const load = () => {
      const unlocked = hasEnoughWordsForGame();
      setGameUnlocked(unlocked);
      const session = getDailySession();
      setStage(session ? stageForPhase(session.phase, unlocked) : null);
    };
    load();
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
  }, []);

  // trailingSlash is on for this static export, so the real pathname is
  // "/practice/" — comparing with a trailing slash stripped handles that
  // (and would also tolerate it being off).
  if (pathname?.replace(/\/$/, '') !== '/practice' || !stage) return null;
  // Dropped entirely rather than shown-but-disabled — a learner who can't
  // reach the game yet shouldn't see it advertised as a destination on
  // their own roadmap at all (see hasEnoughWordsForGame's own comment).
  const STAGES = gameUnlocked ? ALL_STAGES : ALL_STAGES.filter(s => s.id !== 'play');
  const cfg = THEME_CONFIG[theme];
  const activeIndex = STAGES.findIndex(s => s.id === stage);

  return (
    <div className="bg-black/25 backdrop-blur-md border-t border-white/10">
      <div className="max-w-2xl mx-auto relative px-8 pt-3 pb-2.5">
        <div className="absolute left-8 right-8 top-[22px] h-0.5 bg-white/15 rounded-full" />
        <div
          className="absolute left-8 top-[22px] h-0.5 rounded-full transition-all duration-500"
          style={{ width: `calc((100% - 4rem) * ${activeIndex / (STAGES.length - 1)})`, backgroundImage: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-deep) 100%)' }}
        />
        <div className="relative flex items-start justify-between">
          {STAGES.map((s, i) => {
            const reached = i <= activeIndex;
            const isActive = i === activeIndex;
            return (
              <div key={s.id} className="flex flex-col items-center gap-1">
                <div
                  className={`w-4 h-4 rounded-full border-2 border-white/70 transition-all ${isActive ? 'scale-125' : ''}`}
                  style={reached ? { backgroundImage: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-deep) 100%)' } : { backgroundColor: 'rgba(255,255,255,0.2)' }}
                />
                <span
                  className={`text-[11px] font-semibold ${isActive ? 'text-on-bg' : 'text-on-bg/55'}`}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
