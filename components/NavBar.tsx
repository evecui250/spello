'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BugReportButton from './BugReportButton';

const links = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/progress', label: 'Progress', icon: '📊' },
  { href: '/words', label: 'Words', icon: '📖' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    // Taller (py-2.5 with a stacked icon+label, vs the old single-line
    // py-3 text-only row) and a filled rounded-pill active state instead
    // of an underline — reads more like a native app's tab bar than a
    // website's nav links. pt-[env(safe-area-inset-top)] gives room for a
    // notch/status bar when installed standalone; a no-op everywhere else.
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
              className={`flex flex-col items-center gap-0.5 px-3 py-2.5 my-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-amber-300/20 text-amber-100'
                  : 'text-emerald-100/60 hover:text-emerald-50 hover:bg-white/5'
              }`}
            >
              <span className="text-lg leading-none">{l.icon}</span>
              {l.label}
            </Link>
          );
        })}
        <BugReportButton />
      </div>
    </nav>
  );
}
