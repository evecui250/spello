'use client';

import { useEffect } from 'react';

// Registers public/sw.js, scoped to the app's own basePath, so returning
// visitors get an installable, offline-tolerant PWA (see manifest.webmanifest
// for the install metadata). Silently no-ops in browsers without
// serviceWorker support (e.g. some in-app webviews) and during local `next
// dev`-over-http, where registration would fail anyway -- this is a
// progressive enhancement, never load-bearing for the app to function.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
      // Best-effort -- a failed registration (unsupported browser, http in
      // dev, etc.) shouldn't be surfaced to the user in any way.
    });
  }, []);
  return null;
}
