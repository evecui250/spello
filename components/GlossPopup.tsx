'use client';

import { speakText } from '../lib/speech';

// The fallback shown when a learner taps a word inside an AI-corrected
// sentence that ISN'T one of Spello's own corpus words (see
// resolveClickedWord's corpus-only chain in lib/words.ts, and
// sentence-glosses/DailySessionFlow's `glosses` state for where this
// data comes from) — same visual family as WordInfoPanel, just without
// the mascot-progress "from LEVEL" badge, since there's no real corpus
// word/progress behind this lookup, only an AI-provided lemma and gloss.
// Uses browser TTS directly (not the per-word cached-audio pipeline
// WordInfoPanel's SpeakerButton relies on) since there's no corpus id to
// look a pre-generated audio file up by.
export default function GlossPopup({ lemma, gloss }: { surfaceForm: string; lemma: string; gloss: string }) {
  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex flex-col gap-1.5">
      <span className="text-lg font-bold text-indigo-800">
        {lemma}
        <button
          type="button"
          onClick={() => speakText(lemma)}
          aria-label={`Play pronunciation of ${lemma}`}
          className="ml-1.5 align-middle text-indigo-400 hover:text-indigo-600 transition-colors text-base"
        >
          🔊
        </button>
      </span>
      <div className="text-stone-600 text-sm">{gloss}</div>
    </div>
  );
}
