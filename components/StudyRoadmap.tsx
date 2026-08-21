'use client';

import { useEffect, useState } from 'react';
import { getDailySession, getTheme, Theme, THEME_CHANGED_EVENT, PROGRESS_CHANGED_EVENT, SessionPhase } from '../lib/storage';
import { THEME_CONFIG } from './AppBackground';

type Stage = 'review' | 'learn' | 'play';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'review', label: 'Review' },
  { id: 'learn', label: 'Learn' },
  { id: 'play', label: 'Play' },
];

// Discrete, not proportional — the marker sits at exactly one of the 3
// points, not somewhere fractionally between them, per request. Review
// covers every review-* phase plus 'report' (still the review results
// screen); Learn covers every study-* phase; Play lights up once the
// congrats card is showing or the day is fully done.
function stageForPhase(phase: SessionPhase): Stage {
  if (phase === 'congrats' || phase === 'done') return 'play';
  if (phase.startsWith('study')) return 'learn';
  return 'review';
}

interface Props {
  // Renders a fixed stage instead of reading the real session — used for
  // Settings' preview of this feature. Omit for the real thing (see
  // app/practice/page.tsx).
  previewStage?: Stage;
}

// A horizontal "where am I today" strip under the round card: Review,
// Learn, Play, equally spaced, matching the actual order today's session
// runs in (review first, then study, then the bonus game — see
// startDailySession). The current point is always exactly one of the
// three, never in between.
export default function StudyRoadmap({ previewStage }: Props) {
  const isPreview = previewStage !== undefined;
  const [theme, setTheme] = useState<Theme>('forest');
  const [stage, setStage] = useState<Stage | null>(null);

  useEffect(() => {
    const loadTheme = () => setTheme(getTheme());
    loadTheme();
    window.addEventListener(THEME_CHANGED_EVENT, loadTheme);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, loadTheme);
  }, []);

  useEffect(() => {
    if (isPreview) return;
    const load = () => {
      const session = getDailySession();
      setStage(session ? stageForPhase(session.phase) : null);
    };
    load();
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview]);

  const activeStage = isPreview ? previewStage! : stage;
  if (!activeStage) return null;
  const cfg = THEME_CONFIG[theme];
  const activeIndex = STAGES.findIndex(s => s.id === activeStage);

  return (
    <div className="relative px-6 pt-2 pb-1">
      <div className="absolute left-6 right-6 top-4 h-0.5 bg-black/20 rounded-full" />
      <div
        className="absolute left-6 top-4 h-0.5 rounded-full transition-all duration-500"
        style={{ width: `calc((100% - 3rem) * ${activeIndex / (STAGES.length - 1)})`, backgroundImage: cfg.buttonGradient }}
      />
      <div className="relative flex items-start justify-between">
        {STAGES.map((s, i) => {
          const reached = i <= activeIndex;
          const isActive = i === activeIndex;
          return (
            <div key={s.id} className="flex flex-col items-center gap-1">
              <div
                className={`w-4 h-4 rounded-full border-2 border-white/70 transition-all ${isActive ? 'scale-125' : ''}`}
                style={reached ? { backgroundImage: cfg.buttonGradient } : { backgroundColor: 'rgba(255,255,255,0.2)' }}
              />
              <span
                className={`text-[11px] font-semibold ${isActive ? 'text-amber-100' : 'text-amber-100/55'}`}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
              >
                {s.label}{s.id === 'play' ? ' 🎮' : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
