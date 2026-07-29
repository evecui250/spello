'use client';

import { useEffect } from 'react';

// Every deploy renames the hashed chunk files under _next/static/chunks —
// a tab left open across a deploy (very likely here, since this ships
// several times a day some days) can still be holding the OLD entry
// bundle, and the moment it tries to lazy-load a route it hasn't visited
// yet, that reference 404s. Next/webpack doesn't recover from that on its
// own — it surfaces as a generic crash (often "Cannot read properties of
// undefined") with no obvious cause in the console beyond the 404 itself.
// A stale tab can't fix itself by re-fetching a script tag it already
// has a (now-wrong) URL for, so the only real fix is a full reload to pick
// up the current entry bundle — done at most once per tab (via the
// sessionStorage guard) so a genuine, persistent load failure doesn't loop.
const RELOAD_GUARD_KEY = 'wb2_chunk_error_reloaded';

function isChunkLoadFailure(message: string): boolean {
  return /loading chunk|failed to fetch dynamically imported module|importing a module script failed/i.test(message);
}

export default function ChunkErrorRecovery() {
  useEffect(() => {
    const tryRecover = () => {
      if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
      window.location.reload();
    };

    const onResourceError = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLScriptElement && target.src.includes('/_next/static/')) {
        tryRecover();
      }
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadFailure(e.message ?? '')) tryRecover();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const message = e.reason?.message ?? String(e.reason ?? '');
      if (isChunkLoadFailure(message)) tryRecover();
    };

    // Resource load errors (a 404'd <script src>) don't bubble, so this
    // listener has to be registered on the capturing phase.
    window.addEventListener('error', onResourceError, true);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onResourceError, true);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
