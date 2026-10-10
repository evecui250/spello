'use client';

import { useState } from 'react';
import { speakSentence } from '../lib/speech';
import SpeakerIcon from './SpeakerIcon';

interface Props {
  text: string;
  className?: string;
}

const FAILURE_DISPLAY_MS = 2000;

// Same idea as SpeakerButton, but for arbitrary German text (a corrected
// example sentence) rather than a single vocabulary Word — always the
// on-device browser voice, same as speakText's only other caller
// (SentenceExercise's own auto-play), since a full sentence has no
// pre-recorded clip of its own to try first. Real report: this had NO
// failure feedback at all (unlike SpeakerButton, which briefly shows a
// crossed-out icon) — on a device where speechSynthesis is genuinely
// stuck, tapping this looked exactly like "does nothing," indistinguishable
// from the tap not registering at all.
export default function TextSpeakerButton({ text, className }: Props) {
  const [failed, setFailed] = useState(false);
  // True while this sentence's recording is being made (first tap only).
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    setFailed(false);
    speakSentence(text, {
      onLoading: setLoading,
      onFailure: () => {
        setFailed(true);
        setTimeout(() => setFailed(false), FAILURE_DISPLAY_MS);
      },
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={failed ? "Couldn't play pronunciation of this sentence — tap to try again" : 'Play pronunciation of this sentence'}
      title={failed ? "Couldn't play — tap to try again" : undefined}
      aria-busy={loading}
      className={(className ?? 'text-label hover:text-label transition-colors') + (failed ? ' text-clay' : '') + (loading ? ' animate-pulse' : '')}
    >
      <SpeakerIcon muted={failed} />
    </button>
  );
}
