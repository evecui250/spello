'use client';

import { useEffect } from 'react';
import { primeSpeechSynthesis } from '../lib/speech';

// Mounted once in the root layout — fires primeSpeechSynthesis() on the
// very FIRST tap/touch anywhere in the app, then removes itself. Waits
// for a real user gesture rather than priming on page load outright: iOS
// Safari (and others) can silently ignore a speechSynthesis call made
// with no user-activation behind it at all, so priming needs to ride
// along on whatever the learner taps first (Start, a nav link, anything)
// rather than trying to run unprompted before they've touched the page.
export default function SpeechPrimer() {
  useEffect(() => {
    const prime = () => {
      primeSpeechSynthesis();
      document.removeEventListener('pointerdown', prime);
    };
    document.addEventListener('pointerdown', prime, { once: true });
    return () => document.removeEventListener('pointerdown', prime);
  }, []);
  return null;
}
