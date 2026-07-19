'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { pullAndMerge } from '../lib/sync';

interface Props {
  // Called after remote data has been pulled and merged in, so the caller
  // can refresh anything it's already displaying (e.g. settings sliders).
  onSync?: () => void;
}

export default function AccountPanel({ onSync }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [inputEmail, setInputEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setEmail(session?.user.email ?? null);
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        pullAndMerge(session.user.id).then(() => onSync?.());
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSendLink = async () => {
    if (!inputEmail.trim()) return;
    setStatus('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: inputEmail.trim(),
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
    });
    setStatus(error ? 'error' : 'sent');
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setStatus('idle');
    setInputEmail('');
  };

  if (email) {
    return (
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-slate-700">Signed in</div>
          <p className="text-slate-400 text-sm">{email} — progress syncs automatically.</p>
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm font-semibold text-red-600 hover:text-red-800 transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="block font-semibold text-slate-700 mb-1">Sync your progress (optional)</label>
      <p className="text-slate-400 text-sm mb-3">
        Sign in with a magic link to keep your progress across devices. Not required to use the app.
      </p>
      {status === 'sent' ? (
        <p className="text-green-700 text-sm bg-green-50 border border-green-100 rounded-lg px-3 py-2">
          ✓ Check {inputEmail} for a sign-in link.
        </p>
      ) : (
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="you@example.com"
            value={inputEmail}
            onChange={e => setInputEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendLink()}
            className="flex-1 border-2 border-indigo-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleSendLink}
            disabled={!inputEmail.trim() || status === 'sending'}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
          >
            {status === 'sending' ? 'Sending…' : 'Send link'}
          </button>
        </div>
      )}
      {status === 'error' && (
        <p className="text-red-600 text-sm mt-2">Something went wrong sending the link — try again.</p>
      )}
    </div>
  );
}
