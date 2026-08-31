'use client';

import { useEffect, useState } from 'react';
import { getSoundChoice, saveSoundChoice, SoundChoice } from '../lib/storage';
import { CHIME_OPTIONS, playChime } from '../lib/sound';

interface Props {
  // Optional -- lets a parent (e.g. Settings' collapsed Appearance
  // summary line) stay in sync with the pick without owning the
  // selection state itself.
  onChange?: (id: SoundChoice) => void;
}

// Tapping a row both previews it (immediate playChime) and selects it —
// no separate "preview" vs "confirm" step, since a chime is short enough
// that hearing it IS trying it out, the same way tapping a Theme swatch
// both shows and picks a color.
export default function SoundPicker({ onChange }: Props) {
  const [choice, setChoice] = useState<SoundChoice>('triad-bloom');
  useEffect(() => setChoice(getSoundChoice()), []);

  const pick = (id: SoundChoice) => {
    setChoice(id);
    saveSoundChoice(id);
    playChime(id);
    onChange?.(id);
  };

  return (
    <div className="flex flex-col gap-2">
      {CHIME_OPTIONS.map(opt => {
        const isSelected = choice === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => pick(opt.id)}
            className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl border-2 transition-colors text-left ${
              isSelected ? 'border-accent bg-accent/10' : 'border-paper-line hover:border-accent/50'
            }`}
          >
            <span className={`text-sm font-medium ${isSelected ? 'text-label' : 'text-ink'}`}>{opt.name}</span>
            <span className={`text-xs ${isSelected ? 'text-label' : 'text-ink-soft'}`}>{isSelected ? '✓ Selected' : '▶ Preview'}</span>
          </button>
        );
      })}
    </div>
  );
}
