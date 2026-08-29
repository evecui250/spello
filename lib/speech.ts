'use client';

import { Word } from './words';
import { supabase } from './supabase';
import { getSettings } from './storage';

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

// Picks a German voice from a voice list, preferring one that runs fully
// on-device (voice.localService === true) over a network-backed voice.
// A network voice depends on a round-trip to the browser/OS vendor's TTS
// service completing — bad connectivity, a corporate proxy, or a
// regional block all make that round-trip simply never finish, and
// speechSynthesis has no error event for "the network call never came
// back": from the caller's side that looks identical to the "never
// started, no error at all" hang this file was built to diagnose. Both
// auto-filed reports so far had plenty of voices available (221, 68), so
// a genuinely missing German voice isn't the likely explanation — an
// unreliable network voice being the one JS happened to pick is a much
// better fit for a failure this silent.
//
// `exclude`, when given, is skipped entirely. This matters for the retry
// path below: retrying with the exact same (cached) voice object — which
// is what this function used to always hand back — guarantees an
// identical silent failure if that specific voice is what's broken,
// which matches every "never started (after retry)" report seen so far
// (the retry is a fresh speak() call, but never a fresh voice choice).
function selectGermanVoice(
  voices: SpeechSynthesisVoice[],
  exclude?: SpeechSynthesisVoice | null,
): SpeechSynthesisVoice | null {
  const usable = exclude ? voices.filter(v => v !== exclude) : voices;
  const german = usable.filter(v => v.lang?.toLowerCase().startsWith('de'));
  const localGerman = german.filter(v => v.localService);
  // A device with literally no German voice installed at all is the one
  // case iOS's own "falls back to the device's default voice" behavior
  // doesn't reliably cover on every platform — leaving utterance.voice
  // unset then relies entirely on whichever browser/OS combination is
  // running to pick SOMETHING for an unmatched `lang`, and not every one
  // of them does. Explicitly falling back to ANY installed voice (wrong
  // accent, but audible) removes that reliance outright instead of
  // risking total silence.
  return (
    localGerman.find(v => v.lang.toLowerCase() === 'de-de') ??
    localGerman[0] ??
    german.find(v => v.lang.toLowerCase() === 'de-de') ??
    german[0] ??
    usable.find(v => v.localService) ??
    usable[0] ??
    null
  );
}

