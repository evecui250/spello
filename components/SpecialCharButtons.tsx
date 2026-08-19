'use client';

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

interface Props {
  inputRef: React.RefObject<FieldEl | null>;
  onInsert?: (val: string) => void;
}

const CHARS = ['ä', 'ö', 'ü', 'ß'];

// There's no reliable, cross-browser web API to force a visitor's on-
// screen keyboard into a specific language layout (the `lang` attribute
// is at most a loose hint some IMEs use for autocorrect, not a layout
// switch) — a learner without a German keyboard installed simply has no
// way to type ä/ö/ü/ß otherwise. This row of buttons is the actual fix:
// works identically regardless of whatever keyboard the OS is showing.
// Used both by LetterInputRow's spelling rounds (an <input> per letter)
// and SentenceExercise's free-text translation attempt (a <textarea>).
export default function SpecialCharButtons({ inputRef, onInsert }: Props) {
  const insert = (ch: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + ch + el.value.slice(end);
    // Use the native setter so React's onChange still fires — textarea
    // and input each define their own `value` property, so which
    // prototype to read it off has to match the actual element.
    const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    nativeSetter?.call(el, newVal);
    // Dispatch the native input event so the field's own onChange fires
    // and picks up the new value.
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Put the cursor right after the inserted character, same as typing
    // it normally would, and refocus the field — clicking this button
    // moves focus to the button itself, so without this a learner had to
    // manually tap back into the blank before they could keep typing
    // (reported as exactly that). LetterInputRow's spelling rounds are a
    // single field per row now (not one input per letter), so there's no
    // longer a separate "next cell" for its own logic to advance into —
    // refocusing here is what actually resumes typing where it left off,
    // for both that and the sentence-writing textarea.
    const newCursor = start + ch.length;
    el.focus();
    el.setSelectionRange?.(newCursor, newCursor);
    onInsert?.(newVal);
  };

  return (
    <div className="flex flex-wrap gap-2 justify-center my-3">
      {CHARS.map(ch => (
        <button
          key={ch}
          type="button"
          onClick={() => insert(ch)}
          className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-800 font-semibold text-lg hover:bg-indigo-200 active:scale-95 transition-transform"
        >
          {ch}
        </button>
      ))}
    </div>
  );
}
