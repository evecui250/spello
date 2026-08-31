'use client';

import { Fraunces, Karla, IBM_Plex_Mono } from 'next/font/google';
import '../styles/globals.css';
import NavBar from '../components/NavBar';
import StudyRoadmap from '../components/StudyRoadmap';
import AppBackground from '../components/AppBackground';
import SyncGate from '../components/SyncGate';
import ChunkErrorRecovery from '../components/ChunkErrorRecovery';
import SpeechCleanup from '../components/SpeechCleanup';
import PwaRegister from '../components/PwaRegister';
import UsagePing from '../components/UsagePing';
import FontScaleEffect from '../components/FontScaleEffect';

// Self-hosted at build time (next/font downloads once and serves from
// Spello's own static export, unlike a <link> to Google Fonts) — Fraunces
// is the warm serif used for headings/display moments, Karla the body
// sans, IBM Plex Mono reserved for small data-ish labels (counts,
// timers). Exposed as CSS variables here and consumed in globals.css,
// rather than each font's own className, so a single place (globals.css)
// controls exactly which elements get which face.
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', display: 'swap' });
const karla = Karla({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-karla', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-plex-mono', display: 'swap' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return (
    <html lang="de" className={`${fraunces.variable} ${karla.variable} ${plexMono.variable}`}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Spello</title>
        <meta name="description" content="Spello — a German vocabulary trainer for B2 learners" />
        <link rel="icon" href={`${base}/favicon-32.png`} sizes="32x32" />
        <link rel="icon" href={`${base}/favicon-16.png`} sizes="16x16" />
        <link rel="icon" href={`${base}/icon-512.png`} sizes="512x512" />
        <link rel="apple-touch-icon" href={`${base}/apple-touch-icon.png`} />
        {/* logo.webp is the Home page's hero illustration (Logo variant=
            "full") — preloaded so the browser starts fetching it during
            initial HTML parse instead of waiting for React to hydrate and
            render the <Image> that requests it, shaving a real chunk off
            how long it visibly takes to appear. Paired with resizing the
            file itself down to the resolution it's actually ever displayed
            at (140px wide) and converting to WebP — ~1.4MB originally,
            ~200KB after an earlier PNG resize, ~68KB now. */}
        <link rel="preload" as="image" href={`${base}/logo.webp`} />
        <link rel="manifest" href={`${base}/manifest.webmanifest`} />
        <meta name="theme-color" content="#0f3d3a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Spello" />
      </head>
      <body className="min-h-screen text-emerald-50">
        <ChunkErrorRecovery />
        <SyncGate />
        <SpeechCleanup />
        <PwaRegister />
        <UsagePing />
        <FontScaleEffect />
        <AppBackground />
        {/* Stacked in one shared fixed-to-bottom column, not two
            independently-fixed elements — StudyRoadmap renders nothing
            outside the practice page, so this is just NavBar alone
            everywhere else, but on the practice page the roadmap sits
            directly above it as one combined bottom bar instead of either
            overlapping the other or needing its own guessed-at height. */}
        <div className="fixed bottom-0 inset-x-0 z-20 flex flex-col">
          <StudyRoadmap />
          <NavBar />
        </div>
        {/* Bottom padding clears the fixed bottom bar(s) above (~72px
            NavBar + its own safe-area inset; see practice/page.tsx for the
            extra allowance it adds on top for StudyRoadmap) so the last
            bit of every page's content is never rendered underneath it. */}
        <main
          className="max-w-2xl mx-auto px-4 py-6"
          style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
