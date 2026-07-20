'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

interface Props {
  chars: string[];
  hint: boolean[]; // true = hidden (editable), false = revealed (locked)
  values: string[]; // current value per position; locked positions hold the correct letter
  onChange: (values: string[]) => void;
  onSubmit: () => void;
  disabled?: boolean;
  activeInputRef: React.MutableRefObject<HTMLInputElement | null>;
  resetFocusKey: string;
}

export interface LetterInputRowHandle {
  // Focuses the first still-empty editable cell (or the first editable cell
  // if all are full) — used to jump back into typing after picking der/die/das.
  focusFirstEmpty: () => void;
}

const LetterInputRow = forwardRef<LetterInputRowHandle, Props>(function LetterInputRow(
  { chars, hint, values, onChange, onSubmit, disabled, activeInputRef, resetFocusKey },
  ref,
) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const editableIndices = hint.map((h, i) => (h ? i : -1)).filter(i => i !== -1);

  useImperativeHandle(ref, () => ({
    focusFirstEmpty: () => {
      const target = editableIndices.find(i => !values[i]) ?? editableIndices[0];
      if (target === undefined) return;
      setTimeout(() => inputRefs.current[target]?.focus(), 50);
    },
  }));

  useEffect(() => {
    if (disabled) return;
    const first = editableIndices[0];
    if (first === undefined) return;
    const t = setTimeout(() => inputRefs.current[first]?.focus(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetFocusKey, disabled]);

  const focusIndex = (i: number) => {
    inputRefs.current[i]?.focus();
    inputRefs.current[i]?.select();
  };

  const nextEditable = (i: number) => editableIndices.find(j => j > i);
  const prevEditable = (i: number) => [...editableIndices].reverse().find(j => j < i);

  const handleChange = (i: number, raw: string) => {
    const ch = raw.slice(-1);
    const next = [...values];
    next[i] = ch;
    onChange(next);
    if (ch) {
      const n = nextEditable(i);
      if (n !== undefined) focusIndex(n);
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSubmit();
      return;
    }
    if (e.key === 'Backspace' && !values[i]) {
      const p = prevEditable(i);
      if (p !== undefined) {
        const next = [...values];
        next[p] = '';
        onChange(next);
        focusIndex(p);
      }
    }
  };

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {chars.map((ch, i) =>
        hint[i] ? (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="text"
            maxLength={1}
            value={values[i] ?? ''}
            disabled={disabled}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onFocus={e => { activeInputRef.current = e.target; }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="w-9 h-11 text-center text-xl font-mono font-bold border-b-2 border-indigo-500 text-indigo-800 focus:outline-none focus:bg-indigo-50 disabled:bg-transparent"
          />
        ) : (
          <div
            key={i}
            className="w-9 h-11 flex items-end justify-center pb-1 text-xl font-mono font-bold border-b-2 border-slate-300 text-slate-500"
          >
            {ch}
          </div>
        )
      )}
    </div>
  );
});

export default LetterInputRow;
