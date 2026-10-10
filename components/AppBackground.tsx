'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { THEME_GRADIENTS } from '../lib/themeGradients';
import { getTheme, Theme, THEME_CHANGED_EVENT, getCardMode, CardMode, CARD_MODE_CHANGED_EVENT, resolveCardMode } from '../lib/storage';

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
  // Night card-mode's dusked version of `gradient` — only set for
  // Citrus/Meadow/Bubblegum/Vanilla, the deliberately BRIGHT trio (plus
  // Vanilla). The other 6 themes are already dark/moody, so a dark card
  // floating on them at night already reads as one coherent scene;
  // undefined here means AppBackground just keeps using `gradient`
  // as-is. Same hue family as the day version, just late in the day, so
  // switching Day->Night still feels like nightfall on the sky you
  // picked rather than a jump to an unrelated theme.
  gradientNight?: string;
}

// Ordered darkest -> brightest (object key order = Settings' picker order,
// insertion order for string keys) — Stellar/Ocean/Ember are the deepest
// near-black skies, Forest/Lavender/Blossom/Sunset are mid-dark/moody, and
// Citrus/Meadow/Bubblegum are the deliberately vivid/bright trio at the end.
export const THEME_CONFIG: Record<Theme, ThemeConfig> = {
  stellar: {
    stageColors: ['#a89bd6', '#7b7ec2', '#5457a0', '#332f6b'],
    buttonGradient: 'linear-gradient(135deg, #8b7ec8 0%, #6a5aa8 50%, #443a78 100%)',
    gradient: THEME_GRADIENTS.stellar.day,
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
    gradient: THEME_GRADIENTS.ocean.day,
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
    gradient: THEME_GRADIENTS.ember.day,
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
    gradient: THEME_GRADIENTS.forest.day,
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
    gradient: THEME_GRADIENTS.lavender.day,
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
    stageColors: ['#e0a86a', '#d97b4a', '#b8542e', '#6b2e3a'],
    buttonGradient: 'linear-gradient(135deg, #d9773f 0%, #b8542a 50%, #832e14 100%)',
    gradient: THEME_GRADIENTS.sunset.day,
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
    gradient: THEME_GRADIENTS.citrus.day,
    gradientNight: THEME_GRADIENTS.citrus.night,
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
    gradient: THEME_GRADIENTS.meadow.day,
    gradientNight: THEME_GRADIENTS.meadow.night,
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
    gradient: THEME_GRADIENTS.bubblegum.day,
    gradientNight: THEME_GRADIENTS.bubblegum.night,
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,255,255,0.24),transparent_65%)', className: '-top-6 left-[15%] w-3/5 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,214,245,0.18),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-pink-100/10',
    particleColor: 'bg-white',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(255,255,255,0.75)]',
    particleAnimation: 'animate-bubble-float',
  },
  // The palest of the 10 (replaces the old "blossom", which read too
  // close to Lavender/Sunset) — a warm vanilla-custard gradient rather
  // than literal white/eggshell, since the app's header text (e.g. Home's
  // subtitle) is hardcoded light cream and needs a background darker than
  // itself somewhere in the mix to stay legible.
  vanilla: {
    stageColors: ['#f5e6b8', '#e0c078', '#c19648', '#8a6a2e'],
    buttonGradient: 'linear-gradient(135deg, #d9a860 0%, #b8823a 50%, #8a5f22 100%)',
    gradient: THEME_GRADIENTS.vanilla.day,
    gradientNight: THEME_GRADIENTS.vanilla.night,
    glows: [
      { style: 'radial-gradient(ellipse_at_top,rgba(255,255,255,0.18),transparent_65%)', className: '-top-6 left-[15%] w-3/5 h-2/3' },
      { style: 'radial-gradient(ellipse_at_top,rgba(255,244,214,0.12),transparent_65%)', className: '-top-4 right-[5%] w-2/5 h-1/2' },
    ],
    mistColor: 'bg-white/10',
    particleColor: 'bg-white',
    particleGlow: 'shadow-[0_0_8px_3px_rgba(255,255,255,0.8)]',
    particleAnimation: 'animate-firefly',
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
  // False until the effects below have read the real theme/card mode. Until
  // then this layer stays invisible and layout.tsx's early paint (already
  // the saved theme's colors) is what shows — so the default theme never
  // flashes up first. Set by the last effect, so it lands in the same
  // render as the real theme.
  const [ready, setReady] = useState(false);
  // Same pre-hydration-default reasoning as theme above — the card
  // surfaces this drives (see globals.css's [data-card-mode="dark"])
  // aren't wired into any component yet, but the sky itself (this
  // component) already reacts, per real feedback that a still-fully-
  // bright sky under a dimmed card looked mismatched.
  const [cardMode, setCardMode] = useState<CardMode>('auto');
  // The actual light/dark value in effect right now — equal to cardMode
  // unless it's 'auto', in which case this is resolveCardMode's read of
  // the device's own clock. Kept as separate state (not just computed
  // inline on every render) so the interval below can force a re-render
  // the moment auto's answer changes, without needing cardMode itself to
  // change.
  const [resolvedCardMode, setResolvedCardMode] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const load = () => setTheme(getTheme());
    load();
    window.addEventListener(THEME_CHANGED_EVENT, load);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, load);
  }, []);

  useEffect(() => {
    const load = () => setCardMode(getCardMode());
    load();
    window.addEventListener(CARD_MODE_CHANGED_EVENT, load);
    return () => window.removeEventListener(CARD_MODE_CHANGED_EVENT, load);
  }, []);

  // Re-resolves immediately on every cardMode change, then — only while
  // 'auto' is actually selected — keeps re-checking once a minute so a
  // session left open across the morning/evening cutoff still flips on
  // its own instead of waiting for a manual toggle or a reload.
  useEffect(() => {
    const resolve = () => setResolvedCardMode(resolveCardMode(cardMode));
    resolve();
    if (cardMode !== 'auto') return;
    const interval = setInterval(resolve, 60_000);
    return () => clearInterval(interval);
  }, [cardMode]);

  // Mirrors both onto <html> as data attributes so plain CSS (globals.css)
  // can theme every future card via [data-app-theme]/[data-card-mode]
  // selectors without threading theme/cardMode through every component —
  // 'forest'/'light' are the unmarked defaults (matching getTheme()'s own
  // "forest is the default" and resolveCardMode's own light/dark values),
  // so those two specifically clear the attribute instead of setting it.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'forest') root.removeAttribute('data-app-theme');
    else root.setAttribute('data-app-theme', theme);
  }, [theme]);
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedCardMode === 'light') root.removeAttribute('data-card-mode');
    else root.setAttribute('data-card-mode', resolvedCardMode);
  }, [resolvedCardMode]);

  const cfg = THEME_CONFIG[theme];
  const gradient = resolvedCardMode === 'dark' && cfg.gradientNight ? cfg.gradientNight : cfg.gradient;

  useEffect(() => setReady(true), []);

  // The page is drawn edge to edge, under the iPhone's status bar (see
  // capacitor.config.ts's contentInset and layout.tsx's viewport-fit) —
  // so that strip shows this theme instead of a separate black/white band.
  // Two things follow the theme's top color: the root background (what
  // shows in any gap before this fixed layer paints) and, in the native
  // app, whether the clock/battery text is light or dark — white text on
  // the light themes (Citrus, Meadow, Bubblegum, Vanilla) would be
  // unreadable.
  useEffect(() => {
    if (!ready) return; // don't overwrite the early paint with the default theme
    const hexes = gradient.match(/#[0-9a-fA-F]{6}/g) ?? ['#0f3d3a'];
    const top = hexes[0];
    // Same paint layout.tsx's early script put on <html> before startup —
    // kept in step with theme changes made afterwards.
    document.documentElement.style.backgroundColor = top;
    document.documentElement.style.backgroundImage = `linear-gradient(to bottom,${hexes.join(',')})`;
    // --surface: a solid card color in this theme's own hue (its middle
    // color, darkened) — Home's main card uses it instead of grey glass.
    document.documentElement.style.setProperty('--surface', `color-mix(in srgb, ${hexes[1] ?? top} 62%, #000)`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', top);
    if (!Capacitor.isNativePlatform()) return;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(top.slice(i, i + 2), 16) / 255);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Style.Dark = light text (for a dark background), Style.Light = dark text.
    StatusBar.setStyle({ style: luminance > 0.55 ? Style.Light : Style.Dark }).catch(() => {});
  }, [gradient, ready]);

  return (
    <div aria-hidden className={`fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b ${gradient} transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`}>
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
