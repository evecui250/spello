'use client';

import { Word } from './words';
import { supabase } from './supabase';

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
  // A device with literally no German voice installed at all is the one
  // case iOS's own "falls back to the device's default voice" behavior
  // (see this function's own comment) doesn't reliably cover on every
  // platform — leaving utterance.voice unset then relies entirely on
  // whichever browser/OS combination is running to pick SOMETHING for
  // an unmatched `lang`, and not every one of them does. Explicitly
  // falling back to ANY installed voice (wrong accent, but audible)
  // removes that reliance outright instead of risking total silence.
  const best = german.find(v => v.lang.toLowerCase() === 'de-de') ?? german[0] ?? voices[0] ?? null;
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

// Fires at most once per page load — a real "no sound at all" report came
// in that this code couldn't reproduce locally (speak()/onstart both fire
// cleanly in every environment tested), so rather than guess again blind,
// this reports the actual browser-level failure (or confirms there wasn't
// one) the next time it happens on a real device, same auto-diagnostic
// pattern as handleAiUnreachable's own bug_reports insert elsewhere.
let ttsErrorReported = false;
function reportTtsError(detail: string): void {
  if (ttsErrorReported) return;
  ttsErrorReported = true;
  supabase.from('bug_reports').insert({
    user_id: null,
    email: null,
    message: `Auto-detected: speechSynthesis error while speaking a sentence/word (${detail}).`,
    page_path: window.location.pathname,
    user_agent: navigator.userAgent,
  }).then(() => {}, () => {});
}

// Confirmed real (two auto-filed bug reports, one from desktop Chrome, one
// from mobile Safari, both "never started" — same failure on unrelated
// engines) rather than an isolated iOS quirk: this matches a well-known
// speechSynthesis bug where the queue can get stuck PAUSED after enough
// cancel() calls (this app calls stopSpeech()'s own cancel() on every
// route change/tab-hide) and every speak() after that silently does
// nothing until the page reloads — no error event, nothing. resume() is
// the standard, harmless-elsewhere unstick for that; calling it right
// before every speak() costs nothing on a browser that was never stuck.
function speakWithBrowserVoice(text: string, isRetry = false): void {
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
  utterance.onerror = (e) => {
    if (isRetry) reportTtsError(e.error);
    // A genuine error (not just a silent hang) on the FIRST attempt is
    // still worth one retry — see the onstart-timeout branch below for
    // why a retry, not an immediate report.
  };
  // Only cancel when something is actually in-flight -- calling cancel()
  // unconditionally right before speak(), even with nothing queued, is a
  // known Chromium/Chrome-on-Android flake: the immediately-following
  // speak() can get silently dropped rather than actually spoken,
  // reportedly worse right after a fresh page load (exactly when a
  // learner's first tap of this button would hit it). Skipping the
  // no-op cancel avoids that race entirely; a genuinely in-flight
  // utterance (rapid repeat taps) still gets cancelled as before.
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }
  window.speechSynthesis.resume();
  // Covers the failure mode an onerror handler alone can't: some
  // browser/OS combinations just never start speaking at all, with no
  // error event of any kind — the exact "no sound, no error" shape of
  // both real reports this was added for. If onstart hasn't fired by the
  // time this utterance should already be well underway, that's the
  // signature of the stuck-queue bug above — cancel to clear whatever's
  // wedged and retry ONCE before actually reporting a failure.
  let started = false;
  utterance.onstart = () => { started = true; };
  setTimeout(() => {
    if (started) return;
    if (isRetry) { reportTtsError('never started (after retry)'); return; }
    window.speechSynthesis.cancel();
    speakWithBrowserVoice(text, true);
  }, 2000);
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
  // Guards a real browser race: if stopSpeech()/a newer speakWord() call
  // already paused and cleared `currentAudio` (e.g. the learner navigated
  // away, or the tab was backgrounded — see the visibilitychange listener
  // below) WHILE this play() promise was still pending, some browsers
  // resolve that promise and start playback anyway once the tab/page is
  // active again, ignoring the earlier pause() — the audio equivalent of
  // the AbortError guard `fallback` above already needs on the reject
  // side. Re-pausing here the moment the promise settles, if this is no
  // longer the current audio, closes that gap on the resolve side too.
  audio.play().then(() => { if (currentAudio !== audio) audio.pause(); }).catch(fallback);
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

// Covers a gap SpeechCleanup (app/layout.tsx) can't: that component only
// calls stopSpeech() on an in-app ROUTE change, but a learner backgrounding
// the tab/app (switching apps, locking the phone, switching browser tabs)
// without navigating anywhere doesn't fire that at all — a real reported
// case ("audio just started randomly while I wasn't studying"). Mobile
// Safari/Chrome are both known to suspend an in-flight speechSynthesis
// utterance or Audio playback while a tab is hidden and let it resume once
// it's visible again, rather than actually stopping it — from the
// learner's side, that reads as audio starting on its own, later, out of
// context. Stopping proactively the moment the tab is hidden (rather than
// waiting to see if it resumes) means there's nothing left queued to
// resume when they come back, regardless of which page they were on.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopSpeech();
  });
}
