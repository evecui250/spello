'use client';

import { Word } from './words';
import { supabase, SUPABASE_URL } from './supabase';
import { getSettings, isCustomWordId } from './storage';
import { generateWordAudio } from './ai';

// Real gap a report caught: a custom word added BEFORE generate-word-audio
// existed (or whose original add-time generation attempt simply failed —
// see app/words/page.tsx's handleAddWord, fire-and-forget there too) has
// no real clip and never will, permanently stuck on the browser-TTS
// fallback with all its known flakiness. Self-heals instead of needing a
// separate backfill script: see speakWordOnce's fallback below, which
// kicks off generation right when it discovers a custom word's clip isn't
// there — this exact play still uses the fallback (the file can't be
// ready in time), but the NEXT play of the same word picks up the real
// clip once it lands. Throttled to once per word per page load so rapid
// repeat taps on a persistently-failing word don't spam the API.
const audioGenerationAttempted = new Set<string>();

// Nouns are spoken with their article (e.g. "der Tisch") so the learner
// hears the gender along with the word, not just the bare noun.
export function spokenForm(word: Word): string {
  return word.article ? `${word.article} ${word.de}` : word.de;
}

// Pre-generated recordings (one consistent Standard German voice for every
// word, every device) live under /public/audio, named by word id -- baked
// into the app bundle at build time via an offline batch script, which
// can't apply to a word a learner adds at runtime. A custom word's clip
// (see generate-word-audio's own comment) instead lives in a real Supabase
// Storage bucket, uploaded once right when the word is added — this simply
// points at wherever the file WOULD be; if generation hasn't finished (or
// was never attempted, or failed) yet, that URL 404s and speakWordOnce's
// existing fallback chain takes over exactly as it already does for a
// missing/broken corpus file, so this never needs its own separate
// "is the audio ready" check.
export function audioUrlForWord(word: Word): string {
  if (isCustomWordId(word.id)) {
    return `${SUPABASE_URL}/storage/v1/object/public/custom-word-audio/${word.id}.mp3`;
  }
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
// Root cause finally confirmed (not another guess): every "never started
// (after retry)" report named the exact same voice both times — e.g.
// "Eddy (de-DE, local)" — which should have been impossible, since the
// retry explicitly excludes whatever voice just failed. The bug was in
// HOW exclusion compared voices: by object reference (`v !== exclude`).
// getVoices() is not guaranteed to return the SAME object instances on
// every call (confirmed several Chrome versions return a freshly-built
// array each time, same underlying voices, new object identities) — so
// comparing the cached, already-failed voice object against a brand-new
// getVoices() array on retry never actually excluded anything: nothing in
// the fresh array is `===` the old object, so the "excluded" voice gets
// re-selected and re-fails identically every single time. Fixed by
// comparing a stable key (name+lang) instead of object identity.
//
// Separately: "Eddy" is one of macOS's newer expressive/personality
// voices (alongside Flo, Grandma, Grandpa, Reed, Rocko, Sandy, Shelley) —
// widely documented (Chromium/WebKit bug trackers, Stack Overflow) as
// listed by getVoices() but unreliable when actually invoked through the
// Web Speech API specifically, independent of this app. Deprioritized
// below (not excluded outright — still usable if it's truly the only
// voice available) so a normal classic voice like "Anna" wins the FIRST
// pick too, not just after a failure.
const FLAKY_VOICE_NAMES = new Set(['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley']);
function isKnownFlakyVoice(v: SpeechSynthesisVoice): boolean {
  return FLAKY_VOICE_NAMES.has(v.name.replace(/\s*\(.*\)$/, '').trim());
}
function voiceKey(v: SpeechSynthesisVoice): string {
  return `${v.name}|${v.lang}`;
}

// Confirmed-bad voices on THIS device, persisted (not just in-memory) —
// a real report caught the remaining gap after the reference-vs-key
// exclusion fix above: fixing that made a RETRY correctly avoid a bad
// voice, but pickGermanVoice's own cache (below) still hands out that
// same voice as the FIRST choice for every subsequent NEW word for the
// rest of the session, since a failed-then-retried success never taught
// it anything — so every single word kept paying the same ~2s fail-then-
// retry cost forever, reported as "needs several clicks before it
// speaks." Once a voice actually fails here, it's remembered in
// localStorage (survives reloads too, so a device with a permanently
// broken default voice doesn't relearn this every fresh page load) and
// deprioritized the same way FLAKY_VOICE_NAMES already is — not excluded
// outright, since if it's the only voice at all it's still better than
// silence.
const BAD_VOICE_STORAGE_KEY = 'wb2_bad_tts_voices';
function loadBadVoiceKeys(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(BAD_VOICE_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}
function markVoiceBad(voice: SpeechSynthesisVoice | null): void {
  if (!voice || typeof localStorage === 'undefined') return;
  const bad = loadBadVoiceKeys();
  const key = voiceKey(voice);
  if (bad.has(key)) return;
  bad.add(key);
  try { localStorage.setItem(BAD_VOICE_STORAGE_KEY, JSON.stringify([...bad])); } catch { /* best-effort */ }
  // Forces the next non-retry pickGermanVoice() call to re-evaluate
  // instead of handing back the now-known-bad cached choice.
  cachedGermanVoice = undefined;
}

// `exclude`, when given, is skipped entirely — compared by voiceKey (see
// above), not object identity, so a retry actually gets a different voice
// when one exists.
function selectGermanVoice(
  voices: SpeechSynthesisVoice[],
  exclude?: SpeechSynthesisVoice | null,
): SpeechSynthesisVoice | null {
  const excludeKey = exclude ? voiceKey(exclude) : null;
  const usable = excludeKey ? voices.filter(v => voiceKey(v) !== excludeKey) : voices;
  const german = usable.filter(v => v.lang?.toLowerCase().startsWith('de'));
  const badKeys = loadBadVoiceKeys();
  const isDeprioritized = (v: SpeechSynthesisVoice) => isKnownFlakyVoice(v) || badKeys.has(voiceKey(v));
  // Non-flaky/non-confirmed-bad candidates first, deprioritized ones only
  // as a last resort within each tier — one is still better than nothing
  // if it's truly the only voice available for this tier.
  const localGerman = [...german.filter(v => v.localService && !isDeprioritized(v)), ...german.filter(v => v.localService && isDeprioritized(v))];
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
  // Real gap a report caught: this always filed as "(signed out)" even
  // for a genuinely signed-in learner, because it hardcoded user_id/email
  // to null instead of reading the real session — unlike BugReportButton's
  // manual flow, which does. Same fix as reportChimeError/
  // handleAiUnreachable's own copies of this mistake.
  supabase.auth.getSession().then(({ data }) => {
    supabase.from('bug_reports').insert({
      user_id: data.session?.user.id ?? null,
      email: data.session?.user.email ?? null,
      message: `Auto-detected: speechSynthesis error while speaking a sentence/word (${detail}). [${diagnostics}]`,
      page_path: window.location.pathname,
      user_agent: navigator.userAgent,
    }).then(() => {}, () => {});
  }, () => {});
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
  // Fires exactly once, at whichever point this gives up for good (same
  // two spots reportTtsError already fires from) — lets a caller show
  // something on screen instead of the total silence a failure otherwise
  // looks like (see SpeakerButton). Never fires for isPageHidden/no-
  // speechSynthesis-support below: those aren't failures the learner is
  // even looking at the button to see, just a deliberate no-op.
  onFailure?: () => void,
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
    // Learn from this immediately, on the FIRST attempt too, not just
    // after a retry also fails — see markVoiceBad's own comment for why
    // waiting until then left every future word paying the same ~2s
    // fail-then-retry cost forever instead of just once per bad voice.
    markVoiceBad(voice);
    if (isRetry) { reportTtsError(e.error, voice); onFailure?.(); }
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
  //
  // Real, still-recurring reports named the SAME voice as the retry's own
  // choice even after voice selection itself was fixed and verified
  // correct in isolation — but every single one of those reports also
  // showed `speaking=true` at the failure moment, which is the more
  // consistent signal: the engine believes something is already playing
  // and won't accept a new utterance, independent of which voice is
  // asked for. Two adjustments follow from that, not another voice-logic
  // change: (1) 2000ms may simply be too impatient for a genuinely slow-
  // but-working first utterance in a session (some engines take a real
  // moment to spin up) — raised to give onstart more room to fire before
  // this cancels a perfectly good utterance out from under itself, which
  // would look exactly like "needs several taps" from the outside: each
  // premature cancel-and-retry throws away an utterance that might have
  // played fine a moment later. (2) cancel() is asynchronous in some
  // engines — calling speak() again immediately afterward can race the
  // cancellation still being processed and get silently dropped; a short
  // delay between them gives it room to actually complete first.
  let started = false;
  utterance.onstart = () => { started = true; };
  setTimeout(() => {
    if (started) return;
    // Same supersession check as onerror above — a route change or
    // tab-hide since this was scheduled means there's deliberately
    // nothing left to retry for.
    if (speechGeneration !== myGeneration) return;
    // Same "learn immediately" reasoning as onerror above.
    markVoiceBad(voice);
    if (isRetry) { reportTtsError('never started (after retry)', voice); onFailure?.(); return; }
    window.speechSynthesis.cancel();
    setTimeout(() => {
      if (speechGeneration !== myGeneration) return;
      speakWithBrowserVoice(text, true, voice, onEnd, onFailure);
    }, 200);
  }, 3500);
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
function speakWordOnce(word: Word, onEnded?: () => void, onFailure?: () => void, allowAudioGeneration = true): void {
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
    // allowAudioGeneration=false is for a word that isn't real/saved yet
    // (the Word List's own lookup PREVIEW, before "Add to my words" is
    // even tapped — see app/words/page.tsx) — confirmed real: without
    // this, tapping the preview's speaker generated and cached audio
    // under that preview's placeholder id, and a LATER, DIFFERENT
    // preview reusing the same placeholder id would then incorrectly
    // play the FIRST word's cached pronunciation instead of its own.
    if (allowAudioGeneration && isCustomWordId(word.id) && !audioGenerationAttempted.has(word.id)) {
      audioGenerationAttempted.add(word.id);
      generateWordAudio(word.id, spokenForm(word));
    }
    speakWithBrowserVoice(spokenForm(word), false, null, onEnded, onFailure);
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
// onFailure (optional, additive — every existing call site keeps working
// unchanged without it) fires once if this word never actually managed to
// play at all, on any repeat — see SpeakerButton's own use of it to show
// something other than total silence, which is the exact "I don't hear
// anything" shape a real report caught. A word with a pre-recorded
// clip essentially never hits this (only if that file AND the browser TTS
// fallback both fail); a learner-added custom word has no clip of its own
// at all, so it leans on the fallback's own reliability every single time.
// allowAudioGeneration=false for a word that isn't actually saved yet
// (see speakWordOnce's own comment) — every existing call site keeps its
// current behavior unchanged since this defaults to true.
export function speakWord(word: Word, onFailure?: () => void, allowAudioGeneration = true): void {
  const myChain = ++wordChainGeneration;
  const times = Math.max(1, Math.min(5, Math.round(getSettings().wordRepeatCount ?? 1)));
  let played = 0;
  const playNext = () => {
    if (wordChainGeneration !== myChain) return;
    played++;
    speakWordOnce(word, played < times ? () => setTimeout(playNext, WORD_REPEAT_GAP_MS) : undefined, onFailure, allowAudioGeneration);
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
