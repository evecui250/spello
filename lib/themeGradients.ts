// Each theme's sky gradient (Tailwind from/via/to classes): `day`, plus
// `night` for the themes that dusk in dark card mode. Its own plain module
// (not inside the 'use client' AppBackground) so app/layout.tsx can also
// read it at build time, to paint the saved theme's colors before the app
// has even started — see layout.tsx's early paint script.
import type { Theme } from './storage';

export const THEME_GRADIENTS: Record<Theme, { day: string; night?: string }> = {
  stellar: { day: 'from-[#0a0a2e] via-[#171344] to-[#050512]' },
  ocean: { day: 'from-[#062736] via-[#0b5266] to-[#031a24]' },
  ember: { day: 'from-[#1f1410] via-[#7a3f1a] to-[#160d09]' },
  forest: { day: 'from-[#0f3d3a] via-[#155c4a] to-[#0c2e25]' },
  lavender: { day: 'from-[#382a52] via-[#5b3f78] to-[#241a38]' },
  sunset: { day: 'from-[#2b1750] via-[#c2542e] to-[#3a0e1a]' },
  citrus: { day: 'from-[#ffb347] via-[#ff7043] to-[#b8390f]', night: 'from-[#7A4A1F] to-[#3D1608]' },
  meadow: { day: 'from-[#5ec8e8] via-[#8bd450] to-[#1f6b3a]', night: 'from-[#1F3D4A] to-[#12331D]' },
  bubblegum: { day: 'from-[#ff8fd6] via-[#e85fc2] to-[#9c2f8a]', night: 'from-[#5C2F52] to-[#331C30]' },
  vanilla: { day: 'from-[#f2d38a] via-[#e8b855] to-[#c48f3a]', night: 'from-[#4A3A1F] to-[#2E2010]' },
};

// Hex colors in a gradient's classes, top to bottom.
export function gradientHexes(gradient: string): string[] {
  return gradient.match(/#[0-9a-fA-F]{6}/g) ?? [];
}
