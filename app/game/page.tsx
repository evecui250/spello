'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import WordMatchGame from '../../components/WordMatchGame';
import ArtikelBlitzGame from '../../components/ArtikelBlitzGame';
import GamePicker from '../../components/GamePicker';
import { MascotStageId } from '../../lib/storage';

// Standalone page for the game — no longer linked from Settings (owner
// call: the game should only be reachable after finishing today's goal,
// via DailySessionFlow's own post-congrats bonus round, source=daily_flow
// — see its own usage of WordMatchGame there). The actual game lives in
// WordMatchGame; this page is just its page-level chrome. Still reachable
// by a direct/bookmarked URL with no query string, which is what the
// settings_preview default below covers.
//
// ?source=rapid_review is Progress page's single top-of-page review button
// (no `focus` — draws from the WHOLE learned pool, mastered included, via
// WordMatchGame's own pickRoundWords slot-reservation, see that file). The
// four *_review sources (puppy/short/medium/mastered) predate it, each
// narrowing to one mascot stage; kept working for any old bookmark/link but
// no longer linked from Progress itself (a learner found reviewing just one
// stage at a time confusing). All five point their "← Home" fallback back
// at Progress instead of the app's actual Home, since that's where a
// learner reaching this URL actually came from.
type ReviewSource = 'rapid_review' | 'puppy_review' | 'short_review' | 'medium_review' | 'mastered_review';

const REVIEW_CONFIG: Record<ReviewSource, { focus?: MascotStageId; title: string; subtitle: string; label: string }> = {
  rapid_review: {
    title: 'Rapid Review',
    subtitle: 'A quick mixed refresher across everything you’ve learned so far.',
    label: 'learned',
  },
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
  const router = useRouter();
  // Which entry point sent the learner here -- see the game_plays
  // migration, which this tags every recorded play with. Plain
  // window.location (not Next's useSearchParams) specifically to avoid
  // the Suspense-boundary requirement that hook needs under
  // `output: 'export'` -- same reasoning as DailySessionFlow's own
  // previewSignInNudge param.
  const [source, setSource] = useState<'settings_preview' | 'daily_flow' | ReviewSource>('settings_preview');
  // Only relevant for the plain settings_preview entry (no ?source= at
  // all) -- every review source goes straight to Wortpaare, where a
  // picker makes no sense (Artikel Blitz has no stage-focus/mixed-review
  // concept).
  const [activeGame, setActiveGame] = useState<'picker' | 'wortpaare' | 'artikel_blitz'>('picker');

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
        // A real report: with no onQuit, the results screen's only way out
        // besides the big "Play again" pill was a small link scrolled away
        // in the fixed header at the very top of the page -- easy to miss,
        // easy to accidentally tap "Play again" instead. This gives the
        // results screen its own small, clearly-secondary "Finish" link
        // right next to "Play again", same hierarchy daily_flow's bonus
        // round already has (see WordMatchGame's 'over' phase).
        onQuit={() => router.push('/progress/')}
        quitLabel="Finish"
      />
    );
  }

  if (activeGame === 'picker') return <GamePicker onPick={setActiveGame} />;
  if (activeGame === 'artikel_blitz') return <ArtikelBlitzGame source={source as 'settings_preview' | 'daily_flow'} />;
  return <WordMatchGame source={source} />;
}
