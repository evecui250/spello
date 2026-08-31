'use client';

import { useState } from 'react';
import { Word } from '../lib/words';
import { speakWord } from '../lib/speech';
import SpeakerIcon from './SpeakerIcon';

interface Props {
  word: Word;
  className?: string;
  // false for a word that isn't actually saved yet (the Word List's own
  // lookup preview, before "Add to my words" is tapped — see
  // WordInfoPanel's own isPreview prop) — see speakWord/speakWordOnce's
  // own comment for the real cross-word-audio bug this prevents.
  allowAudioGeneration?: boolean;
}

// A real report caught this: tapping the button for a word with no
// pre-recorded clip of its own (a learner-added custom word — see
// lib/storage.ts's custom-words section) can silently fail if the
// browser-TTS fallback it leans on every single time also doesn't cooperate
// (a known, already-diagnosed speechSynthesis flake — see lib/speech.ts's
// reportTtsError) — total silence, with nothing on screen telling the
// learner whether their tap even registered. speakWord's onFailure now
// fires exactly once when it's genuinely given up (not for a routine
// supersession/page-hidden case, which isn't a failure at all), briefly
// swapping the icon to a crossed-out speaker rather than leaving it a
// total mystery.
const FAILURE_DISPLAY_MS = 2000;

export default function SpeakerButton({ word, className, allowAudioGeneration = true }: Props) {
  const [failed, setFailed] = useState(false);

  const handleClick = () => {
    setFailed(false);
    speakWord(word, () => {
      setFailed(true);
      setTimeout(() => setFailed(false), FAILURE_DISPLAY_MS);
    }, allowAudioGeneration);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={failed ? `Couldn't play pronunciation of ${word.de} — tap to try again` : `Play pronunciation of ${word.de}`}
      title={failed ? "Couldn't play — tap to try again" : undefined}
      className={(className ?? 'text-accent hover:text-accent-deep transition-colors') + (failed ? ' text-clay' : '')}
    >
      <SpeakerIcon muted={failed} />
    </button>
  );
}
