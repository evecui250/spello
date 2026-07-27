'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SYNCED_EVENT } from '../lib/sync';
import { getAiUsageStats, AiUsageStats } from '../lib/ai';

interface Props {
  // Called after remote data has been pulled and merged in, so the caller
  // can refresh anything it's already displaying (e.g. settings sliders).
  onSync?: () => void;
}

export default function AccountPanel({ onSync }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [inputEmail, setInputEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [aiStats, setAiStats] = useState<AiUsageStats | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    // The actual pull+merge runs once, globally (see SyncGate) — this just
    // refreshes whatever this page is already showing once that lands.
    const onSynced = () => onSync?.();
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener(SYNCED_EVENT, onSynced);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!email) { setAiStats(null); return; }
    getAiUsageStats().then(setAiStats);
  }, [email]);

  const handleSendLink = async () => {
    if (!inputEmail.trim()) return;
    setStatus('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email: inputEmail.trim(),
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
    });
    if (error) {
      console.error('Spello sign-in link failed:', error.message);
      setErrorMessage(error.message);
      setStatus('error');
    } else {
      setStatus('sent');
    }
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
          <div className="font-semibold text-stone-800">Signed in</div>
          <p className="text-stone-500 text-sm">{email} — progress syncs automatically.</p>
          {aiStats && aiStats.calls > 0 && (
            <p className="text-stone-400 text-xs mt-1">
              AI sentence corrections used: {aiStats.calls} ({(aiStats.inputTokens + aiStats.outputTokens).toLocaleString()} tokens)
            </p>
          )}
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
      <label className="block font-semibold text-stone-800 mb-1">Sync your progress (optional)</label>
      <p className="text-stone-500 text-sm mb-3">
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
            className="flex-1 border-2 border-indigo-400 rounded-lg px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-indigo-500"
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
        <p className="text-red-600 text-sm mt-2">
          Couldn't send the link{errorMessage ? `: ${errorMessage}` : ''} — try again in a bit.
        </p>
      )}
    </div>
  );
}
