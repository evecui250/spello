'use client';

import Link from 'next/link';
import Logo from '../../components/Logo';

// Deliberately exempted from the app-wide sign-in gate (see AuthGate) — see
// app/privacy/page.tsx for why.
export default function TermsPage() {
  return (
    <div className="flex flex-col gap-6 max-w-xl mx-auto">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo variant="icon" size={56} className="ring-2 ring-white/20" />
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          Terms of Service
        </h1>
        <p className="text-amber-100/70 text-sm">Last updated: 29 July 2026</p>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-5 text-stone-700 text-sm leading-relaxed">
        <p>
          Spello is currently a free, independently-run testing preview. By creating an
          account, you agree to the following.
        </p>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">The service</h2>
          <p>
            Spello helps you learn German vocabulary through spaced repetition, AI-generated
            translation exercises, and review quizzes. It's provided as-is, during an active
            testing phase — features, word lists, and pricing may change as it develops.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Fair use</h2>
          <p>
            The AI exercises are capped at a set number of uses per day, per account — a
            safeguard against abuse, not a limit meant to interfere with normal daily
            studying. Please don't attempt to script or automate requests to the AI features,
            or attempt to access another user's account or data.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Your account</h2>
          <p>
            You're responsible for keeping access to your sign-in email secure. You can stop
            using Spello and request account deletion anytime — see the Privacy Policy for how.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">No warranty</h2>
          <p>
            Spello is offered without any warranty of accuracy, availability, or fitness for a
            particular purpose. AI-generated corrections are a learning aid, not a guarantee of
            perfect grammar — mistakes can happen. We're not liable for any loss arising from
            your use of the app, to the fullest extent the law allows.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Future paid plans</h2>
          <p>
            Spello is free during this testing phase. If paid plans are introduced later,
            these terms will be updated first with clear pricing and billing details before
            anything is charged.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Changes to these terms</h2>
          <p>
            We may update these terms as the app develops; continuing to use Spello after a
            change means you accept the update. Meaningful changes will be reflected in the
            "last updated" date above.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Contact</h2>
          <p>
            Questions about these terms — reach us at{' '}
            <span className="font-semibold">evecui250@gmail.com</span>.
          </p>
        </section>

        <p className="text-stone-400 text-xs pt-2 border-t border-amber-100/60">
          These terms cover Spello's current, free testing phase in plain language — worth a
          proper legal review before any wider public launch or paid plans.
        </p>
      </div>

      <Link href="/privacy" className="text-center text-amber-200 hover:text-amber-100 underline text-sm">
        Read the Privacy Policy →
      </Link>
    </div>
  );
}
