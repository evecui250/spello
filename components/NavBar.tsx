'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Simple 24px line icons, one per tab — a native-style tab bar (icon over
// label) instead of text alone, which read as small and hard to hit.
const ICON_PATHS: Record<string, string> = {
  '/': 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  '/progress': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  '/words': 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7M8 11h5',
  '/settings': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
};

const links = [
  { href: '/', label: 'Home' },
  { href: '/progress', label: 'Progress' },
  { href: '/words', label: 'Words' },
  { href: '/settings', label: 'Profile' },
];

export default function NavBar() {
  const pathname = usePathname();

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
      className="bg-black/25 backdrop-blur-md border-t border-white/5"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="max-w-2xl mx-auto flex items-stretch">
        {links.map(l => {
          const active = pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex-1 flex flex-col items-center justify-center gap-1 pt-3 pb-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                active ? 'text-on-bg' : 'text-on-bg/45 hover:text-on-bg/80'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={ICON_PATHS[l.href]} />
              </svg>
              <span>{l.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
