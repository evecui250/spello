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

// Purely a UI throttle so a tester can't spam the button faster than the
// email actually arrives — Supabase/Resend enforce their own real rate
// limit server-side regardless (see handleSendLink's error path below).
const RESEND_COOLDOWN_SECONDS = 60;

export default function AccountPanel({ onSync }: Props) {
  const [email, setEmail] = useState<string | null>(null);
  const [inputEmail, setInputEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [aiStats, setAiStats] = useState<AiUsageStats | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

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

  // Ticks the resend cooldown down to 0 once a second while it's active.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleSendLink = async () => {
    if (!inputEmail.trim() || resendCooldown > 0) return;
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
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
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
          <div className="font-semibold text-ink">Signed in</div>
          <p className="text-ink-soft text-sm">{email} — progress syncs automatically.</p>
          {aiStats && aiStats.calls > 0 && (
            <p className="text-ink-soft text-xs mt-1">
              AI sentence corrections used: {aiStats.calls} ({(aiStats.inputTokens + aiStats.outputTokens).toLocaleString()} tokens)
            </p>
          )}
        </div>
        <button
          onClick={handleSignOut}
          className="text-sm font-semibold text-clay/75 hover:text-clay transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <label className="block font-semibold text-ink mb-1">Sign in</label>
      <p className="text-ink-soft text-sm mb-3">
        Sign in with a magic link — this keeps your progress synced across devices and unlocks
        the AI sentence-writing exercises.
      </p>
      {status === 'sent' ? (
        <div className="bg-good/25 border border-good rounded-lg px-3 py-2 flex flex-col gap-1.5">
          <p className="text-good-deep text-sm">✓ Check {inputEmail} for a sign-in link.</p>
          <p className="text-ink-soft text-xs">
            Don&apos;t see it? Check your spam/junk folder — it can take a minute to arrive.
          </p>
          <button
            onClick={handleSendLink}
            disabled={resendCooldown > 0}
            className="self-start text-xs font-semibold text-label hover:text-ink disabled:text-ink-soft disabled:cursor-default transition-colors"
          >
            {resendCooldown > 0 ? `Resend link (${resendCooldown}s)` : 'Resend link'}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="you@example.com"
            value={inputEmail}
            onChange={e => setInputEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendLink()}
            className="flex-1 border-2 border-accent/70 rounded-lg px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSendLink}
            disabled={!inputEmail.trim() || status === 'sending'}
            className="bg-accent text-white px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all"
          >
            {status === 'sending' ? 'Sending…' : 'Send link'}
          </button>
        </div>
      )}
      {status === 'error' && (
        <p className="text-clay text-sm mt-2">
          Couldn't send the link{errorMessage ? `: ${errorMessage}` : ''} — try again in a bit.
        </p>
      )}
    </div>
  );
}
