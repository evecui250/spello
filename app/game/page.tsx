'use client';

import { useEffect, useState } from 'react';
import WordMatchGame from '../../components/WordMatchGame';

// Standalone page for the game — no longer linked from Settings (owner
// call: the game should only be reachable after finishing today's goal,
// via DailySessionFlow's own post-congrats bonus round, source=daily_flow
// — see its own usage of WordMatchGame there). The actual game lives in
// WordMatchGame; this page is just its page-level chrome (no "Finish for
// today" quit button here — the "← Home" link WordMatchGame renders on
// its own when no onQuit is passed already covers leaving). Still reachable
// by a direct/bookmarked URL with no query string, which is what the
// settings_preview default below covers.
//
// ?source=mastered_review is the Progress page's "Mastered" popup —
// mastered words are retired from the normal SRS schedule for good, so
// this is the one remaining way to see them again. It reuses this exact
// route/component (focus='mastered' just narrows WordMatchGame's own word
// pool) rather than a separate page, and points its own "← Home" fallback
// back at Progress instead of the app's actual Home, since that's where a
// learner reaching this URL actually came from.
export default function GamePage() {
  // Which entry point sent the learner here -- see the game_plays
  // migration, which this tags every recorded play with. Plain
  // window.location (not Next's useSearchParams) specifically to avoid
  // the Suspense-boundary requirement that hook needs under
  // `output: 'export'` -- same reasoning as DailySessionFlow's own
  // previewSignInNudge param.
  const [source, setSource] = useState<'settings_preview' | 'daily_flow' | 'mastered_review'>('settings_preview');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const s = params.get('source');
    if (s === 'daily_flow' || s === 'mastered_review') setSource(s);
  }, []);

  if (source === 'mastered_review') {
    return (
      <WordMatchGame
        source={source}
        focus="mastered"
        title="Mastered Refresh"
        subtitle="A quick refresher — mastered words are never brought back for review automatically."
        notEnoughMessage={(have, need) => `Master at least ${need} words first to unlock this refresher — you have ${have} mastered so far.`}
        homeHref="/progress/"
        homeLabel="← Progress"
      />
    );
  }

  return <WordMatchGame source={source} />;
}
