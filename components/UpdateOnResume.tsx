'use client';

import { useEffect } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? '';

// When the app comes back to the foreground, checks whether a newer
// version has been deployed since this page loaded, and if so reloads in
// place. Without this, the first tap after a deploy made Next.js fall back
// to a full page load of its own — to the URL WITHOUT its trailing slash
// (e.g. ".../spello" for Home), which the iOS app doesn't recognize as its
// own address (Capacitor only keeps URLs starting with server.url,
// ".../spello/"), so iOS opened it in Safari instead (a real report).
// Reloading the current URL ourselves always stays inside the app, and
// gets the learner the new version straight away. Progress and the daily
// session live in localStorage, so a reload loses nothing but an
// unsubmitted text field.
export default function UpdateOnResume() {
  useEffect(() => {
    if (!MY_BUILD) return;
    let checking = false;
    const check = async () => {
      if (document.visibilityState !== 'visible' || checking) return;
      checking = true;
      try {
        const res = await fetch(`${BASE}/?build-check=${Date.now()}`, { cache: 'no-store' });
        const html = await res.text();
        // Next embeds its build id in every page's flight data as "b":"<id>".
        const live = html.match(/\\"b\\":\\"([^"\\]+)/)?.[1] ?? html.match(/"b":"([^"]+)"/)?.[1];
        if (res.ok && live && live !== MY_BUILD) window.location.reload();
      } catch {
        // Offline or mid-deploy — try again next time.
      } finally {
        checking = false;
      }
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);
  return null;
}
