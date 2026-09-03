'use client';

import { useEffect, useState } from 'react';
import WordMatchGame from '../../components/WordMatchGame';
import { MascotStageId } from '../../lib/storage';

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
// ?source=puppy_review/short_review/medium_review/mastered_review are the
// Progress page's four per-stage popups (see its own REVIEW_SOURCE map) —
// each narrows WordMatchGame's own word pool to just that one mascot
// stage (focus) rather than needing a separate page/component per stage.
// All four point their "← Home" fallback back at Progress instead of the
// app's actual Home, since that's where a learner reaching this URL
// actually came from.
type ReviewSource = 'puppy_review' | 'short_review' | 'medium_review' | 'mastered_review';

const REVIEW_CONFIG: Record<ReviewSource, { focus: MascotStageId; title: string; subtitle: string; label: string }> = {
  puppy_review: {
    focus: 'puppy',
    title: 'Introduced Refresh',
    subtitle: 'A quick refresher for freshly introduced words — extra practice before their first real review.',
    label: 'introduced',
  },
  short_review: {
    focus: 'short',
    title: 'Familiar Refresh',
    subtitle: 'A quick refresher for familiar words — extra practice between reviews.',
    label: 'familiar',
  },
  medium_review: {
    focus: 'medium',
    title: 'Strong Refresh',
    subtitle: "A quick refresher for words you're almost mastered on — extra practice between reviews.",
    label: 'strong',
  },
  mastered_review: {
    focus: 'long-crowned',
    title: 'Mastered Refresh',
    subtitle: 'A quick refresher — mastered words are never brought back for review automatically.',
    label: 'mastered',
  },
};

function isReviewSource(s: string | null): s is ReviewSource {
  return !!s && s in REVIEW_CONFIG;
}

export default function GamePage() {
  // Which entry point sent the learner here -- see the game_plays
  // migration, which this tags every recorded play with. Plain
  // window.location (not Next's useSearchParams) specifically to avoid
  // the Suspense-boundary requirement that hook needs under
  // `output: 'export'` -- same reasoning as DailySessionFlow's own
  // previewSignInNudge param.
  const [source, setSource] = useState<'settings_preview' | 'daily_flow' | ReviewSource>('settings_preview');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const s = params.get('source');
    if (s === 'daily_flow' || isReviewSource(s)) setSource(s);
  }, []);

  if (isReviewSource(source)) {
    const { focus, title, subtitle, label } = REVIEW_CONFIG[source];
    return (
      <WordMatchGame
        source={source}
        focus={focus}
        title={title}
        subtitle={subtitle}
        notEnoughMessage={(have, need) => `You'll need at least ${need} ${label} words to play this — you have ${have} so far.`}
        homeHref="/progress/"
        homeLabel="← Progress"
      />
    );
  }

  return <WordMatchGame source={source} />;
}
