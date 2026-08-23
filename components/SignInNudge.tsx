'use client';

import { useRouter } from 'next/navigation';

interface Props {
  onClose: () => void;
}

// Shown once, right after CongratsModal closes, only to a learner who just
// finished today's goal without being signed in — sign-in stays entirely
// optional everywhere else in the app (the forced gate was deliberately
// removed), so this is a single soft nudge at the one moment a learner is
// most likely to care about not losing what they just did, not a recurring
// or blocking ask. Naturally capped at once per day already, since "just
// finished today's goal" only happens once a day. Routes to Settings
// (where AccountPanel's actual sign-in form lives) rather than duplicating
// that form here — this is just the nudge, not a second sign-in UI to
// maintain.
export default function SignInNudge({ onClose }: Props) {
  const router = useRouter();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-amber-50 rounded-2xl p-5 max-w-sm w-full flex flex-col gap-3 shadow-xl text-center"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="font-semibold text-stone-800 text-lg">Don't lose today's progress</h2>
        <p className="text-stone-500 text-sm">
          It only lives on this device. Sign in with just an email to back it up.
        </p>
        <div className="flex flex-col gap-2 mt-1">
          <button
            onClick={() => { onClose(); router.push('/settings'); }}
            className="bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Sign in
          </button>
          <button onClick={onClose} className="text-center text-slate-400 text-sm hover:text-slate-600 transition-colors">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
