'use client';

interface Props {
  onClose: () => void;
}

// Shown once, the first time an A1 learner's round 1 is a genuinely new
// word that ISN'T one of the ~220 curated bootstrap words (see
// isBootstrapCopyWord) — the exact moment they move from copy-the-word
// onto the real AI sentence-writing exercise for the first time.
// hasSeenAiUnlockCelebration (Settings, syncs like everything else there)
// keeps this from ever showing again on this or any other signed-in device.
export default function AiUnlockCelebration({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-amber-50 rounded-2xl p-5 max-w-sm w-full flex flex-col gap-3 shadow-xl text-center"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-3xl">🎉</p>
        <h2 className="font-semibold text-stone-800 text-lg">AI sentence writing unlocked!</h2>
        <p className="text-stone-500 text-sm">
          You've learned the first 220 words. New words now come with real sentences to translate.
        </p>
        <button
          onClick={onClose}
          className="bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all mt-1"
        >
          Let's go
        </button>
      </div>
    </div>
  );
}
