'use client';

import { speakText } from '../lib/speech';
import SpeakerIcon from './SpeakerIcon';

interface Props {
  text: string;
  className?: string;
}

// Same idea as SpeakerButton, but for arbitrary German text (a corrected
// example sentence) rather than a single vocabulary Word — always the
// on-device browser voice, same as speakText's only other caller
// (SentenceExercise's own auto-play), since a full sentence has no
// pre-recorded clip of its own to try first.
export default function TextSpeakerButton({ text, className }: Props) {
  return (
    <button
      type="button"
      onClick={() => speakText(text)}
      aria-label="Play pronunciation of this sentence"
      className={className ?? 'text-indigo-400 hover:text-indigo-600 transition-colors'}
    >
      <SpeakerIcon />
    </button>
  );
}
