'use client';

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { transcribeSpeech, DailyLimitReachedError } from '../lib/ai';

// Voice entry for the sentence step: tap to record, tap again to stop;
// the text lands in the sentence box (see onText) for the learner to
// check and edit before pressing Check. Renders nothing where the browser
// can't record (no MediaRecorder/getUserMedia).

const MAX_SECONDS = 30;

// Safari/iOS records mp4, Chrome/Firefox webm/ogg — the first one this
// browser supports.
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find(t => MediaRecorder.isTypeSupported?.(t));
}

export default function VoiceInputButton({ wordId, disabled, onText }: {
  wordId: string;
  disabled?: boolean;
  onText: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const aliveRef = useRef(true);

  useEffect(() => {
    // An iOS build from before the microphone permission (no "SpelloApp/mic"
    // in its user agent, see capacitor.config.ts) would crash on asking.
    const nativeWithoutMic = Capacitor.isNativePlatform() && !navigator.userAgent.includes('SpelloApp/mic');
    setSupported(!nativeWithoutMic && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
    return () => {
      aliveRef.current = false;
      clearInterval(timerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  if (!supported) return null;

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is off. Allow it in your browser or phone settings to speak your sentence.');
      return;
    }
    streamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      clearInterval(timerRef.current);
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      if (!aliveRef.current) return;
      if (blob.size < 1000) { setState('idle'); return; } // a tap, not speech
      setState('transcribing');
      try {
        const text = await transcribeSpeech(blob, wordId);
        if (!aliveRef.current) return;
        if (text) onText(text);
        else setError("Didn't catch that — try again a little louder.");
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof DailyLimitReachedError ? "You've reached today's AI limit — type it instead." : "Couldn't turn that into text. Try again, or type it.");
      } finally {
        if (aliveRef.current) setState('idle');
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setSeconds(0);
    setState('recording');
    timerRef.current = setInterval(() => {
      setSeconds(s => {
        if (s + 1 >= MAX_SECONDS && recorder.state === 'recording') recorder.stop();
        return s + 1;
      });
    }, 1000);
  }

  function stop() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={state === 'recording' ? stop : start}
        disabled={disabled || state === 'transcribing'}
        aria-label={state === 'recording' ? 'Stop recording' : 'Say your sentence'}
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 ${
          state === 'recording' ? 'bg-clay text-white animate-pulse' : 'bg-accent/15 text-label hover:bg-accent/25'
        }`}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {state === 'recording'
            ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            : <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>}
        </svg>
        {state === 'recording' ? `Stop · ${seconds}s` : state === 'transcribing' ? 'Listening…' : 'Say it instead'}
      </button>
      {error && <p className="text-clay text-xs text-center">{error}</p>}
    </div>
  );
}
