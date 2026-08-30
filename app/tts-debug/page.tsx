'use client';

import { useEffect, useRef, useState } from 'react';

// A real diagnostic tool, not a guess-and-ship fix — after several rounds
// of "this should fix it" that didn't, the honest next step is to stop
// guessing and let the actual device tell us which voice/strategy really
// works. Every test here is self-contained (its own utterance, its own
// timing) and reports exactly what happened, so a real answer ("voice X
// starts instantly, voice Y never starts") can come back instead of
// another round of speculation.

type TestStatus = 'idle' | 'testing' | 'started' | 'never-started' | 'error';

interface TestResult {
  status: TestStatus;
  ms?: number;
  detail?: string;
}

const TEST_PHRASE = 'Das ist ein Test.';
const NEVER_STARTED_AFTER_MS = 5000;

function runTest(
  voice: SpeechSynthesisVoice | null,
  onUpdate: (r: TestResult) => void,
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onUpdate({ status: 'error', detail: 'speechSynthesis not supported' });
    return;
  }
  const synth = window.speechSynthesis;
  onUpdate({ status: 'testing' });
  const utterance = new SpeechSynthesisUtterance(TEST_PHRASE);
  utterance.lang = 'de-DE';
  if (voice) utterance.voice = voice;
  const start = performance.now();
  let settled = false;
  utterance.onstart = () => {
    if (settled) return;
    settled = true;
    onUpdate({ status: 'started', ms: Math.round(performance.now() - start) });
  };
  utterance.onerror = (e) => {
    if (settled) return;
    settled = true;
    onUpdate({ status: 'error', detail: e.error, ms: Math.round(performance.now() - start) });
  };
  setTimeout(() => {
    if (settled) return;
    settled = true;
    onUpdate({ status: 'never-started', ms: NEVER_STARTED_AFTER_MS });
  }, NEVER_STARTED_AFTER_MS);
  // No cancel-before-speak, no retry, no voice-selection logic at all —
  // deliberately the rawest possible call, so a result here reflects the
  // browser/voice itself, not any of this app's own retry machinery on
  // top of it.
  try {
    synth.speak(utterance);
  } catch (err) {
    if (!settled) {
      settled = true;
      onUpdate({ status: 'error', detail: String(err) });
    }
  }
}

// Real app usage never calls speak() in isolation for a custom word — it
// first tries a pre-recorded <audio> element, which 404s, THEN falls back
// to speak(). This replicates that exact sequence (real failed network
// audio load immediately before the speech call) to test whether that
// transition specifically — not the voice choice itself — is what's
// putting the engine into a bad state, since a raw/isolated test of every
// voice found none of them broken on their own.
function runTestAfter404(
  voice: SpeechSynthesisVoice | null,
  onUpdate: (r: TestResult) => void,
): void {
  onUpdate({ status: 'testing' });
  let proceeded = false;
  const audio = new Audio('https://example.invalid/nonexistent-audio-file-404.mp3');
  const proceed = () => {
    if (proceeded) return;
    proceeded = true;
    runTest(voice, onUpdate);
  };
  audio.addEventListener('error', proceed, { once: true });
  // Defensive: if the "error" event somehow never fires (e.g. blocked at
  // DNS level with no error surfaced), don't hang the test forever.
  setTimeout(proceed, 3000);
  audio.play().catch(() => { /* the addEventListener('error', ...) above handles it */ });
}

function StatusBadge({ result }: { result: TestResult }) {
  if (result.status === 'idle') return <span className="text-stone-400 text-xs">Not tested yet</span>;
  if (result.status === 'testing') return <span className="text-indigo-500 text-xs">Testing…</span>;
  if (result.status === 'started') return <span className="text-green-600 text-xs font-semibold">✓ Started in {result.ms}ms</span>;
  if (result.status === 'never-started') return <span className="text-red-500 text-xs font-semibold">✗ Never started (after {(result.ms ?? 0) / 1000}s)</span>;
  return <span className="text-red-500 text-xs font-semibold">✗ Error: {result.detail}</span>;
}

