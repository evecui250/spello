'use client';

interface Props {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInsert?: (val: string) => void;
}

const CHARS = ['ä', 'ö', 'ü', 'ß'];

export default function SpecialCharButtons({ inputRef, onInsert }: Props) {
  const insert = (ch: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const newVal = el.value.slice(0, start) + ch + el.value.slice(end);
    // Use native setter so React's onChange fires
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    nativeSetter?.call(el, newVal);
    // Dispatch the native input event and let the field's own onChange
    // (which may auto-advance focus to the next cell) handle what follows —
    // forcing focus back here would undo that advance.
    el.dispatchEvent(new Event('input', { bubbles: true }));
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
