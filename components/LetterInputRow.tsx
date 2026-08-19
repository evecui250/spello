'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

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
  // Called when Backspace is pressed while the row is already fully empty —
  // lets a caller chain focus back into a previous row (word blanks ->
  // article blanks), so deleting can cross the visual gap between two
  // separate LetterInputRow instances the same way it crosses revealed/
  // locked letters within a single one.
  onBackspaceAtStart?: () => void;
}

export interface LetterInputRowHandle {
  // Focuses the row with the cursor at the end of whatever's already
  // typed — used to jump back into typing after picking der/die/das, and
  // when Backspace crosses back into this row from the next one (both
  // just mean "resume typing here").
  focusFirstEmpty: () => void;
  focusLast: () => void;
}

// Renders each editable position as its own boxed tile the way it always
// has, but underneath them all is ONE real, invisible <input> — not one
// real input per letter. Typing, IME composition, and the on-screen
// keyboard all go through that single field exactly like an ordinary text
// box; the boxes are a pure display layer sliced from its value. This is
// the standard pattern verification-code inputs use for the same reason
// it's needed here: a separate real <input> per character, auto-advancing
// focus on every keystroke, fights badly with IME composition — a
// composing keystroke can fire before it's actually committed, jump focus
// to the next box mid-composition, and then have the real commit land
// there too (a letter typed twice). A composed keystroke has nowhere else
// to jump to here, so that whole failure mode doesn't exist by
// construction, on any keyboard, without needing to get composition-event
// timing exactly right across every mobile browser.
const LetterInputRow = forwardRef<LetterInputRowHandle, Props>(function LetterInputRow(
  { chars, hint, values, onChange, onSubmit, disabled, activeInputRef, resetFocusKey, autoFocus = true, onFilled, onBackspaceAtStart },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const editableIndices = hint.map((h, i) => (h ? i : -1)).filter(i => i !== -1);
  // The single input's own value is just every editable position's
  // current letter, concatenated in order — locked/revealed positions
  // never participate. Typed characters are always contiguous from the
  // start (the UI never lets you skip ahead), so this is a lossless,
  // reversible view of the same `values` array the rest of the app
  // already works with.
  const flatValue = editableIndices.map(i => values[i] ?? '').join('');

  const focusEnd = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  useImperativeHandle(ref, () => ({
    focusFirstEmpty: () => requestAnimationFrame(focusEnd),
    focusLast: () => requestAnimationFrame(focusEnd),
  }));

  useEffect(() => {
    if (disabled || !autoFocus) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetFocusKey, disabled, autoFocus]);

  const handleChange = (raw: string) => {
    // Some IMEs (reported: a Chinese Pinyin keyboard) need a Space
    // keystroke to confirm/commit a batch of raw Latin text before the
    // learner keeps typing, rather than trying to convert it into a
    // Chinese candidate — that space lands in the field as a literal
    // character. Stripped here before anything else, since otherwise
    // each one silently ate a tile slot a real letter needed
    // ("überleben" -> "übe r le "), and — critically — filtering has to
    // happen BEFORE truncating to editableIndices.length, not after, or
    // those phantom spaces push real letters past the cutoff instead of
    // just being removed. Keeps hyphens/é too: a handful of corpus words
    // (E-Mail, Café) genuinely need them typed.
    const lettersOnly = raw.replace(/[^a-zA-ZäöüßÄÖÜéÉ-]/g, '');
    // No maxLength on the DOM input itself (see below) — enforced here
    // instead, same reasoning as the old per-tile version: a hard
    // maxlength attribute actively blocks IME composition from ever
    // starting, since the composing buffer needs room to build before it
    // resolves to committed text.
    const truncated = lettersOnly.slice(0, editableIndices.length);
    const next = [...values];
    editableIndices.forEach((pos, k) => { next[pos] = truncated[k] ?? ''; });
    onChange(next);
    if (truncated.length === editableIndices.length && editableIndices.length > 0) onFilled?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSubmit();
      return;
    }
    // The browser already deletes the last character natively when the
    // field isn't empty — this only needs to catch the cross-row case,
    // backspacing from an already-empty row into the previous one.
    if (e.key === 'Backspace' && flatValue === '' && onBackspaceAtStart) {
      onBackspaceAtStart();
    }
  };

  // 20px, comfortably above the 16px floor that keeps iOS from auto-
  // zooming on focus (see styles/globals.css) — an inline style here
  // would otherwise override that global rule. The hidden input shares
  // the same size for the same reason: a focused input's effective font
  // size (not just visible tile text) is what iOS checks.
  const tileStyle = { width: TILE_PX, height: TILE_HEIGHT_PX, fontSize: 20 };

  return (
    <div className="relative flex flex-wrap gap-2 justify-center">
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        lang="de"
        value={flatValue}
        disabled={disabled}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={e => { activeInputRef.current = e.target; setFocused(true); }}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        // Covers the whole tile row (including locked letters — tapping
        // anywhere in the word focuses the one field that actually
        // accepts input, which is the only place a tap here could
        // reasonably mean anyway) so it's tappable on mobile exactly like
        // a normal text field, while being visually invisible — the
        // tiles beneath are what's actually seen.
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        style={{ fontSize: 20 }}
      />
      {chars.map((ch, i) => {
        if (!hint[i]) {
          return (
            <div
              key={i}
              style={tileStyle}
              className="flex items-end justify-center pb-1 font-bold border-b-2 border-slate-300 text-slate-500"
            >
              {ch}
            </div>
          );
        }
        const k = editableIndices.indexOf(i);
        // The tile at the same position as the input's current cursor —
        // i.e. the next one that would receive a keystroke — gets a
        // focus ring so the row still reads as "which box is active" the
        // way separate real inputs used to convey for free.
        const isCursor = focused && k === flatValue.length;
        return (
          <div
            key={i}
            style={tileStyle}
            className={`pointer-events-none flex items-end justify-center pb-1 font-bold border-b-2 text-indigo-800 ${isCursor ? 'border-indigo-500 bg-indigo-50' : 'border-indigo-500'}`}
          >
            {flatValue[k] ?? ''}
          </div>
        );
      })}
    </div>
  );
});

export default LetterInputRow;
