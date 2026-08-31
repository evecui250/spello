'use client';

import { speakText } from '../lib/speech';
import SpeakerIcon from './SpeakerIcon';
import { WordGloss } from '../lib/ai';

interface Props {
  surfaceForm: string;
  gloss: WordGloss;
}

// The fallback shown when a learner taps a word inside an AI-corrected
// sentence (or the round-1 prompt) that ISN'T one of Spello's own corpus
// words (see resolveClickedWord's corpus-only chain in lib/words.ts, and
// sentence-glosses/DailySessionFlow's `glosses` state for where this data
// comes from) — same visual family as WordInfoPanel, just without the
// mascot-progress "from LEVEL" badge, since there's no real corpus word/
// progress behind this lookup, only an AI-provided lemma and gloss (plus,
// now, the same grammatical detail WordInfoPanel shows for a real corpus
// word when it genuinely applies — a real request: this used to be a bare
// lemma+gloss even for an ordinary noun/verb, no plural or tenses at all,
// unlike a real corpus word's own panel). Uses browser TTS directly (not
// the per-word cached-audio pipeline WordInfoPanel's SpeakerButton relies
// on) since there's no corpus id to look a pre-generated audio file up by.
export default function GlossPopup({ gloss }: Props) {
  return (
    <div className="bg-paper/75 backdrop-blur-sm rounded-xl border border-paper-line/50 shadow-sm px-4 py-3 flex flex-col gap-1.5">
      <span className="text-lg font-bold text-ink">
        {gloss.article ? `${gloss.article} ` : ''}{gloss.lemma}
        <button
          type="button"
          onClick={() => speakText(gloss.lemma)}
          aria-label={`Play pronunciation of ${gloss.lemma}`}
          className="ml-1.5 align-middle text-label hover:text-label transition-colors"
        >
          <SpeakerIcon />
        </button>
      </span>
      <div className="text-ink-soft text-sm">{gloss.gloss}</div>
      {gloss.plural && (
        <div className="text-xs text-ink-soft">
          Plural: <span className="font-semibold text-ink">die {gloss.plural}</span>
        </div>
      )}
      {(gloss.thirdPerson || gloss.pastTense || gloss.perfectTense) && (
        <div className="text-xs text-ink-soft flex flex-col gap-0.5">
          {gloss.thirdPerson && <div>er/sie/es: <span className="font-semibold text-ink">{gloss.thirdPerson}</span></div>}
          {gloss.pastTense && <div>simple past: <span className="font-semibold text-ink">{gloss.pastTense}</span></div>}
          {gloss.perfectTense && <div>perfect: <span className="font-semibold text-ink">{gloss.perfectTense}</span></div>}
        </div>
      )}
      {gloss.prepositionNote && (
        <div className="text-xs text-ink-soft">
          Usually with: <span className="font-semibold text-ink">{gloss.prepositionNote}</span>
        </div>
      )}
    </div>
  );
}
