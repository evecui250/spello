'use client';

import { getSoundChoice, SoundChoice } from './storage';

// Short, synthesized "correct!" chimes — plain Web Audio oscillators, no
// external audio file or API (no asset to host/license, identical tone on
// every device, nothing to wait on). These 5 are the owner's favorites out
// of an original 10 candidates previewed on the admin page, now selectable
// in Settings (see SOUND_KEY). Played from every real "the learner got
// this right" moment across the app — see call sites in DailySessionFlow
// (spelling check, MCQ answer, a perfect sentence correction) and
// MatchingQuizPage (finishing a matching round).

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

// A freshly-created (or long-idle) AudioContext starts/settles back into
// 'suspended' until resumed — resume() is async, and scheduling tones
// against ctx.currentTime before it actually finishes resuming was the
// real cause of the chime intermittently going silent (confirmed real:
// "sometimes I don't get the chime"). Awaiting this before scheduling
// anything guarantees the context is actually running first.
async function ensureRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  // TS narrows ctx.state's type from the check above and doesn't account
  // for it changing across the `await` — reading it through an unknown
  // AudioContextState avoids a bogus "no overlap" compile error.
  return (ctx.state as AudioContextState) === 'running';
}

function tone(
  ctx: AudioContext, dest: AudioNode, freq: number, start: number, dur: number,
  opts: { type?: OscillatorType; gain?: number; attack?: number; endFreq?: number } = {},
) {
  const { type = 'sine', gain = 0.3, attack = 0.006, endFreq } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function warmDestination(ctx: AudioContext, freq = 5000): AudioNode {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  filter.connect(ctx.destination);
  return filter;
}

const G4 = 392.0, A4 = 440.0, C5 = 523.25, E5 = 659.25, G5 = 784.0, C6 = 1046.5;

export interface ChimeOption {
  id: SoundChoice;
  name: string;
  play: (ctx: AudioContext) => void;
}

export const CHIME_OPTIONS: ChimeOption[] = [
  {
    id: 'soft-two-note',
    name: 'Soft Two-Note',
    play(ctx) {
      const d = warmDestination(ctx, 4500);
      const t = ctx.currentTime;
      tone(ctx, d, G4, t, 0.24, { gain: 0.3 });
      tone(ctx, d, C5, t + 0.1, 0.3, { gain: 0.32 });
    },
  },
  {
    id: 'triad-bloom',
    name: 'Triad Bloom',
    play(ctx) {
      const d = warmDestination(ctx, 5000);
      const t = ctx.currentTime;
      tone(ctx, d, C5, t, 0.42, { gain: 0.2 });
      tone(ctx, d, E5, t + 0.015, 0.42, { gain: 0.2 });
      tone(ctx, d, G5, t + 0.03, 0.48, { gain: 0.22 });
    },
  },
  {
    id: 'rising-glow',
    name: 'Rising Glow',
    play(ctx) {
      const d = warmDestination(ctx, 5000);
      const t = ctx.currentTime;
      tone(ctx, d, G4, t, 0.12, { gain: 0.28 });
      tone(ctx, d, A4, t + 0.07, 0.12, { gain: 0.28 });
      tone(ctx, d, C5, t + 0.14, 0.32, { gain: 0.32 });
    },
  },
  {
    id: 'double-ding',
    name: 'Double Ding',
    play(ctx) {
      const d = warmDestination(ctx, 5500);
      const t = ctx.currentTime;
      tone(ctx, d, G5, t, 0.24, { gain: 0.3 });
      tone(ctx, d, C6, t + 0.11, 0.32, { gain: 0.32 });
    },
  },
  {
    id: 'soft-tap',
    name: 'Soft Tap',
    play(ctx) {
      const tickDest = warmDestination(ctx, 6000);
      const bodyDest = warmDestination(ctx, 4000);
      const t = ctx.currentTime;
      tone(ctx, tickDest, E5, t, 0.06, { type: 'triangle', gain: 0.16 });
      tone(ctx, bodyDest, C5, t + 0.04, 0.36, { gain: 0.3 });
    },
  },
];

export function playChime(id: SoundChoice): void {
  const ctx = getCtx();
  if (!ctx) return;
  const option = CHIME_OPTIONS.find(o => o.id === id) ?? CHIME_OPTIONS[1];
  // Fire-and-forget from the caller's side (every call site here is a
  // void context) — but internally this always waits for the context to
  // actually be running before scheduling a single oscillator.
  (async () => {
    const ok = await ensureRunning(ctx);
    if (!ok) return;
    try {
      option.play(ctx);
    } catch {
      // Best-effort — a sound glitch should never break the actual
      // exercise flow it's celebrating.
    }
  })();
}

export function playCorrectChime(): void {
  playChime(getSoundChoice());
}