function pickGermanVoice(): SpeechSynthesisVoice | null {
  if (cachedGermanVoice !== undefined) return cachedGermanVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // not loaded yet — try again on the next call
  const best = selectGermanVoice(voices);
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
// A later report showed the retry ITSELF also failing ("never started
// (after retry)") — a different, deeper failure than the stuck-queue bug
// resume()/retry were built for (that one didn't survive a single retry).
// Since another blind fix attempt isn't warranted without more signal,
// this now captures the actual speechSynthesis state at the moment of
// failure (voice count, speaking/pending/paused) instead of just the
// bare detail string, so the NEXT report actually says why, rather than
// needing yet another guess.
let ttsErrorReported = false;
function reportTtsError(detail: string, voice?: SpeechSynthesisVoice | null): void {
  if (ttsErrorReported) return;
  ttsErrorReported = true;
  const synth = window.speechSynthesis;
  // Which voice was actually in play matters as much as the synth's queue
  // state — see selectGermanVoice's own comment on why a network-backed
  // voice is the leading suspect for a hang with no error event at all.
  // Recording it here means the NEXT report either confirms that theory
  // (still a network voice, even after this file starts preferring local
  // ones) or rules it out outright, instead of leaving it a guess again.
  const voiceInfo = voice
    ? `voice=${voice.name} (${voice.lang}, ${voice.localService ? 'local' : 'network'})`
    : 'voice=none';
  const diagnostics = `voices=${synth.getVoices().length}, speaking=${synth.speaking}, ` +
    `pending=${synth.pending}, paused=${synth.paused}, ${voiceInfo}`;
  supabase.from('bug_reports').insert({
    user_id: null,
    email: null,
    message: `Auto-detected: speechSynthesis error while speaking a sentence/word (${detail}). [${diagnostics}]`,
    page_path: window.location.pathname,
    user_agent: navigator.userAgent,
  }).then(() => {}, () => {});
}

// Bumped by every call that means "whatever was queued before no longer
// matters" — a fresh speakWithBrowserVoice call (this one, right below,
// unconditionally) and stopSpeech()'s own explicit cancel(). Each
// utterance captures the value AT THE MOMENT IT WAS CREATED; its onerror/
// onstart-timeout handlers both bail out silently if the counter has
// since moved on, rather than reporting anything. Confirmed real and
// necessary: a report came in with error "interrupted" that was just the
// visibilitychange handler's own stopSpeech() doing its job while a word
// happened to be mid-speech (the learner switched tabs/apps) —
// speechSynthesis fires onerror with "interrupted" for ANY cancelled
// utterance, deliberate or not, so without this every ordinary
// navigate-away-mid-word moment was being misfiled as a genuine TTS bug.
let speechGeneration = 0;

// Confirmed real (two auto-filed bug reports, one from desktop Chrome, one
// from mobile Safari, both "never started" — same failure on unrelated
// engines) rather than an isolated iOS quirk: this matches a well-known
// speechSynthesis bug where the queue can get stuck PAUSED after enough
// cancel() calls (this app calls stopSpeech()'s own cancel() on every
// route change/tab-hide) and every speak() after that silently does
// nothing until the page reloads — no error event, nothing. resume() is
// the standard, harmless-elsewhere unstick for that; calling it right
// before every speak() costs nothing on a browser that was never stuck.
function speakWithBrowserVoice(
  text: string,
  isRetry = false,
  excludeVoice: SpeechSynthesisVoice | null = null,
  // Fires once this specific utterance actually finishes speaking —
  // speakWord's repeat-count chain (see WORD_REPEAT_GAP_MS below) needs
  // this to know when it's safe to start the next repeat, on whichever
  // attempt (original or retry) actually ends up speaking.
  onEnd?: () => void,
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || isPageHidden()) return;
  const myGeneration = ++speechGeneration;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.rate = 0.9;
  if (onEnd) utterance.onend = () => { if (speechGeneration === myGeneration) onEnd(); };
  // See WORD_AUDIO_VOLUME below — on-device testing found the on-device
  // browser voice used for sentences was actually the LOUDER side of the
  // two, not the pre-recorded word clips, so this pulls sentences down to
  // roughly match instead.
  utterance.volume = SENTENCE_AUDIO_VOLUME;
  // A retry always re-picks live (bypassing the cache) and explicitly
  // excludes whatever voice the failed attempt used — see
  // selectGermanVoice's own comment for why reusing that same voice
  // object here would just reproduce the same silent hang.
  const voice = isRetry
    ? selectGermanVoice(window.speechSynthesis.getVoices(), excludeVoice)
    : pickGermanVoice();
  if (voice) utterance.voice = voice;
  utterance.onerror = (e) => {
    // Superseded by a newer speak() call or an explicit stopSpeech() by
    // the time this fired — see speechGeneration's own comment. Not a
    // real failure, nothing to report.
    if (speechGeneration !== myGeneration) return;
    if (isRetry) reportTtsError(e.error, voice);
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
    // Same supersession check as onerror above — a route change or
    // tab-hide since this was scheduled means there's deliberately
    // nothing left to retry for.
    if (speechGeneration !== myGeneration) return;
    if (isRetry) { reportTtsError('never started (after retry)', voice); return; }
    window.speechSynthesis.cancel();
    speakWithBrowserVoice(text, true, voice, onEnd);
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

// Pause between repeats of the same word (see speakWord's own
// wordRepeatCount handling below) — long enough to read as two separate
// sayings of the word, not one run-on utterance, short enough that
// hearing it 2-3 times still feels like one quick moment.
const WORD_REPEAT_GAP_MS = 450;

let currentAudio: HTMLAudioElement | null = null;

// A real report: audio spoke a word from a level the learner wasn't even
// studying, well after they'd switched to a different app entirely.
// stopSpeech()'s visibilitychange listener only cancels whatever is
// ALREADY in flight the moment the tab is hidden — it can't do anything
// about a call that hasn't happened yet, like the 550ms-delayed
// post-correct-answer pronunciation this file and DailySessionFlow both
// schedule, or (the likely actual culprit here) an old, forgotten
// background tab/session whose own pending speech only got around to
// firing much later, once the browser eventually let its throttled
// timers run. Checked at the actual "about to make sound" chokepoints
// (not just once at the call site) so it catches EVERY path into audio,
// however stale or delayed the request that triggered it.
function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

// Plays this word's pre-generated recording ONCE — the same voice for
// every user on every device — falling back to the browser's built-in
// text-to-speech (which varies a lot by device/browser) only if the file
// is unavailable. `onEnded`, when given, fires once this one playback
// actually finishes (whichever path it took) — speakWord's own repeat
// chain below is the only caller that needs it; every other call site
// just wants "play the word" and leaves it out.
function speakWordOnce(word: Word, onEnded?: () => void): void {
  if (typeof window === 'undefined' || isPageHidden()) return;
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
    speakWithBrowserVoice(spokenForm(word), false, null, onEnded);
  };
  audio.addEventListener('error', fallback);
  if (onEnded) {
    // Only from OUR audio element specifically, and only while it's still
    // the current one — the same "am I still the one that matters" guard
    // the AbortError/re-pause handling below already needs.
    audio.addEventListener('ended', () => { if (currentAudio === audio) onEnded(); });
  }
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

// A separate counter from speechGeneration (which speakWithBrowserVoice
// owns entirely for its own retry/supersession logic — folding this into
// that one would make every fallback-triggered bump inside it look like
// this chain got superseded too, stopping repeats after the very first
// fallback). This one only tracks whether a word-repeat chain is still
// the most recently requested one, so a stray delayed repeat from an
// OLDER speakWord() call can't fire after a newer speakWord()/
// stopSpeech() call has already moved on to something else.
let wordChainGeneration = 0;

// Plays this word as many times in a row as Settings' wordRepeatCount
// says (default 1, unchanged behavior) — a real request from learners
// who want to hear a tricky word repeated without tapping the speaker
// icon over and over. Clamped defensively since this is user-entered
// data: 0/negative would silently say nothing, and nothing genuinely
// benefits from more than a handful of repeats in a row.
export function speakWord(word: Word): void {
  const myChain = ++wordChainGeneration;
  const times = Math.max(1, Math.min(5, Math.round(getSettings().wordRepeatCount ?? 1)));
  let played = 0;
  const playNext = () => {
    if (wordChainGeneration !== myChain) return;
    played++;
    speakWordOnce(word, played < times ? () => setTimeout(playNext, WORD_REPEAT_GAP_MS) : undefined);
  };
  playNext();
}

// Cancels whatever's currently playing/queued (word clip or browser TTS
// sentence) — call this on unmount/navigation so an utterance that was
// still queued up when the learner moved on doesn't keep playing out of
// nowhere a few seconds later ("why do I hear 'Ich habe...' when I'm not
// even on the practice page"). speechSynthesis.cancel() clears BOTH the
// currently-speaking utterance and anything queued behind it.
export function stopSpeech(): void {
  if (typeof window === 'undefined') return;
  // See speechGeneration's/wordChainGeneration's own comments — marks
  // anything currently in flight (including a pending word repeat) as
  // deliberately superseded, not a failure, before actually cancelling it.
  speechGeneration++;
  wordChainGeneration++;
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
