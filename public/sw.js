// Minimal offline-support service worker for Spello, a static Next.js
// export served under the /spello/ basePath (see next.config.js). Strategy
// is deliberately conservative given hashed, per-build asset filenames:
//   - HTML documents (navigations): network-first, falling back to
//     whatever's cached (or the cached app shell) if the network is
//     unavailable -- a returning visitor with a flaky connection still
//     gets *a* working page, but anyone online always gets the latest
//     deploy's markup, which references that same build's own hashed JS/
//     CSS -- so there's never a mismatch between a stale HTML shell and
//     fresh assets, or vice versa.
//   - Hashed static assets (/_next/static/... under the basePath):
//     cache-first -- safe forever, since a new build ships new filenames
//     rather than overwriting old ones.
//   - Everything else (Supabase API calls, cross-origin requests, the
//     manifest, icons, audio files): passed straight through to the
//     network, never intercepted -- this app's real data always needs to
//     be live, and there's no reason to duplicate browser HTTP caching
//     for the rest.
const CACHE_NAME = 'spello-v1';
const BASE = '/spello';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase etc. -- never intercept.

  const isStaticAsset = url.pathname.startsWith(`${BASE}/_next/static/`);
  const isNavigation = request.mode === 'navigate';

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return res;
      }))
    );
    return;
  }

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(`${BASE}/`)))
    );
  }
});
