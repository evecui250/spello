'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// A small icon button in the top-right of NavBar, visible on every page —
// lets a learner report a problem the instant they hit one, without
// navigating away or losing whatever they were mid-way through (the modal
// is just an overlay; the page underneath is untouched). Works whether
// signed in or not, same as everything else now that sign-in is entirely
// optional (see AuthGate's removal) — see the bug_reports migration for the
// insert-only RLS policy backing this.
export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async () => {
    if (!message.trim() || status === 'sending') return;
    setStatus('sending');
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase.from('bug_reports').insert({
      user_id: session?.user.id ?? null,
      email: signedInEmail ?? (email.trim() || null),
      message: message.trim(),
      page_path: window.location.pathname,
      user_agent: navigator.userAgent,
    });
    if (error) {
      console.error('Bug report failed:', error.message);
      setStatus('error');
      return;
    }
    setStatus('sent');
    setTimeout(() => {
      setOpen(false);
      setStatus('idle');
      setMessage('');
      setEmail('');
    }, 1500);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a bug or problem"
        className="ml-auto shrink-0 text-lg leading-none px-2 py-3 text-emerald-100/60 hover:text-emerald-50 transition-colors"
      >
        🦴
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-amber-50 rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-stone-800">Report a problem</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-stone-400 hover:text-stone-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            {status === 'sent' ? (
              <p className="text-green-700 text-sm bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                ✓ Thanks — we&apos;ll take a look.
              </p>
            ) : (
              <>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={4}
                  placeholder="What happened?"
                  autoFocus
                  className="w-full border-2 border-indigo-100 rounded-xl px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-indigo-300 resize-none"
                />
                {!signedInEmail && (
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Your email (optional, if you'd like a reply)"
                    className="w-full border-2 border-indigo-100 rounded-lg px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-indigo-300 text-sm"
                  />
                )}
                {status === 'error' && (
                  <p className="text-red-600 text-sm">Couldn&apos;t send that — check your connection and try again.</p>
                )}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!message.trim() || status === 'sending'}
                  className="w-full bg-indigo-600 text-white py-2.5 rounded-xl font-semibold disabled:opacity-40 hover:bg-indigo-700 active:scale-95 transition-all"
                >
                  {status === 'sending' ? 'Sending…' : 'Send report'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
