'use client';

import '../styles/globals.css';
import NavBar from '../components/NavBar';
import ForestBackground from '../components/ForestBackground';
import SyncGate from '../components/SyncGate';
import ChunkErrorRecovery from '../components/ChunkErrorRecovery';
import SpeechCleanup from '../components/SpeechCleanup';
import PwaRegister from '../components/PwaRegister';
import UsagePing from '../components/UsagePing';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Spello</title>
        <meta name="description" content="Spello — a German vocabulary trainer for B2 learners" />
        <link rel="icon" href={`${base}/favicon-32.png`} sizes="32x32" />
        <link rel="icon" href={`${base}/favicon-16.png`} sizes="16x16" />
        <link rel="icon" href={`${base}/icon-512.png`} sizes="512x512" />
        <link rel="apple-touch-icon" href={`${base}/apple-touch-icon.png`} />
        {/* logo.png is the Home page's hero illustration (Logo variant=
            "full") — preloaded so the browser starts fetching it during
            initial HTML parse instead of waiting for React to hydrate and
            render the <Image> that requests it, shaving a real chunk off
            how long it visibly takes to appear. Paired with resizing the
            file itself down from ~1.4MB to ~200KB (it was shipping at its
            full original resolution despite rendering at 140px wide). */}
        <link rel="preload" as="image" href={`${base}/logo.png`} />
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
        <ForestBackground />
        <NavBar />
        {/* Bottom padding clears the fixed bottom NavBar (~56px content +
            its own safe-area inset) so the last bit of every page's
            content is never rendered underneath it. */}
        <main
          className="max-w-2xl mx-auto px-4 py-6"
          style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
