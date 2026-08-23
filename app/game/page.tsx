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
export default function GamePage() {
  // Which entry point sent the learner here -- see the game_plays
  // migration, which this tags every recorded play with. Plain
  // window.location (not Next's useSearchParams) specifically to avoid
  // the Suspense-boundary requirement that hook needs under
  // `output: 'export'` -- same reasoning as DailySessionFlow's own
  // previewSignInNudge param.
  const [source, setSource] = useState<'settings_preview' | 'daily_flow'>('settings_preview');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('source') === 'daily_flow') setSource('daily_flow');
  }, []);

  return <WordMatchGame source={source} />;
}
