'use client';

import { useMemo, useRef, useState } from 'react';
import { Level, Word, wordsForLevel, isCefrLevel, glossFor } from '../lib/words';
import {
  getAllCustomWordsForLevel, getAllProgressForLevel, getImportedBook, setImportedBookLevel,
  getSettings, DICTIONARY_BOOK_ID, WordProgress, renameImportedBook,
} from '../lib/storage';
import { shareImportedBook } from '../lib/bookImport';
import { scheduleSync } from '../lib/sync';
import CefrLevelSelect from './CefrLevelSelect';
import { BookCodeDisplay } from './ImportBookModal';

// Profile → Books & level → one book: study it, its settings (imported
// books), and every word in it with the learner's status — a page at a
// time, since a CEFR book has ~700-1,300 words.
const PAGE_SIZE = 50;

type Status = 'new' | 'learning' | 'mastered';
function statusOf(p: WordProgress | undefined): Status {
  if (p?.fullyMastered) return 'mastered';
  return p && p.studiedTimes > 0 ? 'learning' : 'new';
}
const STATUS_LABEL: Record<Status, string> = { new: 'New', learning: 'Learning', mastered: 'Mastered' };
const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-paper-dim text-ink-soft',
  learning: 'bg-accent/15 text-label',
  mastered: 'bg-good/25 text-good-deep',
};

export default function BookDetail({ bookId, isActive, onStudy, onRenamed }: {
  bookId: Level;
  isActive: boolean;
  onStudy: () => void;
  onRenamed?: () => void;
}) {
  const [imported, setImported] = useState(() => getImportedBook(bookId));
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [page, setPage] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const listTop = useRef<HTMLDivElement>(null);
  const lang = getSettings().nativeLanguage;

  const { words, progress } = useMemo(() => {
    const list: Word[] = isCefrLevel(bookId) ? wordsForLevel(bookId) : Object.values(getAllCustomWordsForLevel(bookId));
    return {
      words: [...list].sort((a, b) => a.de.localeCompare(b.de, 'de')),
      progress: getAllProgressForLevel(bookId),
    };
  }, [bookId]);

  const counts = useMemo(() => {
    const c = { all: words.length, new: 0, learning: 0, mastered: 0 };
    for (const w of words) c[statusOf(progress[w.id])]++;
    return c;
  }, [words, progress]);

  const filtered = filter === 'all' ? words : words.filter(w => statusOf(progress[w.id]) === filter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const goTo = (p: number) => {
    setPage(p);
    listTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  async function handleShare() {
    setSharing(true);
    setShareError(null);
    try {
      await shareImportedBook(imported!.id);
      setImported(getImportedBook(bookId));
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Couldn't create a code.");
    } finally {
      setSharing(false);
    }
  }

  const isDictionary = bookId === DICTIONARY_BOOK_ID;
  // Only a book the learner imported themselves (not one joined with a
  // classmate's code, and not the built-in dictionary) can be renamed.
  const canRename = !!imported && !imported.joined && !isDictionary;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(imported?.name ?? '');
  const saveName = () => {
    if (!imported || !nameDraft.trim()) return;
    renameImportedBook(imported.id, nameDraft);
    setImported(getImportedBook(bookId));
    setRenaming(false);
    scheduleSync();
    onRenamed?.();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5 flex flex-col gap-3">
        <p className="text-ink-soft text-sm">
          {words.length} words
          {isDictionary ? ' you added from the Dictionary — reviewed with every book'
            : imported ? (imported.sourcePages ? ` · from PDF pages ${imported.sourcePages}` : ' · added with a book code') : ''}
        </p>
        {isDictionary ? null : isActive ? (
          <span className="self-start text-xs font-bold text-white bg-accent rounded-full px-3 py-1">Studying now</span>
        ) : (
          <button
            type="button"
            onClick={onStudy}
            className="w-full bg-accent text-white py-3 rounded-xl font-semibold hover:bg-accent-deep active:scale-95 transition-all"
          >
            Study this book
          </button>
        )}
        {imported && (
          <div className="flex flex-col gap-2 border-t border-paper-line/60 pt-3">
            {canRename && (renaming ? (
              <div className="flex gap-2">
                <input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value.slice(0, 60))}
                  onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(false); }}
                  autoFocus
                  aria-label="Book name"
                  className="min-w-0 flex-1 border-2 border-accent/70 rounded-lg px-3 py-1.5 text-ink focus:outline-none focus:border-accent"
                />
                <button type="button" onClick={saveName} disabled={!nameDraft.trim()} className="bg-accent text-white px-3 rounded-lg text-sm font-semibold disabled:opacity-40">Save</button>
              </div>
            ) : (
              <button type="button" onClick={() => { setNameDraft(imported.name); setRenaming(true); }} className="self-start text-sm font-semibold text-label hover:text-ink underline underline-offset-2">
                Rename this book
              </button>
            ))}
            {imported.joined && (
              <span className="text-ink-soft text-xs">Added with a classmate&apos;s book code — its name comes from them.</span>
            )}
            <label className="flex items-center justify-between gap-3 text-sm text-ink">
              <span>Your level for this book <span className="block text-ink-soft text-xs">How hard its sentences, paragraphs and chat are</span></span>
              <CefrLevelSelect
                value={imported.cefrLevel ?? 'B1'}
                onChange={l => { setImportedBookLevel(imported.id, l); setImported(getImportedBook(bookId)); scheduleSync(); }}
              />
            </label>
            {!isDictionary && (imported.shareCode ? (
              <>
                <span className="text-ink-soft text-xs">Book code — classmates add it with + → “Join with a book code”:</span>
                <BookCodeDisplay code={imported.shareCode} />
              </>
            ) : (
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                className="self-start text-sm font-semibold text-label hover:text-ink underline underline-offset-2 disabled:opacity-50"
              >
                {sharing ? 'Creating code…' : 'Share this book with a code'}
              </button>
            ))}
            {shareError && <span className="text-clay text-xs">{shareError}</span>}
          </div>
        )}
      </div>

      <div ref={listTop} className="flex gap-1.5 flex-wrap scroll-mt-4">
        {(['all', 'new', 'learning', 'mastered'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => { setFilter(f); setPage(0); }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${filter === f ? 'bg-paper text-ink' : 'bg-black/20 text-on-bg/80 hover:text-on-bg'}`}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]} {counts[f]}
          </button>
        ))}
      </div>

      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm divide-y divide-paper-line/60 overflow-hidden">
        {shown.length === 0 ? (
          <p className="text-ink-soft text-sm px-4 py-6 text-center">No words here yet.</p>
        ) : shown.map(w => {
          const st = statusOf(progress[w.id]);
          return (
            <div key={w.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink truncate">{w.article ? `${w.article} ` : ''}{w.de}</div>
                <div className="text-ink-soft text-sm truncate">{glossFor(w, lang)}</div>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${STATUS_STYLE[st]}`}>{STATUS_LABEL[st]}</span>
            </div>
          );
        })}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={page === 0}
            className="px-4 py-2 rounded-xl bg-paper/75 text-ink font-semibold text-sm disabled:opacity-40"
          >
            ‹ Previous
          </button>
          <span className="text-on-bg/80 text-sm">Page {page + 1} of {pageCount}</span>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={page >= pageCount - 1}
            className="px-4 py-2 rounded-xl bg-paper/75 text-ink font-semibold text-sm disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
