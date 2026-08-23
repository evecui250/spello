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

// C4 through C6 — a small pentatonic-ish palette in a lower, warmer
// register than the first round of candidates (owner feedback: #7 — G5
// to C6 — was the only one pitched right; everything above C6 read as
// too high). Nothing below now goes higher than #7's own C6 ceiling.
const C4 = 261.63, E4 = 329.63, G4 = 392.0, A4 = 440.0;
const C5 = 523.25, E5 = 659.25, G5 = 784.0, A5 = 880.0, C6 = 1046.5;

export interface ChimePreset {
  id: string;
  name: string;
  blurb: string;
  play: (ctx: AudioContext) => void;
}

export const CHIME_PRESETS: ChimePreset[] = [
  {
    id: 'soft-two-note-v2',
    name: '1. Soft Two-Note',
    blurb: 'A gentle two-note "ta-da", a full octave lower and mellower than the first version.',
    play(ctx) {
      const d = warmDestination(ctx, 4500);
      const t = ctx.currentTime;
      tone(ctx, d, G4, t, 0.24, { gain: 0.3 });
      tone(ctx, d, C5, t + 0.1, 0.3, { gain: 0.32 });
    },
  },
  {
    id: 'triad-bloom-v2',
    name: '2. Triad Bloom',
    blurb: 'Three notes blooming together into a warm chord, like a small "yes!"',
    play(ctx) {
      const d = warmDestination(ctx, 5000);
      const t = ctx.currentTime;
      tone(ctx, d, C5, t, 0.42, { gain: 0.2 });
      tone(ctx, d, E5, t + 0.015, 0.42, { gain: 0.2 });
      tone(ctx, d, G5, t + 0.03, 0.48, { gain: 0.22 });
    },
  },
  {
    id: 'bell-pluck-v2',
    name: '3. Bell Pluck',
    blurb: 'One warm, low bell-like note with a faint overtone, quick decay.',
    play(ctx) {
      const d = warmDestination(ctx, 6000);
      const t = ctx.currentTime;
      tone(ctx, d, E4, t, 0.48, { type: 'triangle', gain: 0.34 });
      tone(ctx, d, E4 * 2.4, t, 0.26, { type: 'sine', gain: 0.06 });
    },
  },
  {
    id: 'rising-glow',
    name: '4. Rising Glow',
    blurb: 'Three quick ascending notes, warm rather than sparkly, settling on a soft landing.',
    play(ctx) {
      const d = warmDestination(ctx, 5000);
      const t = ctx.currentTime;
      tone(ctx, d, G4, t, 0.12, { gain: 0.28 });
      tone(ctx, d, A4, t + 0.07, 0.12, { gain: 0.28 });
      tone(ctx, d, C5, t + 0.14, 0.32, { gain: 0.32 });
    },
  },
  {
    id: 'marimba-pop-v2',
    name: '5. Marimba Pop',
    blurb: 'A single low, soft "pop" with a little downward pitch slide, like a wooden mallet.',
    play(ctx) {
      const d = warmDestination(ctx, 4000);
      const t = ctx.currentTime;
      tone(ctx, d, C4, t, 0.24, { type: 'sine', gain: 0.36, endFreq: C4 * 0.85 });
    },
  },
  {
    id: 'gentle-arpeggio-v2',
    name: '6. Gentle Arpeggio',
    blurb: 'A soft four-note harp-like run, climbing up to meet #7\'s own top note.',
    play(ctx) {
      const d = warmDestination(ctx, 5000);
      const t = ctx.currentTime;
      [C5, E5, G5, C6].forEach((f, i) => {
        tone(ctx, d, f, t + i * 0.055, 0.35, { type: 'triangle', gain: 0.22 });
      });
    },
  },
  {
    id: 'double-ding-soft',
    name: '7. Double Ding (soft) — your pick, unchanged',
    blurb: 'The familiar two-note "ding-ding" shape, pitched lower and rounder.',
    play(ctx) {
      const d = warmDestination(ctx, 5500);
      const t = ctx.currentTime;
      tone(ctx, d, G5, t, 0.24, { gain: 0.3 });
      tone(ctx, d, C6, t + 0.11, 0.32, { gain: 0.32 });
    },
  },
  {
    id: 'soft-tap',
    name: '8. Soft Tap',
    blurb: 'A gentle tick followed by a warm resonant tone underneath — no longer a sharp high tick.',
    play(ctx) {
      const tickDest = warmDestination(ctx, 6000);
      const bodyDest = warmDestination(ctx, 4000);
      const t = ctx.currentTime;
      tone(ctx, tickDest, E5, t, 0.06, { type: 'triangle', gain: 0.16 });
      tone(ctx, bodyDest, C5, t + 0.04, 0.36, { gain: 0.3 });
    },
  },
  {
    id: 'soft-fifth-v2',
    name: '9. Soft Fifth Chord',
    blurb: 'Two notes a fifth apart, ringing together softly in a lower register — calm, not showy.',
    play(ctx) {
      const d = warmDestination(ctx, 4500);
      const t = ctx.currentTime;
      tone(ctx, d, C5, t, 0.34, { gain: 0.24 });
      tone(ctx, d, G5, t, 0.36, { gain: 0.24 });
    },
  },
  {
    id: 'playful-bounce-v2',
    name: '10. Playful Bounce',
    blurb: 'A quick upward pitch bend on one note, in a lower range — bouncy without being squeaky.',
    play(ctx) {
      const d = warmDestination(ctx, 4500);
      const t = ctx.currentTime;
      tone(ctx, d, 300, t, 0.18, { type: 'triangle', gain: 0.32, endFreq: 450 });
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
