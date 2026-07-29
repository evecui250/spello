'use client';

import Link from 'next/link';
import Logo from '../../components/Logo';

// Deliberately exempted from the app-wide sign-in gate (see AuthGate) — a
// privacy policy has to be readable before someone creates an account, not
// only after.
export default function PrivacyPage() {
  return (
    <div className="flex flex-col gap-6 max-w-xl mx-auto">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo variant="icon" size={56} className="ring-2 ring-white/20" />
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
          Privacy Policy
        </h1>
        <p className="text-amber-100/70 text-sm">Last updated: 29 July 2026</p>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 flex flex-col gap-5 text-stone-700 text-sm leading-relaxed">
        <p>
          Spello is a small, independently-run German vocabulary trainer. This page explains
          what data it collects, why, and who it's shared with — in plain language, covering
          exactly what the app actually does.
        </p>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">What we collect</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li><strong>Your email address</strong>, used only to send you a one-time sign-in link and identify your account. We never see or store a password.</li>
            <li><strong>Your learning progress</strong> — which words you've studied, your review schedule, streak, and settings (pace, level, language) — so it can sync across your devices.</li>
            <li><strong>Text you submit for the AI translation exercise</strong> — your attempted German translation of a practice sentence, sent to our AI provider to be corrected.</li>
          </ul>
          <p>
            We don't run ads, don't use analytics or tracking cookies, and don't sell or share
            your data with advertisers.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Where it's stored</h2>
          <p>
            Your account and progress are stored with Supabase (hosted in the EU) under your
            own user ID. A local copy also lives in your browser's storage so the app keeps
            working offline; it syncs back up whenever you're signed in and online.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Third parties</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li><strong>Supabase</strong> — authentication and database hosting.</li>
            <li><strong>OpenAI</strong> — generates practice sentences and corrects your translation attempts. Only the specific sentence/translation being processed is sent, not your email or account history.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Your choices</h2>
          <ul className="list-disc pl-5 flex flex-col gap-1">
            <li>Erase your learning progress for a level anytime from Settings → Danger zone.</li>
            <li>Delete your account and all associated data entirely by emailing us (below) — we don't yet have a self-service delete button, but we'll act on any request promptly.</li>
            <li>Sign out anytime from Settings; your local device copy stays until you clear it or a level's progress is erased.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Children</h2>
          <p>
            Spello isn't directed at children under 16. If you believe a child has created an
            account without appropriate consent, contact us and we'll remove it.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Changes</h2>
          <p>
            If how we handle data changes meaningfully (e.g. when paid plans launch), we'll
            update this page and the "last updated" date above.
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="font-semibold text-stone-800">Contact</h2>
          <p>
            Questions, deletion requests, anything else — reach us at{' '}
            <span className="font-semibold">[YOUR CONTACT EMAIL]</span>.
          </p>
        </section>

        <p className="text-stone-400 text-xs pt-2 border-t border-amber-100/60">
          This policy describes Spello's practices in plain terms but isn't a substitute for
          formal legal advice — worth a proper review before any wider public launch or paid
          plans.
        </p>
      </div>

      <Link href="/terms" className="text-center text-amber-200 hover:text-amber-100 underline text-sm">
        Read the Terms of Service →
      </Link>
    </div>
  );
}
