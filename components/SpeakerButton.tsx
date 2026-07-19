'use client';

import { useEffect, useState } from 'react';
import { speakGerman } from '../lib/speech';

interface Props {
  text: string;
  className?: string;
}

export default function SpeakerButton({ text, className }: Props) {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported('speechSynthesis' in window);
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => speakGerman(text)}
      aria-label={`Play pronunciation of ${text}`}
      className={className ?? 'text-indigo-400 hover:text-indigo-600 transition-colors'}
    >
      🔊
    </button>
  );
}
