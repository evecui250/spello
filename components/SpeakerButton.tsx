'use client';

import { Word } from '../lib/words';
import { speakWord } from '../lib/speech';

interface Props {
  word: Word;
  className?: string;
}

export default function SpeakerButton({ word, className }: Props) {
  return (
    <button
      type="button"
      onClick={() => speakWord(word)}
      aria-label={`Play pronunciation of ${word.de}`}
      className={className ?? 'text-indigo-400 hover:text-indigo-600 transition-colors'}
    >
      🔊
    </button>
  );
}
