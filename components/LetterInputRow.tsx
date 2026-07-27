'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

// Tile sizing: shrinks just enough to keep a word on one row when only a
// letter or two would otherwise spill onto a new one — but a bigger overflow
// (3+ letters) is left to wrap normally rather than squeezing tiles down to
// the point of being hard to read/tap. Works for any number of wrap levels
// (a very long word needing 2 rows vs 3), not just the one-row case.
const GAP_PX = 8;
const DEFAULT_TILE_PX = 36;
const MIN_TILE_PX = 24;

function computeTileSize(n: number, containerWidth: number): number {
  if (containerWidth <= 0 || n === 0) return DEFAULT_TILE_PX;
  for (let tile = DEFAULT_TILE_PX; tile >= MIN_TILE_PX; tile -= 2) {
    const perRow = Math.max(1, Math.floor((containerWidth + GAP_PX) / (tile + GAP_PX)));
    if (n <= perRow) return tile; // fits on one row at this size
    const lastRowCount = n % perRow === 0 ? perRow : n % perRow;
    // A dangling last row of just 1-2 tiles is the "spilled a letter or two"
    // case worth shrinking for; anything bigger is an intentional-looking
    // wrap, so stop shrinking and accept it at this size.
    if (lastRowCount > 2) return tile;
  }
  return MIN_TILE_PX;
}

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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const editableIndices = hint.map((h, i) => (h ? i : -1)).filter(i => i !== -1);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.offsetWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tileSize = computeTileSize(chars.length, containerWidth);

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

  const tileHeight = Math.round(tileSize * (44 / 36));
  const fontSize = Math.max(14, Math.round(20 * (tileSize / DEFAULT_TILE_PX)));
  const tileStyle = { width: tileSize, height: tileHeight, fontSize };

  return (
    <div ref={containerRef} className="flex flex-wrap gap-2 justify-center">
      {chars.map((ch, i) =>
        hint[i] ? (
          <input
            key={i}
            ref={el => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="text"
            lang="de"
            maxLength={1}
            value={values[i] ?? ''}
            disabled={disabled}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onFocus={e => { activeInputRef.current = e.target; }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            style={tileStyle}
            className="text-center font-mono font-bold border-b-2 border-indigo-500 text-indigo-800 focus:outline-none focus:bg-indigo-50 disabled:bg-transparent"
          />
        ) : (
          <div
            key={i}
            style={tileStyle}
            className="flex items-end justify-center pb-1 font-mono font-bold border-b-2 border-slate-300 text-slate-500"
          >
            {ch}
          </div>
        )
      )}
    </div>
  );
});

export default LetterInputRow;
