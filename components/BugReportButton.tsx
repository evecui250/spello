'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';

// A text link on the Settings page (next to Terms of Service/Privacy
// Policy) — lets a learner report a problem without navigating away or
// losing whatever they were mid-way through (the modal is just an
// overlay; the page underneath is untouched). Works whether signed in or
// not, same as everything else now that sign-in is entirely optional (see
// AuthGate's removal) — see the bug_reports migration for the insert-only
// RLS policy backing this.
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
        className="text-on-bg/75 hover:text-on-bg underline"
      >
        Report a problem
      </button>

      {/* Portaled straight to <body>, same reasoning as ShareCard's modal:
          any ancestor with backdrop-filter/transform/etc. becomes the
          containing block for a plain in-place fixed overlay, which once
          clipped this exact modal against a small container instead of
          the true viewport. Escaping to body sidesteps that regardless of
          whatever styling this button ends up wrapped in. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink">Report a problem</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-ink-soft hover:text-ink text-xl leading-none"
              >
                ×
              </button>
            </div>

            {status === 'sent' ? (
              <p className="text-good-deep text-sm bg-good/25 border border-good rounded-lg px-3 py-2">
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
                  className="w-full border-2 border-paper-line rounded-xl px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent/50 resize-none"
                />
                {!signedInEmail && (
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Your email (optional, if you'd like a reply)"
                    className="w-full border-2 border-paper-line rounded-lg px-3 py-2 text-ink placeholder:text-ink-soft focus:outline-none focus:border-accent/50 text-sm"
                  />
                )}
                {status === 'error' && (
                  <p className="text-clay text-sm">Couldn&apos;t send that — check your connection and try again.</p>
                )}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!message.trim() || status === 'sending'}
                  className="w-full bg-accent text-white py-2.5 rounded-xl font-semibold disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all"
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
