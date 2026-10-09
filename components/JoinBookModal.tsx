'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchSharedBook, addSharedBook, normalizeBookCode, SharedBook } from '../lib/bookImport';
import { getImportedBookByShareCode, cefrLevelFor, getActiveLevel } from '../lib/storage';
import { BookLevelId, CefrLevel } from '../lib/words';
import CefrLevelSelect from './CefrLevelSelect';

// Settings' "Join with a book code": a classmate shared a book they
// imported from a PDF (see ImportBookModal's "Create book code"); entering
// the code shows its name/size, then adds a copy as this learner's own
// imported book — same words, separate progress.
export default function JoinBookModal({ onClose, onJoined }: {
  onClose: () => void;
  onJoined: (id: BookLevelId) => void;
}) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<SharedBook | null>(null);
  const [cefrLevel, setCefrLevel] = useState<CefrLevel>(() => cefrLevelFor(getActiveLevel()));

  async function handleLookup() {
    const c = normalizeBookCode(code);
    setError(null);
    setFound(null);
    if (c.length !== 6) { setError('A book code has 6 letters and numbers.'); return; }
    const existing = getImportedBookByShareCode(c);
    if (existing) { setError(`You already have this book: “${existing.name}”.`); return; }
    setLoading(true);
    try {
      const book = await fetchSharedBook(c);
      if (!book) setError('No book found with that code. Check it and try again.');
      else setFound(book);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!found) return;
    setLoading(true);
    setError(null);
    try {
      // Re-fetched with join=true so the add is counted — and so the copy
      // saved is exactly what's on the server right now.
      const book = await fetchSharedBook(found.code, true);
      if (!book) throw new Error('This book is no longer available.');
      onJoined(addSharedBook(book, cefrLevel).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this book.');
      setLoading(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!loading) onClose(); }}>
      <div className="w-full max-w-sm bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Join with a book code</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink text-xl leading-none">×</button>
        </div>
        <p className="text-ink-soft text-sm">Got a code from a classmate? You'll get the same words as your own book — your progress stays your own.</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase().slice(0, 8)); setFound(null); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') handleLookup(); }}
            placeholder="ABC234"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 border-2 border-accent/70 rounded-lg px-3 py-2 text-ink font-mono text-lg tracking-[0.2em] uppercase focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={loading || !code.trim()}
            className="bg-accent text-white px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all"
          >
            {loading && !found ? '…' : 'Find'}
          </button>
        </div>
        {found && (
          <div className="border border-paper-line rounded-xl p-3 flex flex-col gap-2">
            <span className="text-ink font-semibold">{found.name}</span>
            <span className="text-ink-soft text-sm">
              {found.wordCount} words{found.sourcePages ? ` · PDF pages ${found.sourcePages}` : ''}
            </span>
            <span className="text-ink-soft text-xs truncate">
              {found.words.slice(0, 6).map(w => (w.article ? `${w.article} ${w.de}` : w.de)).join(', ')}…
            </span>
            <label className="flex items-center justify-between gap-3 text-sm text-ink">
              <span>Your level <span className="text-ink-soft text-xs">(for sentences & chat)</span></span>
              <CefrLevelSelect value={cefrLevel} onChange={setCefrLevel} />
            </label>
            <button
              type="button"
              onClick={handleAdd}
              disabled={loading}
              className="w-full bg-accent text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all"
            >
              {loading ? 'Adding…' : 'Add and study this book'}
            </button>
          </div>
        )}
        {error && <p className="text-clay text-sm">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
