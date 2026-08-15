'use client';

import { Word } from './words';

// Nouns are spoken with their article (e.g. "der Tisch") so the learner
// hears the gender along with the word, not just the bare noun.
export function spokenForm(word: Word): string {
  return word.article ? `${word.article} ${word.de}` : word.de;
}

// Pre-generated recordings (one consistent Standard German voice for every
// word, every device) live under /public/audio, named by word id.
export function audioUrlForWord(word: Word): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/audio/${word.id}.mp3`;
}

// --- Browser TTS fallback ---
// Used only if a word's recording is missing or fails to load. iOS Safari
// loads its voice list asynchronously (it can be empty on the very first
// call) and, unlike macOS Safari, doesn't reliably match `utterance.lang` to
// a German voice on its own — it can silently fall back to the device's
// default system voice instead. Explicitly picking a German voice from the
// list (once it's loaded) avoids that.
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

function speakWithBrowserVoice(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.rate = 0.9;
  // See WORD_AUDIO_VOLUME below — on-device testing found the on-device
  // browser voice used for sentences was actually the LOUDER side of the
  // two, not the pre-recorded word clips, so this pulls sentences down to
  // roughly match instead.
  utterance.volume = SENTENCE_AUDIO_VOLUME;
  const voice = pickGermanVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// For arbitrary German text with no pre-recorded file of its own (e.g. a
// full AI-corrected example sentence, as opposed to a single vocabulary
// word) — always the free on-device browser voice, no pre-generated
// recording exists to try first.
export function speakText(text: string): void {
  speakWithBrowserVoice(text);
}

// Real-world testing found the on-device browser voice (sentences) came
// out noticeably LOUDER than the pre-recorded word clips at their
// original, un-adjusted volumes — the opposite of what an earlier pass at
// this assumed — so it's the sentence side pulled down here instead of
// the word side. Rough first-pass numbers since actual loudness is very
// device/voice-dependent; nudge these further if one side still sounds
// off on your device.
const WORD_AUDIO_VOLUME = 1;
const SENTENCE_AUDIO_VOLUME = 0.7;

let currentAudio: HTMLAudioElement | null = null;

// Plays this word's pre-generated recording — the same voice for every user
// on every device — falling back to the browser's built-in text-to-speech
// (which varies a lot by device/browser) only if the file is unavailable.
export function speakWord(word: Word): void {
  if (typeof window === 'undefined') return;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const audio = new Audio(audioUrlForWord(word));
  audio.volume = WORD_AUDIO_VOLUME;
  currentAudio = audio;
  const fallback = () => {
    // A newer speakWord() call can supersede this one (pausing this audio
    // on purpose to start the next), which also rejects this play()
    // promise with an AbortError — that's not a real playback failure and
    // must not trigger the (lower-quality, possibly wrong-accent) browser
    // TTS fallback. Only fall back if we're still the current audio.
    if (currentAudio !== audio) return;
    speakWithBrowserVoice(spokenForm(word));
  };
  audio.addEventListener('error', fallback);
  audio.play().catch(fallback);
}

// Cancels whatever's currently playing/queued (word clip or browser TTS
// sentence) — call this on unmount/navigation so an utterance that was
// still queued up when the learner moved on doesn't keep playing out of
// nowhere a few seconds later ("why do I hear 'Ich habe...' when I'm not
// even on the practice page"). speechSynthesis.cancel() clears BOTH the
// currently-speaking utterance and anything queued behind it.
export function stopSpeech(): void {
  if (typeof window === 'undefined') return;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
