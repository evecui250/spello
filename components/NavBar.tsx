'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Home' },
  { href: '/progress', label: 'Progress' },
  { href: '/words', label: 'Words' },
  { href: '/settings', label: 'Settings' },
];

// "New feature" dot on Progress, for the leaderboard that shipped after
// plenty of existing users already had the app installed — see
// app/progress/page.tsx, which sets this flag and dispatches this event
// the moment the page is actually visited. A plain localStorage flag +
// custom event (not lib/storage.ts's heavier per-level/synced machinery)
// since this is a purely local, one-time "have you SEEN this" nudge, not
// real progress data.
export const LEADERBOARD_SEEN_KEY = 'wb2_seen_leaderboard';
export const LEADERBOARD_SEEN_EVENT = 'wb2-leaderboard-seen';

export default function NavBar() {
  const pathname = usePathname();
  const [showNewDot, setShowNewDot] = useState(false);

  useEffect(() => {
    setShowNewDot(!localStorage.getItem(LEADERBOARD_SEEN_KEY));
    const onSeen = () => setShowNewDot(false);
    window.addEventListener(LEADERBOARD_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(LEADERBOARD_SEEN_EVENT, onSeen);
  }, []);

  return (
    // Sits at the bottom like a native app's tab bar, rather than a
    // website's top nav — the actual `fixed` positioning lives on the
    // shared wrapper in app/layout.tsx now (stacked with StudyRoadmap),
    // not here. See that file for the matching bottom padding on <main>
    // so content never renders underneath it. Active
    // state is just a lighter tint of the bar's own background (bg-
    // white/10) plus brighter text (text-on-bg, the same warm off-
    // white every page heading already uses) — no separate accent color,
    // so it reads as "part of this bar" rather than a foreign highlight.
    // pb-[env(safe-area-inset-bottom)] gives room for the home-indicator
    // area when installed standalone; a no-op everywhere else.
    <nav
      className="bg-black/25 backdrop-blur-md border-t border-white/10"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-2xl mx-auto flex items-stretch">
        {links.map(l => {
          const active = pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex-1 flex items-center justify-center py-5 text-sm font-semibold whitespace-nowrap transition-colors ${
                active ? 'bg-white/10 text-on-bg' : 'text-on-bg/55 hover:text-on-bg'
              }`}
            >
              <span className="relative inline-block">
                {l.label}
                {l.href === '/progress' && showNewDot && (
                  <span className="absolute -top-1 -right-2.5 w-2 h-2 rounded-full bg-gold shadow-[0_0_4px_rgba(232,199,106,0.9)]" />
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
