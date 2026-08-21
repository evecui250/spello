'use client';

import { useEffect, useState } from 'react';
import { getDailySession, getTheme, Theme, THEME_CHANGED_EVENT, PROGRESS_CHANGED_EVENT } from '../lib/storage';
import { isRoundsDone } from './DailySessionFlow';
import { THEME_CONFIG } from './AppBackground';

interface Props {
  // Renders a fixed, non-live illustration instead of reading real session
  // data — used for Settings' preview of this feature, so it has
  // something sensible to show without an actual in-progress day behind
  // it. Omit for the real thing (see app/practice/page.tsx).
  previewFraction?: number;
}

// A vertical "where am I today" strip next to the round card: Review at
// the top, Learn in the middle, Play (the bonus word-match game, once
// wired in for real) at the bottom — matching the actual order today's
// session runs in (review first, then study, see startDailySession).
// The marker's position is a genuine percentage of today's combined
// review+study content done so far, not just a 3-way phase snap, so it
// visibly creeps down through each section as cards get answered.
export default function StudyRoadmap({ previewFraction }: Props) {
  const isPreview = previewFraction !== undefined;
  const [theme, setTheme] = useState<Theme>('forest');
  const [stats, setStats] = useState<{ reviewTotal: number; reviewDone: number; studyTotal: number; studyDone: number; reachedPlay: boolean } | null>(null);

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
      if (!session) { setStats(null); return; }
      setStats({
        reviewTotal: session.reviewWordIds.length,
        reviewDone: session.reviewWordIds.filter(id => isRoundsDone(id, 'review')).length,
        studyTotal: session.studyWordIds.length,
        studyDone: session.studyWordIds.filter(id => isRoundsDone(id, 'study')).length,
        reachedPlay: session.phase === 'done',
      });
    };
    load();
    window.addEventListener(PROGRESS_CHANGED_EVENT, load);
    return () => window.removeEventListener(PROGRESS_CHANGED_EVENT, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview]);

  if (!isPreview && !stats) return null;
  const cfg = THEME_CONFIG[theme];

  const overallTotal = isPreview ? 0 : stats!.reviewTotal + stats!.studyTotal;
  const overallDone = isPreview ? 0 : stats!.reviewDone + stats!.studyDone;
  const reachedPlay = isPreview ? previewFraction! >= 1 : stats!.reachedPlay;
  const fraction = isPreview ? Math.min(1, previewFraction!) : reachedPlay ? 1 : overallTotal > 0 ? Math.min(1, overallDone / overallTotal) : 0;
  // Where the track's Review section ends and Learn begins — proportional
  // to how much of today's actual content is review vs. study, so a day
  // that's mostly review (or mostly new words) still looks right instead
  // of always splitting the track 50/50. Preview has no real split to go
  // by, so it just splits evenly.
  const boundary = isPreview ? 0.5 : overallTotal > 0 ? stats!.reviewTotal / overallTotal : 0.5;

  return (
    <div className="w-11 shrink-0 flex flex-col items-center py-2">
      <span className="text-[9px] font-semibold text-amber-100/85 text-center leading-tight" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>
        Review
      </span>
      <div className="relative flex-1 w-1.5 my-1.5 rounded-full bg-black/25 overflow-visible">
        <div
          className="absolute top-0 left-0 w-full rounded-full transition-all duration-500 ease-out"
          style={{ height: `${fraction * 100}%`, backgroundImage: cfg.buttonGradient }}
        />
        {/* "Learn" sits at the Review/Learn boundary, not fixed at 50% */}
        <span
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] font-semibold text-amber-100/85 whitespace-nowrap"
          style={{ top: `${boundary * 100}%`, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
        >
          Learn
        </span>
        <div
          className="absolute left-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-all duration-500 ease-out"
          style={{ top: `${fraction * 100}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>
      <span className={`text-[9px] font-semibold text-center leading-tight ${reachedPlay ? 'text-amber-100' : 'text-amber-100/60'}`} style={{ textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>
        {reachedPlay ? 'Play 🎮' : 'Play'}
      </span>
    </div>
  );
}