export default function TtsDebugPage() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [after404Voice, setAfter404Voice] = useState('');
  const loadedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      if (list.length > 0) {
        setVoices(list);
        loadedRef.current = true;
      }
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    // Some browsers never fire voiceschanged if voices were already ready
    // — a couple of delayed retries catches that without polling forever.
    const t1 = setTimeout(load, 300);
    const t2 = setTimeout(load, 1000);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', load);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const germanVoices = voices.filter(v => v.lang?.toLowerCase().startsWith('de'));
  const otherVoices = voices.filter(v => !v.lang?.toLowerCase().startsWith('de'));

  useEffect(() => {
    if (!after404Voice && germanVoices.length > 0) {
      setAfter404Voice(`${germanVoices[0].name}|${germanVoices[0].lang}`);
    }
  }, [germanVoices, after404Voice]);

  const test = (key: string, voice: SpeechSynthesisVoice | null) => {
    setResults(r => ({ ...r, [key]: { status: 'testing' } }));
    runTest(voice, result => setResults(r => ({ ...r, [key]: result })));
  };

  const VoiceRow = ({ voice, keyPrefix }: { voice: SpeechSynthesisVoice; keyPrefix: string }) => {
    const key = `${keyPrefix}-${voice.name}-${voice.lang}`;
    const result = results[key] ?? { status: 'idle' as const };
    return (
      <div data-voice-row={key} className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-stone-800 truncate">{voice.name}</div>
          <div className="text-stone-500 text-xs">{voice.lang} · {voice.localService ? 'local' : 'network'}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <StatusBadge result={result} />
          <button
            onClick={() => test(key, voice)}
            disabled={result.status === 'testing'}
            className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
          >
            Test
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
        Audio Diagnostics
      </h1>
      <p className="text-amber-100/80 text-sm">
        Tap "Test" next to each voice below — each one plays "{TEST_PHRASE}" using ONLY that exact
        voice, with no retry or fallback logic at all. Tell me exactly which ones say
        "✓ Started" immediately and which say "✗ Never started" or "✗ Error" — that tells us which
        specific voice(s) on your device are actually broken, instead of guessing.
      </p>

      {voices.length === 0 && (
        <p className="text-amber-200 text-sm">Loading voice list…</p>
      )}

      {germanVoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-amber-100 font-semibold text-sm uppercase tracking-wide">German voices</h2>
          {germanVoices.map(v => <VoiceRow key={`de-${v.name}-${v.lang}`} voice={v} keyPrefix="de" />)}
        </div>
      )}

      {otherVoices.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-amber-100 font-semibold text-sm uppercase tracking-wide">Other voices (for comparison)</h2>
          {otherVoices.map(v => <VoiceRow key={`other-${v.name}-${v.lang}`} voice={v} keyPrefix="other" />)}
        </div>
      )}

      <div className="flex flex-col gap-2 mt-2">
        <h2 className="text-amber-100 font-semibold text-sm uppercase tracking-wide">Strategy tests</h2>

        <div className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-stone-800">No voice specified</div>
            <div className="text-stone-500 text-xs">Lets the browser pick its own default for "de-DE" instead of us choosing one</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <StatusBadge result={results['strategy-novoice'] ?? { status: 'idle' }} />
            <button
              onClick={() => test('strategy-novoice', null)}
              disabled={results['strategy-novoice']?.status === 'testing'}
              className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
            >
              Test
            </button>
          </div>
        </div>

        {germanVoices.length > 0 && (
          <div data-testid="strategy-after404-block" className="bg-amber-50/75 backdrop-blur-sm rounded-xl border border-amber-100/50 shadow-sm px-4 py-3 flex flex-col gap-3">
            <div>
              <div className="font-semibold text-stone-800">Right after a failed audio load</div>
              <div className="text-stone-500 text-xs">
                Real custom words first try a pre-recorded clip that doesn't exist yet, THEN fall back
                to this — replicates that exact sequence instead of testing speech alone, in case the
                failed load itself (not the voice) is what's putting things in a bad state.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={after404Voice}
                onChange={e => setAfter404Voice(e.target.value)}
                className="min-w-0 flex-1 bg-white/80 border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-stone-800"
              >
                {germanVoices.map(v => (
                  <option key={`sel-${v.name}-${v.lang}`} value={`${v.name}|${v.lang}`}>{v.name}</option>
                ))}
              </select>
              <StatusBadge result={results['strategy-after404'] ?? { status: 'idle' }} />
              <button
                onClick={() => {
                  const voice = germanVoices.find(v => `${v.name}|${v.lang}` === after404Voice) ?? null;
                  setResults(r => ({ ...r, 'strategy-after404': { status: 'testing' } }));
                  runTestAfter404(voice, result => setResults(r => ({ ...r, 'strategy-after404': result })));
                }}
                disabled={results['strategy-after404']?.status === 'testing'}
                className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 shrink-0"
              >
                Test
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="text-amber-100/60 text-xs mt-2">
        This page doesn't fix anything by itself — it's just measuring. Once you tell me which
        voice(s) actually work, I can make the app always pick one of those first on your device.
      </p>
    </div>
  );
}
