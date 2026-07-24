'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';

const links = [
  { href: '/', label: 'Home' },
  { href: '/words', label: 'Words' },
  { href: '/stats', label: 'Stats' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/settings', label: 'Settings' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="bg-black/15 backdrop-blur-md border-b border-white/10 sticky top-0 z-10">
      <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 overflow-x-auto">
        <Link href="/" className="flex items-center gap-2 py-2 shrink-0">
          <Logo size={26} />
          <span className="font-bold text-amber-100">Spello</span>
        </Link>
        <div className="flex gap-1">
          {links.map(l => {
            const active = pathname === l.href || (l.href !== '/' && pathname.startsWith(l.href));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-amber-300 text-amber-100'
                    : 'border-transparent text-emerald-100/60 hover:text-emerald-50'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
