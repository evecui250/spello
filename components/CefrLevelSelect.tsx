'use client';

import { CefrLevel } from '../lib/words';

// The learner's level for an imported book (see lib/storage.ts's
// ImportedBook.cefrLevel) — what sentence exercises, words-in-context and
// pet chat are pitched at, since a book from a PDF has no level of its own.
const OPTIONS: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export default function CefrLevelSelect({ value, onChange, className = '' }: {
  value: CefrLevel;
  onChange: (l: CefrLevel) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as CefrLevel)}
      className={`border-2 border-accent/70 rounded-lg px-3 py-2 text-ink bg-transparent focus:outline-none focus:border-accent ${className}`}
    >
      {OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
    </select>
  );
}
