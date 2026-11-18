'use client';

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { transcribeSpeech, DailyLimitReachedError } from '../lib/ai';

// Voice entry for the sentence step: a mic icon inside the sentence box
// (like a chat app's). Tap to record, tap again to stop; the text lands in
// the box (see onText) for the learner to edit before pressing Check.
// Renders nothing where the browser can't record.

const MAX_SECONDS = 30;

// Safari/iOS records mp4, Chrome/Firefox webm/ogg — the first one this
// browser supports.
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find(t => MediaRecorder.isTypeSupported?.(t));
}

export default function VoiceInputButton({ wordId, nativeLanguage, disabled, onText, onError, className = '' }: {
  wordId: string;
  // The learner's own language — words they say in it are kept as spoken.
  nativeLanguage: 'en' | 'zh';
  disabled?: boolean;
  onText: (text: string) => void;
  // A message to show near the box, or null to clear it.
  onError: (message: string | null) => void;
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aliveRef = useRef(true);

  useEffect(() => {
    // An iOS build from before the microphone permission (no "SpelloApp/mic"
    // in its user agent, see capacitor.config.ts) would crash on asking.
    const nativeWithoutMic = Capacitor.isNativePlatform() && !navigator.userAgent.includes('SpelloApp/mic');
    setSupported(!nativeWithoutMic && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  if (!supported) return null;

  async function start() {
    onError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Microphone access is off. Allow it in your browser or phone settings to speak your sentence.');
      return;
    }
    streamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      clearTimeout(timerRef.current);
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      if (!aliveRef.current) return;
      if (blob.size < 1000) { setState('idle'); return; } // a tap, not speech
      setState('transcribing');
      try {
        const text = await transcribeSpeech(blob, wordId, nativeLanguage);
        if (!aliveRef.current) return;
        if (text) onText(text);
        else onError("Didn't catch that — try again a little louder.");
      } catch (e) {
        if (!aliveRef.current) return;
        onError(e instanceof DailyLimitReachedError ? "You've reached today's AI limit — type it instead." : "Couldn't turn that into text. Try again, or type it.");
      } finally {
        if (aliveRef.current) setState('idle');
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setState('recording');
    timerRef.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, MAX_SECONDS * 1000);
  }

  function stop() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }

  const label = state === 'recording' ? 'Stop recording' : state === 'transcribing' ? 'Turning speech into text' : 'Speak your sentence';
  return (
    <button
      type="button"
      onClick={state === 'recording' ? stop : start}
      disabled={disabled || state === 'transcribing'}
      aria-label={label}
      title={label}
      className={`w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-50 ${
        state === 'recording' ? 'bg-clay text-white animate-pulse' : 'text-ink-soft hover:text-label hover:bg-accent/15'
      } ${className}`}
    >
      {state === 'transcribing' ? (
        <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
      ) : (
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {state === 'recording'
            ? <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
            : <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>}
        </svg>
      )}
    </button>
  );
}
