'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import { hasSkippedSignIn, markSkippedSignIn } from '../lib/storage';
import AccountPanel from './AccountPanel';
import Logo from './Logo';

// Privacy Policy/Terms have to be readable before someone creates an
// account, not only after — exempted from the gate below.
const PUBLIC_PATHS = ['/privacy', '/terms'];

// Sign-in unlocks cross-device sync and the AI translate exercise (see
// supabase/functions/correct-sentence, which needs a real user to attribute
// each OpenAI call to) — but isn't strictly required, since some users hit
// real trouble with the magic-link email. Skipping is a persistent choice
// (see hasSkippedSignIn) so it's only ever asked once; signing in later from
// Settings works the same as if they'd never skipped. `loading` avoids a
// flash of the sign-in screen while the Supabase client is still
// rehydrating its session from storage on a fresh page load.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'signed-in' | 'signed-out'>('loading');
  const [skipped, setSkipped] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setSkipped(hasSkippedSignIn());
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? 'signed-in' : 'signed-out');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (PUBLIC_PATHS.some(p => pathname?.startsWith(p))) return <>{children}</>;

  if (status === 'loading') return null;

  if (status === 'signed-out' && !skipped) {
    return (
      <div className="flex flex-col items-center gap-6 py-10 px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo variant="icon" size={64} className="ring-2 ring-white/20" />
          <h1 className="text-xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
            Welcome to Spello
          </h1>
          <p className="text-amber-100/80 text-sm max-w-sm">
            Sign in to keep your progress safe across devices and unlock the AI sentence
            exercises.
          </p>
        </div>
        <div className="w-full max-w-sm bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6">
          <AccountPanel />
        </div>
        <button
          onClick={() => { markSkippedSignIn(); setSkipped(true); }}
          className="text-amber-100/70 text-sm underline hover:text-amber-100/90"
        >
          Having trouble signing in? Skip for now
        </button>
        <p className="text-amber-100/60 text-xs text-center max-w-sm">
          By continuing, you agree to the{' '}
          <Link href="/terms" className="underline hover:text-amber-100/90">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:text-amber-100/90">Privacy Policy</Link>.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
