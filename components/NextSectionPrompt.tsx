'use client';

import Link from 'next/link';

interface Props {
  // Which section the user should go do next.
  section: 'study' | 'review';
  onDismiss: () => void;
}

const COPY = {
  review: {
    message: "Nice work! You've finished today's study words. Review some older ones to lock them in?",
    ctaLabel: 'Review Words →',
    ctaHref: '/practice/review',
  },
  study: {
    message: "Nice work! You've reviewed today's words. Ready to learn something new?",
    ctaLabel: 'Study Words →',
    ctaHref: '/practice/study',
  },
} as const;

export default function NextSectionPrompt({ section, onDismiss }: Props) {
  const copy = COPY[section];
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onDismiss}
    >
      <div
        className="bg-amber-50 rounded-2xl p-6 max-w-xs w-full flex flex-col items-center gap-4 text-center shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-4xl">👉</div>
        <p className="text-slate-700 font-medium">{copy.message}</p>
        <Link
          href={copy.ctaHref}
          className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
        >
          {copy.ctaLabel}
        </Link>
        <button onClick={onDismiss} className="text-slate-400 text-sm hover:text-slate-600 transition-colors">
          Not now
        </button>
      </div>
    </div>
  );
}
