'use client';

// A short, synthesized "correct!" chime — plain Web Audio oscillators, no
// external audio file or API (no asset to host/license, identical tone on
// every device, nothing to wait on). Picked by the owner as their
// favorite ("Triad Bloom") out of 10 candidates previewed on the admin
// page; played from every real "the learner got this right" moment across
// the app — see call sites in DailySessionFlow (spelling check, MCQ
// answer, a perfect sentence correction) and MatchingQuizPage (finishing
// a matching round).

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

function tone(
  ctx: AudioContext, dest: AudioNode, freq: number, start: number, dur: number,
  gain: number, attack = 0.006,
) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

const C5 = 523.25, E5 = 659.25, G5 = 784.0;

export function playCorrectChime(): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 5000;
    filter.connect(ctx.destination);
    const t = ctx.currentTime;
    tone(ctx, filter, C5, t, 0.42, 0.2);
    tone(ctx, filter, E5, t + 0.015, 0.42, 0.2);
    tone(ctx, filter, G5, t + 0.03, 0.48, 0.22);
  } catch {
    // Best-effort — a sound glitch should never break the actual exercise
    // flow it's celebrating.
  }
}
