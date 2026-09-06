'use client';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onPick: (game: 'wortpaare' | 'artikel_blitz') => void;
  // Only shown when provided -- DailySessionFlow's post-goal bonus round
  // passes finishForToday here (a learner who doesn't want to play should
  // be able to say so right on this screen, not only after starting a
  // game and quitting it); app/game/page.tsx's standalone entry point has
  // no "day" to finish, so it omits this and gets no skip link at all.
  onSkip?: () => void | Promise<void>;
}

// Keep this in sync with each game's own GAME_DURATION constant
// (ArtikelBlitzGame.tsx / WordMatchGame.tsx) -- purely a display label, not
// read from either component, so a future change to one won't automatically
// update the other.
const GAMES: { id: 'wortpaare' | 'artikel_blitz'; icon: string; title: string; desc: string; seconds: number }[] = [
  { id: 'wortpaare', icon: 'icon_game_wortpaare.png', title: 'Wortpaare', desc: 'Match German words to their meaning against the clock.', seconds: 45 },
  { id: 'artikel_blitz', icon: 'icon_game_artikel_blitz.png', title: 'Artikel Blitz', desc: 'der / die / das — as many nouns as you can.', seconds: 45 },
];

// Sits in front of both games at every real entry point (DailySessionFlow's
// post-goal bonus round, and app/game/page.tsx's standalone default view)
// now that there are two of them -- picking one is just a callback, so the
// caller decides what "playing this game" actually renders. Vertically
// centered in the same fixed content area every other round/game screen
// uses (min-h-[calc(100dvh-11rem)] — see MatchingQuizPage/WordMatchGame's
// own centering) rather than sitting pinned to the top of mostly-empty
// space.
export default function GamePicker({ onPick, onSkip }: Props) {
  return (
    <div className="flex flex-col justify-center min-h-[calc(100dvh-11rem)] gap-6">
      <h1 className="text-2xl font-bold text-on-bg text-center" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
        Want a bonus round?
      </h1>

      <div className="flex flex-col gap-4">
        {GAMES.map(g => (
          <button
            key={g.id}
            type="button"
            onClick={() => onPick(g.id)}
            className="relative flex items-center gap-4 bg-paper/90 backdrop-blur-sm rounded-2xl border-2 border-paper-line shadow-sm p-4 text-left hover:-translate-y-0.5 hover:shadow-md hover:border-accent/60 active:translate-y-0 active:scale-[0.98] transition-all"
          >
            <span className="absolute -top-2 right-4 bg-accent text-white text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full shadow-sm">
              {g.seconds}s
            </span>
            <span className="w-16 h-16 rounded-xl bg-paper-dim flex items-center justify-center shrink-0 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${BASE}/${g.icon}`} alt="" className="w-full h-full object-contain" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-ink text-base">{g.title}</span>
              <span className="block text-ink-soft text-xs leading-snug mt-0.5">{g.desc}</span>
            </span>
            <span className="shrink-0 w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-lg">
              ›
            </span>
          </button>
        ))}
      </div>

      {onSkip && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onSkip}
            className="text-on-bg/80 hover:text-on-bg text-sm font-semibold underline"
          >
            Skip · finish for today
          </button>
        </div>
      )}
    </div>
  );
}
