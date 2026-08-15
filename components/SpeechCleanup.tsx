'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { stopSpeech } from '../lib/speech';

// Mounted once in the root layout — cancels any in-flight/queued speech
// (word clip or browser TTS sentence) on every route change. A per-effect
// cleanup where speech is actually triggered (see DailySessionFlow's
// correction auto-play) already covers the common case, but this is a
// broader safety net: any lingering utterance, from anywhere in the app,
// stops the moment the learner navigates away instead of surfacing later
// out of context ("why do I hear German when I'm not even studying").
export default function SpeechCleanup() {
  const pathname = usePathname();
  useEffect(() => {
    stopSpeech();
  }, [pathname]);
  return null;
}
