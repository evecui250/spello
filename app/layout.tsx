'use client';

import '../styles/globals.css';
import NavBar from '../components/NavBar';
import ForestBackground from '../components/ForestBackground';
import SyncGate from '../components/SyncGate';
import ChunkErrorRecovery from '../components/ChunkErrorRecovery';
import BugReportButton from '../components/BugReportButton';
import SpeechCleanup from '../components/SpeechCleanup';

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
      </head>
      <body className="min-h-screen text-emerald-50">
        <ChunkErrorRecovery />
        <SyncGate />
        <SpeechCleanup />
        <ForestBackground />
        <NavBar />
        <main className="max-w-2xl mx-auto px-4 py-6">
          {children}
        </main>
        <BugReportButton />
      </body>
    </html>
  );
}
