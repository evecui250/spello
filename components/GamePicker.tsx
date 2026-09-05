'use client';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onPick: (game: 'wortpaare' | 'artikel_blitz') => void;
}

const GAMES: { id: 'wortpaare' | 'artikel_blitz'; icon: string; title: string; desc: string }[] = [
  { id: 'wortpaare', icon: 'icon_game_wortpaare.png', title: 'Wortpaare', desc: 'Match German words to their meaning against the clock.' },
  { id: 'artikel_blitz', icon: 'icon_game_artikel_blitz.png', title: 'Artikel Blitz', desc: '60 seconds of der / die / das — as many nouns as you can.' },
];

// Sits in front of both games at every real entry point (DailySessionFlow's
// post-goal bonus round, and app/game/page.tsx's standalone default view)
// now that there are two of them -- picking one is just a callback, so the
// caller decides what "playing this game" actually renders.
export default function GamePicker({ onPick }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {GAMES.map(g => (
        <button
          key={g.id}
          type="button"
          onClick={() => onPick(g.id)}
          className="flex items-center gap-4 bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-4 text-left hover:bg-paper transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${BASE}/${g.icon}`} alt="" className="w-14 h-14 object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold text-ink">{g.title}</div>
            <div className="text-ink-soft text-sm">{g.desc}</div>
          </div>
          <span className="text-ink-soft text-xl shrink-0">›</span>
        </button>
      ))}
    </div>
  );
}
