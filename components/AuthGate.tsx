'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import AccountPanel from './AccountPanel';
import Logo from './Logo';

// Sign-in is mandatory (not just for syncing progress across devices, but
// because the AI sentence-writing exercise needs a real user to attribute
// each OpenAI call to — see supabase/functions/correct-sentence). Blocks
// rendering of every route until a session exists; `loading` avoids a flash
// of the sign-in screen while the Supabase client is still rehydrating its
// session from storage on a fresh page load.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'signed-in' | 'signed-out'>('loading');

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? 'signed-in' : 'signed-out');
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (status === 'loading') return null;

  if (status === 'signed-out') {
    return (
      <div className="flex flex-col items-center gap-6 py-10 px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo variant="icon" size={64} className="ring-2 ring-white/20" />
          <h1 className="text-xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
            Welcome to Spello
          </h1>
          <p className="text-amber-100/80 text-sm max-w-sm">
            Sign in to continue — this keeps your progress safe across devices and unlocks the
            AI sentence-writing exercises.
          </p>
        </div>
        <div className="w-full max-w-sm bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6">
          <AccountPanel />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
