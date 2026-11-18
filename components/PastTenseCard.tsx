'use client';

import { useEffect, useRef, useState } from 'react';
import { Word, glossFor } from '../lib/words';
import { checkAnswer } from '../lib/practice';
import { perfectFormOf } from '../lib/pastTense';
import { speakSentence, stopSpeech } from '../lib/speech';
import { playCorrectChime } from '../lib/sound';
import SpeakerButton from './SpeakerButton';
import SpecialCharButtons from './SpecialCharButtons';

// One verb of review's "Past tense" step (see lib/pastTense.ts):
// "er kauft -> er [hat|ist] ______". The present form is the only hint —
// no letters of the participle are given. Check works with nothing
// filled in (a miss, with the answer shown), same as the spelling cards.
export default function PastTenseCard({ word, nativeLanguage, position, total, onDone }: {
  word: Word;
  nativeLanguage: 'en' | 'zh';
  position: number;
  total: number;
  onDone: (correct: boolean) => void;
}) {
  const form = perfectFormOf(word)!;
  const [aux, setAux] = useState<'hat' | 'ist' | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const answer = `er ${word.perfectTense}`;

  useEffect(() => () => stopSpeech(), []);

  const check = () => {
    if (result !== null) return;
    inputRef.current?.blur();
    const participle = typed.trim().replace(/^sich\s+/i, '');
    const ok = aux === form.aux && checkAnswer(form.participle, participle);
    setResult(ok);
    if (ok) playCorrectChime();
    setTimeout(() => speakSentence(answer), ok ? 550 : 0);
  };

  const auxButton = (a: 'hat' | 'ist') => {
    const picked = aux === a;
    const shownRight = result !== null && form.aux === a;
    const shownWrong = result !== null && picked && form.aux !== a;
    return (
      <button
        key={a}
        type="button"
        disabled={result !== null}
        onClick={() => { setAux(a); inputRef.current?.focus(); }}
        className={`px-4 py-2 rounded-xl font-bold text-lg border-2 transition-all active:scale-95 ${
          shownRight ? 'border-good bg-good/25 text-good-deep'
            : shownWrong ? 'border-clay bg-clay/20 text-clay'
              : picked ? 'border-accent bg-accent text-white'
                : 'border-accent/50 text-label hover:bg-accent/10'
        }`}
      >
        {a}
      </button>
    );
  };

  return (
    <div className="bg-paper/75 backdrop-blur-sm rounded-2xl shadow-sm border border-paper-line/50 p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-label">
        <span>Past tense · Perfekt</span>
        <span className="text-ink-soft">{position} / {total}</span>
      </div>
      <div className="text-center flex flex-col gap-1">
        <div className="text-ink-soft text-sm">
          {word.de} · {glossFor(word, nativeLanguage)}{' '}
          <SpeakerButton word={word} className="align-middle text-label hover:text-label transition-colors" />
        </div>
        <div className="text-2xl font-bold text-ink">er/sie/es {word.thirdPerson ?? word.de}</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-lg text-ink">
        <span className="font-semibold">er/sie/es</span>
        {auxButton('hat')}
        {auxButton('ist')}
        {form.reflexive && <span className="font-semibold">sich</span>}
      </div>
      <input
        ref={inputRef}
        value={typed}
        onChange={e => setTyped(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          if (result !== null) onDone(result);
          else if (aux && typed.trim()) check();
        }}
        disabled={result !== null}
        placeholder="past participle"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className="w-full text-center text-xl font-semibold border-2 border-accent/70 rounded-xl px-3 py-2.5 text-ink bg-paper focus:outline-none focus:border-accent disabled:opacity-70"
      />
      {result === null ? (
        <>
          <SpecialCharButtons inputRef={inputRef} />
          <button
            type="button"
            onClick={check}
            className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
          >
            Check
          </button>
        </>
      ) : (
        <>
          <div className={`text-center py-3 px-2 rounded-xl font-semibold text-lg ${result ? 'bg-good/25 text-good-deep' : 'bg-clay/20 text-clay'}`}>
            {result ? '✓ Correct!' : '✗ The answer is:'} <span className="whitespace-nowrap">{answer}</span>
          </div>
          <button
            type="button"
            onClick={() => onDone(result)}
            className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
          >
            Next →
          </button>
        </>
      )}
    </div>
  );
}
