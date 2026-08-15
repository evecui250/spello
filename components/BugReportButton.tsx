'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
        className="ml-auto shrink-0 text-xl leading-none px-3 py-2.5 rounded-xl text-emerald-100/60 hover:text-emerald-50 hover:bg-white/5 transition-colors"
      >
        🦴
      </button>

      {/* Portaled straight to <body> rather than rendered in place: this
          button lives inside NavBar, which has backdrop-blur-md — and
          backdrop-filter (like transform/filter) creates a new containing
          block for position:fixed descendants per spec, so a fixed modal
          left in place here would size/center itself against NavBar's own
          small box instead of the true viewport (it did — that's the
          "clipped near the top" bug this fixes). Escaping to body sidesteps
          that regardless of whatever styling NavBar or any other ancestor
          ends up with in the future. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-amber-50 rounded-2xl shadow-xl p-5 flex flex-col gap-3"
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
                {/* No autoFocus here on purpose: it used to pop the on-
                    screen keyboard open the instant the modal appeared,
                    which on iOS shrinks the visual viewport before this
                    fixed-position overlay finishes laying out — the modal
                    would render clipped near the top of the screen. Letting
                    the user tap the textarea themselves keeps layout and
                    keyboard-open as two separate, sequential events. */}
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={4}
                  placeholder="What happened?"
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
        </div>,
        document.body,
      )}
    </>
  );
}
