'use client';

// TEMPORARY — a pick-one preview for the "correct answer" chime discussed
// with the owner (a Duolingo-style "dang dang~" on a correct answer, but
// synthesized rather than sourced from a sound-effects site: no asset to
// license/host, identical volume/tone on every device, instant to load).
// Every candidate is built from plain oscillators/gain envelopes — no
// external API, no audio files. Delete this component and its one call
// site in app/admin/page.tsx once a favorite is picked and wired into the
// real correct-answer moment in DailySessionFlow.

let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

type OscType = 'sine' | 'triangle' | 'square' | 'sawtooth';

// One note: linear attack up to `gain`, exponential decay down to near-
// silence by `start + dur`. exponentialRampToValueAtTime can't target
// exactly 0, hence the 0.0001 floor.
function tone(
  ctx: AudioContext, dest: AudioNode, freq: number, start: number, dur: number,
  opts: { type?: OscType; gain?: number; attack?: number; endFreq?: number } = {},
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

// Shared gentle low-pass on every preset's own output node — takes the
// harsh edge off a raw oscillator so nothing here reads as a sharp beep,
// per the "not too sharp" ask.
function warmDestination(ctx: AudioContext, freq = 7000): AudioNode {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  filter.connect(ctx.destination);
  return filter;
}

// C6/D6/E6/G6/A6/C7 — a small pentatonic-ish palette, so any combination
// of notes below already sounds pleasant together rather than clashing.
const C6 = 1046.5, D6 = 1174.7, E6 = 1318.5, G6 = 1568.0, A6 = 1760.0, C7 = 2093.0;
const G5 = 784.0, A5 = 880.0, C6b = C6;

export interface ChimePreset {
  id: string;
  name: string;
  blurb: string;
  play: (ctx: AudioContext) => void;
}

export const CHIME_PRESETS: ChimePreset[] = [
  {
    id: 'soft-two-note',
    name: '1. Soft Two-Note',
    blurb: 'A gentle two-note "ta-da", softer and lower than the classic app chime.',
    play(ctx) {
      const d = warmDestination(ctx, 6000);
      const t = ctx.currentTime;
      tone(ctx, d, C6, t, 0.22, { gain: 0.28 });
      tone(ctx, d, E6, t + 0.09, 0.28, { gain: 0.3 });
    },
  },
  {
    id: 'triad-bloom',
    name: '2. Triad Bloom',
    blurb: 'Three notes blooming together into a soft chord, like a small "yes!"',
    play(ctx) {
      const d = warmDestination(ctx, 6500);
      const t = ctx.currentTime;
      tone(ctx, d, C6, t, 0.4, { gain: 0.18 });
      tone(ctx, d, E6, t + 0.015, 0.4, { gain: 0.18 });
      tone(ctx, d, G6, t + 0.03, 0.45, { gain: 0.2 });
    },
  },
  {
    id: 'bell-pluck',
    name: '3. Bell Pluck',
    blurb: 'One warm bell-like note with a faint inharmonic overtone, quick decay.',
    play(ctx) {
      const d = warmDestination(ctx, 9000);
      const t = ctx.currentTime;
      tone(ctx, d, A5, t, 0.45, { type: 'triangle', gain: 0.32 });
      tone(ctx, d, A5 * 2.4, t, 0.25, { type: 'sine', gain: 0.06 });
    },
  },
  {
    id: 'rising-sparkle',
    name: '4. Rising Sparkle',
    blurb: 'Three quick ascending notes with a light shimmer on the last one.',
    play(ctx) {
      const d = warmDestination(ctx, 8000);
      const t = ctx.currentTime;
      tone(ctx, d, C6, t, 0.11, { gain: 0.26 });
      tone(ctx, d, D6, t + 0.07, 0.11, { gain: 0.26 });
      tone(ctx, d, G6, t + 0.14, 0.3, { gain: 0.3 });
      tone(ctx, d, G6 * 2, t + 0.14, 0.2, { gain: 0.05 });
    },
  },
  {
    id: 'marimba-pop',
    name: '5. Marimba Pop',
    blurb: 'A single soft "pop" with a little downward pitch slide, like a wooden mallet.',
    play(ctx) {
      const d = warmDestination(ctx, 5500);
      const t = ctx.currentTime;
      tone(ctx, d, G5, t, 0.22, { type: 'sine', gain: 0.34, endFreq: G5 * 0.85 });
    },
  },
  {
    id: 'gentle-arpeggio',
    name: '6. Gentle Arpeggio',
    blurb: 'A soft four-note harp-like run, overlapping as it climbs.',
    play(ctx) {
      const d = warmDestination(ctx, 6500);
      const t = ctx.currentTime;
      [C6, E6, G6, C7].forEach((f, i) => {
        tone(ctx, d, f, t + i * 0.05, 0.35, { type: 'triangle', gain: 0.2 });
      });
    },
  },
  {
    id: 'double-ding-soft',
    name: '7. Double Ding (soft)',
    blurb: 'The familiar two-note "ding-ding" shape, pitched lower and rounder.',
    play(ctx) {
      const d = warmDestination(ctx, 5500);
      const t = ctx.currentTime;
      tone(ctx, d, G5, t, 0.24, { gain: 0.3 });
      tone(ctx, d, C6b, t + 0.11, 0.32, { gain: 0.32 });
    },
  },
  {
    id: 'crystal-tap',
    name: '8. Crystal Tap',
    blurb: 'A tiny high tick followed by a warm resonant tone underneath.',
    play(ctx) {
      const tickDest = warmDestination(ctx, 11000);
      const bodyDest = warmDestination(ctx, 5000);
      const t = ctx.currentTime;
      tone(ctx, tickDest, C7, t, 0.05, { type: 'triangle', gain: 0.14 });
      tone(ctx, bodyDest, C6, t + 0.04, 0.35, { gain: 0.28 });
    },
  },
  {
    id: 'soft-fifth',
    name: '9. Soft Fifth Chord',
    blurb: 'Two notes a fifth apart, ringing together softly — calm, not showy.',
    play(ctx) {
      const d = warmDestination(ctx, 6000);
      const t = ctx.currentTime;
      tone(ctx, d, C6, t, 0.32, { gain: 0.22 });
      tone(ctx, d, G6, t, 0.34, { gain: 0.22 });
    },
  },
  {
    id: 'playful-bounce',
    name: '10. Playful Bounce',
    blurb: 'A quick upward pitch bend on one note — small, bouncy, a bit cheeky.',
    play(ctx) {
      const d = warmDestination(ctx, 6500);
      const t = ctx.currentTime;
      tone(ctx, d, 600, t, 0.16, { type: 'triangle', gain: 0.3, endFreq: 950 });
    },
  },
];

export default function SoundEffectPicker() {
  function handlePlay(preset: ChimePreset) {
    const ctx = getCtx();
    preset.play(ctx);
  }

  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
      <div>
        <h2 className="font-semibold text-stone-800">🔊 Correct-answer sound — pick one (temporary)</h2>
        <p className="text-stone-400 text-xs -mt-0.5">
          10 synthesized candidates for the &quot;correct!&quot; chime. Tap to preview each — let me know the number you like.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CHIME_PRESETS.map(preset => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handlePlay(preset)}
            className="text-left bg-white/70 hover:bg-white rounded-xl border border-amber-100/60 px-3.5 py-3 transition-colors active:scale-[0.98]"
          >
            <div className="font-medium text-stone-800 text-sm flex items-center gap-1.5">
              <span aria-hidden>▶️</span>{preset.name}
            </div>
            <div className="text-stone-500 text-xs mt-0.5">{preset.blurb}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
