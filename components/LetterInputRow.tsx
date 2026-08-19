'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// A single fixed tile size for every word, on every card, always — a
// previous version shrank tiles per-word to try to squeeze longer words
// onto one row, but that meant the tile size (and therefore the whole
// card's layout) visibly changed from word to word, which read as
// inconsistent rather than adaptive, and in the worst case (a long,
// unbroken word the shrinking still couldn't fit) could force the row
// wider than the viewport and make mobile browsers zoom the whole page out
// to compensate. Fixed size + flex-wrap below means every card looks the
// same regardless of word length — a long word simply wraps onto more
// rows at the exact same tile size, never changes it.
const TILE_PX = 36;
const TILE_HEIGHT_PX = Math.round(TILE_PX * (44 / 36));

interface Props {
  chars: string[];
  hint: boolean[]; // true = hidden (editable), false = revealed (locked)
  values: string[]; // current value per position; locked positions hold the correct letter
  onChange: (values: string[]) => void;
  onSubmit: () => void;
  disabled?: boolean;
  activeInputRef: React.MutableRefObject<HTMLInputElement | null>;
  resetFocusKey: string;
  // When a row after this one needs the initial focus instead (e.g. the
  // article blanks come first and hand off into the word blanks), set this
  // to false so this row's own mount-focus effect stays out of the way.
  autoFocus?: boolean;
  // Called once every editable cell in the row has a value — lets a caller
  // chain focus into the next row (article blanks -> word blanks).
  onFilled?: () => void;
  // Called when Backspace is pressed on the row's first editable cell while
  // it's already empty — lets a caller chain focus back into a previous row
  // (word blanks -> article blanks), so deleting can cross the visual gap
  // between two separate LetterInputRow instances the same way it crosses
  // revealed/locked letters within a single one.
  onBackspaceAtStart?: () => void;
}

export interface LetterInputRowHandle {
  // Focuses the first still-empty editable cell (or the first editable cell
  // if all are full) — used to jump back into typing after picking der/die/das.
  focusFirstEmpty: () => void;
  // Focuses the last editable cell — used when Backspace crosses back into
  // this row from the next one.
  focusLast: () => void;
}

const LetterInputRow = forwardRef<LetterInputRowHandle, Props>(function LetterInputRow(
  { chars, hint, values, onChange, onSubmit, disabled, activeInputRef, resetFocusKey, autoFocus = true, onFilled, onBackspaceAtStart },
  ref,
) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const editableIndices = hint.map((h, i) => (h ? i : -1)).filter(i => i !== -1);
  // A CJK IME (e.g. Chinese Pinyin) intercepts every Latin keystroke into
  // its own composition buffer, even when the learner just wants the raw
  // letter — the browser still fires onChange for each intermediate
  // composition update, not just the final committed text. Combined with
  // this row's auto-advance-to-next-tile-on-input behavior, that meant a
  // single keystroke could fire onChange while composition was still
  // open, advance focus to the NEXT tile mid-composition, and then have
  // the IME's eventual commit land there too — showing up as the same
  // letter typed twice across two tiles. Deferring onChange entirely
  // until composition actually ends (reading the input's final value at
  // that point) makes a composed keystroke behave exactly like a plain
  // one, regardless of which keyboard/IME produced it.
  const composingRef = useRef(false);

  // requestAnimationFrame instead of an arbitrary setTimeout delay — fires as
  // soon as the DOM is actually ready to be focused (refs attached), which is
  // the minimum possible gap between the triggering action and the focus()
  // call. Mobile browsers only reliably pop up the on-screen keyboard for a
  // focus() that happens essentially immediately after a genuine user
  // gesture (tap/keystroke) — any longer delay risks it being silently
  // ignored, so minimizing this gap (rather than the previous fixed 50-80ms)
  // gives autofocus the best realistic chance of actually opening it.
  useImperativeHandle(ref, () => ({
    focusFirstEmpty: () => {
      const target = editableIndices.find(i => !values[i]) ?? editableIndices[0];
      if (target === undefined) return;
      requestAnimationFrame(() => inputRefs.current[target]?.focus());
    },
    focusLast: () => {
      const target = editableIndices[editableIndices.length - 1];
      if (target === undefined) return;
      requestAnimationFrame(() => focusIndex(target));
    },
  }));

  useEffect(() => {
    if (disabled || !autoFocus) return;
    const first = editableIndices[0];
    if (first === undefined) return;
    const frame = requestAnimationFrame(() => inputRefs.current[first]?.focus());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetFocusKey, disabled, autoFocus]);

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
      if (n !== undefined) {
        focusIndex(n);
      } else if (onFilled && editableIndices.every(j => next[j])) {
        onFilled();
      }
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
      } else if (i === editableIndices[0] && onBackspaceAtStart) {
        onBackspaceAtStart();
      }
    }
  };

  // 20px, comfortably above the 16px floor that keeps iOS from auto-
  // zooming on focus (see styles/globals.css) — an inline style here
  // would otherwise override that global rule.
  const tileStyle = { width: TILE_PX, height: TILE_HEIGHT_PX, fontSize: 20 };

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {chars.map((ch, i) =>
        hint[i] ? (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="text"
            lang="de"
            // No maxLength here on purpose — a hard maxlength on the DOM
            // input actively blocks IME composition from ever starting
            // (the composing buffer needs room to build before it commits
            // down to the final character), which is exactly what caused
            // this to go from "duplicates a letter" to "can't type
            // anything at all" once composition handling was added below.
            // This isn't CJK-specific either: Android's predictive-text
            // keyboard composes plain English/German input the same way,
            // which is why it broke there too. Truncation to one
            // character is still fully enforced, just in JS (handleChange
            // below already does `raw.slice(-1)`), not via the DOM
            // attribute.
            value={values[i] ?? ''}
            disabled={disabled}
            onChange={e => { if (!composingRef.current) handleChange(i, e.target.value); }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={e => { composingRef.current = false; handleChange(i, e.currentTarget.value); }}
            onKeyDown={e => handleKeyDown(i, e)}
            onFocus={e => { activeInputRef.current = e.target; }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            style={tileStyle}
            className="text-center font-bold border-b-2 border-indigo-500 text-indigo-800 focus:outline-none focus:bg-indigo-50 disabled:bg-transparent"
          />
        ) : (
          <div
            key={i}
            style={tileStyle}
            className="flex items-end justify-center pb-1 font-bold border-b-2 border-slate-300 text-slate-500"
          >
            {ch}
          </div>
        )
      )}
    </div>
  );
});

export default LetterInputRow;
