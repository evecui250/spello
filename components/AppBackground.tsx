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
  // Home's big "Start" button — a full CSS linear-gradient() string, same
  // hue family as the background but a couple of shades richer/deeper so
  // it still reads as a distinct, clickable object sitting ON the
  // background rather than blending into it. Dark enough at every stop
  // for the button's own light cream/amber text, same contrast reasoning
  // as the background needs for its overlaid header text.
  buttonGradient: string;
  // Progress page's "Words breakdown" bars — one color per mascot stage,
  // in order [puppy, short, medium, long-crowned]. Same muted/premium
  // progression style as Forest's original hand-picked bronze->sage->
  // moss->plum (never a bright primary-color Tailwind swatch, which read
  // as garish against the cream panel), just re-hued per theme so this
  // chart doesn't stay green-toned regardless of what background is active.
  stageColors: [string, string, string, string];
}

// Ordered darkest -> brightest (object key order = Settings' picker order,
// insertion order for string keys) — Stellar/Ocean/Ember are the deepest
// near-black skies, Forest/Lavender/Blossom/Sunset are mid-dark/moody, and
// Citrus/Meadow/Bubblegum are the deliberately vivid/bright trio at the end.
export const THEME_CONFIG: Record<Theme, ThemeConfig> = {
  stellar: {
    stageColors: ['#a89bd6', '#7b7ec2', '#5457a0', '#332f6b'],
    buttonGradient: 'linear-gradient(135deg, #8b7ec8 0%, #6a5aa8 50%, #443a78 100%)',
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
    stageColors: ['#8fc9c9', '#5fa8ad', '#3d7f8c', '#1f4d5c'],
    buttonGradient: 'linear-gradient(135deg, #4a9bab 0%, #327b8c 50%, #1d5266 100%)',
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
  ember: {
    stageColors: ['#d9a066', '#c17a3d', '#8a5423', '#4a2e14'],
    buttonGradient: 'linear-gradient(135deg, #c17a3d 0%, #a35a24 50%, #74390f 100%)',
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
  forest: {
    stageColors: ['#c9a86a', '#a3b18a', '#588157', '#5b3a5e'],
    buttonGradient: 'linear-gradient(135deg, #a9835e 0%, #8a6440 50%, #6b4a2c 100%)',
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
  lavender: {
    stageColors: ['#c9a8d6', '#a37eb8', '#7a5691', '#4a3060'],
    buttonGradient: 'linear-gradient(135deg, #9b7bb8 0%, #7a5a96 50%, #543a70 100%)',
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
  blossom: {
    stageColors: ['#e0a8bd', '#c97a97', '#9a4a72', '#5e2f4a'],
    buttonGradient: 'linear-gradient(135deg, #b5698c 0%, #96496e 50%, #6b3050 100%)',
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
  sunset: {
    stageColors: ['#e0a86a', '#d97b4a', '#b8542e', '#6b2e3a'],
    buttonGradient: 'linear-gradient(135deg, #d9773f 0%, #b8542a 50%, #832e14 100%)',
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
  // These three stay noticeably brighter/more vivid than the other 7
  // (which all lean dark/moody) — but not pastel-light. The app's header
  // text (e.g. Home's "spello" title/subtitle) is hardcoded light cream/
  // amber, relying on the background being darker than it — a truly pale
  // background would wash that text out. Kept saturated enough at every
  // stop to still read as "bright and cheerful" without breaking that.
  citrus: {
    stageColors: ['#ffd699', '#f2a35c', '#d9773f', '#8a3d1a'],
    buttonGradient: 'linear-gradient(135deg, #d9622a 0%, #b8431a 50%, #8a2f10 100%)',
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
    stageColors: ['#a8d6a0', '#7ab86a', '#4a8f45', '#2a5c30'],
    buttonGradient: 'linear-gradient(135deg, #4a9b5e 0%, #2f7a45 50%, #1d5c30 100%)',
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
  bubblegum: {
    stageColors: ['#f0a8d9', '#d975b8', '#b8489a', '#6e2a5c'],
    buttonGradient: 'linear-gradient(135deg, #d94fb0 0%, #b8318f 50%, #862368 100%)',
    gradient: 'from-[#ff8fd6] via-[#e85fc2] to-[#9c2f8a]',
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,255,255,0.24),transparent_65%)', className: '-top-6 left-[15%] w-3/5 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,214,245,0.18),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-pink-100/10',
    particleColor: 'bg-white',
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
