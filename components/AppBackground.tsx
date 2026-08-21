'use client';

import { useEffect, useState } from 'react';
import { getTheme, Theme, THEME_CHANGED_EVENT } from '../lib/storage';

// The app's persistent backdrop — same structural idea across every theme
// (a soft gradient, one or two glow highlights, a drifting mist band, and
// a scattering of small twinkling/floating particles), just recolored and
// reshuffled per theme so each still reads as "the same app, a different
// sky" rather than a different product. Forest is the original/default;
// see Settings for the picker. THEME_CONFIG below is also what Settings'
// preview swatches read from, so a swatch always matches the real thing.
interface ThemeConfig {
  gradient: string; // Tailwind bg-gradient-to-b from/via/to classes
  glows: { style: string; className?: string }[]; // radial-gradient soft highlights
  mistColor: string; // the drifting mist band's own color
  particleColor: string; // dot fill
  particleGlow: string; // dot box-shadow (its glow halo)
  particleAnimation: 'animate-firefly' | 'animate-bubble-float';
}

export const THEME_CONFIG: Record<Theme, ThemeConfig> = {
  forest: {
    gradient: 'from-[#0f3d3a] via-[#155c4a] to-[#0c2e25]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,244,200,0.16),transparent_65%)', className: '-top-10 left-[10%] w-1/2 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(190,255,230,0.11),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-white/5',
    particleColor: 'bg-amber-200',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(252,211,77,0.7)]',
    particleAnimation: 'animate-firefly',
  },
  stellar: {
    gradient: 'from-[#0a0a2e] via-[#171344] to-[#050512]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(167,139,250,0.18),transparent_65%)', className: '-top-10 left-[8%] w-1/2 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(147,197,253,0.13),transparent_65%)', className: '-top-4 right-[8%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-indigo-100/5',
    particleColor: 'bg-slate-100',
    particleGlow: 'shadow-[0_0_6px_2px_rgba(226,232,255,0.8)]',
    particleAnimation: 'animate-firefly',
  },
  ocean: {
    gradient: 'from-[#062736] via-[#0b5266] to-[#031a24]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(165,243,252,0.16),transparent_65%)', className: '-top-10 left-[12%] w-1/2 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(110,231,183,0.10),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-cyan-100/5',
    particleColor: 'bg-cyan-100',
    particleGlow: 'shadow-[0_0_7px_2px_rgba(207,250,254,0.65)]',
    particleAnimation: 'animate-bubble-float',
  },
  lavender: {
    gradient: 'from-[#382a52] via-[#5b3f78] to-[#241a38]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(253,224,196,0.16),transparent_65%)', className: '-top-10 left-[10%] w-1/2 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(244,194,255,0.12),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-purple-100/5',
    particleColor: 'bg-pink-100',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(253,224,255,0.6)]',
    particleAnimation: 'animate-firefly',
  },
  sunset: {
    gradient: 'from-[#2b1750] via-[#c2542e] to-[#3a0e1a]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,214,153,0.22),transparent_65%)', className: '-top-6 left-[15%] w-3/5 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,150,180,0.14),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-orange-100/5',
    particleColor: 'bg-amber-100',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(255,214,153,0.7)]',
    particleAnimation: 'animate-firefly',
  },
  blossom: {
    gradient: 'from-[#4a1f3d] via-[#9a4a72] to-[#2e1228]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,214,231,0.20),transparent_65%)', className: '-top-10 left-[10%] w-1/2 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,196,168,0.12),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-pink-100/5',
    particleColor: 'bg-pink-50',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(255,228,240,0.7)]',
    particleAnimation: 'animate-bubble-float',
  },
  ember: {
    gradient: 'from-[#1f1410] via-[#7a3f1a] to-[#160d09]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,178,102,0.20),transparent_65%)', className: '-top-8 left-[12%] w-3/5 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,120,80,0.12),transparent_65%)', className: '-top-4 right-[8%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-orange-200/5',
    particleColor: 'bg-orange-200',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(255,170,102,0.75)]',
    particleAnimation: 'animate-bubble-float',
  },
  // These two stay noticeably brighter/more vivid than the other 7 (which
  // all lean dark/moody) — but not pastel-light. The app's header text
  // (e.g. Home's "spello" title/subtitle) is hardcoded light cream/amber,
  // relying on the background being darker than it — a truly pale
  // background would wash that text out. Kept saturated enough at every
  // stop to still read as "bright and cheerful" without breaking that.
  citrus: {
    gradient: 'from-[#ffb347] via-[#ff7043] to-[#b8390f]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,255,255,0.22),transparent_65%)', className: '-top-6 left-[15%] w-3/5 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,214,102,0.18),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-yellow-100/10',
    particleColor: 'bg-yellow-50',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(255,255,255,0.75)]',
    particleAnimation: 'animate-firefly',
  },
  meadow: {
    gradient: 'from-[#5ec8e8] via-[#8bd450] to-[#1f6b3a]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,255,255,0.22),transparent_65%)', className: '-top-6 left-[12%] w-3/5 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,244,168,0.16),transparent_65%)', className: '-top-4 right-[8%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-white/10',
    particleColor: 'bg-yellow-50',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(255,255,255,0.75)]',
    particleAnimation: 'animate-bubble-float',
  },
};

const PARTICLE_SPOTS = [
  { top: '9%', left: '8%', delay: 0 },
  { top: '18%', left: '85%', delay: 0.6 },
  { top: '42%', left: '14%', delay: 1.2 },
  { top: '12%', left: '48%', delay: 1.8 },
  { top: '58%', left: '90%', delay: 0.3 },
  { top: '33%', left: '4%', delay: 2.1 },
  { top: '7%', left: '68%', delay: 1.5 },
  { top: '70%', left: '28%', delay: 0.9 },
  { top: '50%', left: '58%', delay: 1.7 },
  { top: '25%', left: '35%', delay: 2.4 },
];

export default function AppBackground() {
  // Starts as 'forest' (the pre-hydration default) and corrects itself
  // right after mount — same "read the real localStorage value in an
  // effect, not during the initial render" pattern used throughout this
  // app to avoid a static-export/client hydration mismatch. A one-frame
  // flash to the real theme on load is a fair trade for that.
  const [theme, setTheme] = useState<Theme>('forest');

  useEffect(() => {
    const load = () => setTheme(getTheme());
    load();
    window.addEventListener(THEME_CHANGED_EVENT, load);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, load);
  }, []);

  const cfg = THEME_CONFIG[theme];

  return (
    <div aria-hidden className={`fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b ${cfg.gradient}`}>
      {cfg.glows.map((g, i) => (
        <div key={i} className={`absolute ${g.className}`} style={{ backgroundImage: g.style.replace(/_/g, ' ') }} />
      ))}
      <div className={`animate-mist absolute top-1/3 left-0 w-[130%] h-32 ${cfg.mistColor} blur-2xl rounded-full`} />
      {PARTICLE_SPOTS.map((f, i) => (
        <span
          key={i}
          className={`${cfg.particleAnimation} absolute w-1.5 h-1.5 rounded-full ${cfg.particleColor} ${cfg.particleGlow}`}
          style={{ top: f.top, left: f.left, animationDelay: `${f.delay}s` }}
        />
      ))}
    </div>
  );
}
