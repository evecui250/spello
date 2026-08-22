'use client';

import { useEffect, useState } from 'react';
import WordMatchGame from '../../components/WordMatchGame';

// Standalone entry point — reachable from Settings' own "Try the new game"
// link, and still the only way to play outside today's real daily-flow
// bonus round (see DailySessionFlow's own post-congrats usage of
// WordMatchGame, source=daily_flow). The actual game lives there now;
// this page is just its page-level chrome (no "Finish for today" quit
// button here — the "← Home" link WordMatchGame renders on its own when
// no onQuit is passed already covers leaving).
export default function GamePage() {
  // Which entry point sent the learner here -- see the game_plays
  // migration, which this tags every recorded play with. Plain
  // window.location (not Next's useSearchParams) specifically to avoid
  // the Suspense-boundary requirement that hook needs under
  // `output: 'export'` -- same reasoning as DailySessionFlow's own
  // previewSignInNudge param. Defaults to 'settings_preview' since that's
  // this page's own entry point -- Settings' own link passes this
  // explicitly too, so the default only matters for a bookmarked/typed-in
  // URL with no query string at all.
  const [source, setSource] = useState<'settings_preview' | 'daily_flow'>('settings_preview');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('source') === 'daily_flow') setSource('daily_flow');
  }, []);

  return <WordMatchGame source={source} />;
}
