'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BugReportButton from './BugReportButton';

const links = [
  { href: '/', label: 'Home' },
  { href: '/progress', label: 'Progress' },
  { href: '/words', label: 'Words' },
  { href: '/settings', label: 'Settings' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    // Text only, no icons — a filled rounded-pill active state (a modern
    // segmented-control look, still taller than the old underline-border
    // version) reads as "app tab bar" on its own, without needing emoji to
    // get there. pt-[env(safe-area-inset-top)] gives room for a notch/
    // status bar when installed standalone; a no-op everywhere else.
    <nav
      className="bg-black/15 backdrop-blur-md border-b border-white/10 sticky top-0 z-10"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="max-w-2xl mx-auto flex items-center gap-1 px-2 overflow-x-auto">
        {links.map(l => {
          const active = pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href));
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`px-4 py-2.5 my-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                active
                  ? 'bg-amber-300/90 text-emerald-950'
                  : 'text-emerald-100/60 hover:text-emerald-50 hover:bg-white/5'
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        <BugReportButton />
      </div>
    </nav>
  );
}
