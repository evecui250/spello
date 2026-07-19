'use client';

import { Word } from './words';

// iOS Safari loads its voice list asynchronously (it can be empty on the
// very first call) and, unlike macOS Safari, doesn't reliably match
// `utterance.lang` to a German voice on its own — it can silently fall back
// to the device's default system voice instead. Explicitly picking a German
// voice from the list (once it's loaded) avoids that.
let cachedGermanVoice: SpeechSynthesisVoice | null | undefined;

function pickGermanVoice(): SpeechSynthesisVoice | null {
  if (cachedGermanVoice !== undefined) return cachedGermanVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // not loaded yet — try again on the next call
  const german = voices.filter(v => v.lang?.toLowerCase().startsWith('de'));
  const best = german.find(v => v.lang.toLowerCase() === 'de-de') ?? german[0] ?? null;
  cachedGermanVoice = best;
  return best;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  // Voices can finish loading after our first speak() call — invalidate the
  // cache so the next call picks from the now-complete list.
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    cachedGermanVoice = undefined;
  });
}

export function speakGerman(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.rate = 0.9;
  const voice = pickGermanVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// Nouns are spoken with their article (e.g. "der Tisch") so the learner
// hears the gender along with the word, not just the bare noun.
export function spokenForm(word: Word): string {
  return word.article ? `${word.article} ${word.de}` : word.de;
}
