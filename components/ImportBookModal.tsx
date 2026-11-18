'use client';

import { Fragment, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPdfPagePreviews, formatPageList, PdfPagePreview, MAX_IMPORT_PAGES, findContinuationPages, findVocabularyPages } from '../lib/pdf';
import { extractBookWords, ImportCandidate, ImportStage, shareImportedBook } from '../lib/bookImport';
import { DailyLimitReachedError, AIUnreachableError } from '../lib/ai';
import { saveImportedBook, newBookId, MAX_WORDS_PER_BOOK, ImportedBook, cefrLevelFor, getActiveLevel } from '../lib/storage';
import { BookLevelId, CefrLevel } from '../lib/words';
import CefrLevelSelect from './CefrLevelSelect';
import { scheduleSync } from '../lib/sync';

// Settings' "Import a book from PDF" flow: pick PDF -> tick pages ->
// extract (slow, with progress) -> review/deselect words -> name -> save.
// The review step is the only chance to catch extraction noise before it
// becomes study material, same confirm-before-save spirit as Word List's
// look-up-and-add. Saved words go in as plain custom words (NOT
// addCustomWordIntroduced) so every one enters the study queue as New.

type Step = 'pick' | 'working' | 'review' | 'done';

const PRIMARY_BTN = 'w-full bg-accent text-white py-3 rounded-xl font-semibold disabled:opacity-40 hover:bg-accent-deep active:scale-95 transition-all';

function stageLabel(s: ImportStage | null): string {
  if (!s || s.stage === 'reading') return 'Reading the PDF…';
  if (s.stage === 'extracting') return `Finding vocabulary… (${s.done}/${s.total})`;
  return `Defining new words… (${s.done}/${s.total})`;
}

// The code big enough to copy off a phone screen or a whiteboard, plus a
// copy button. Shared with Settings' own "Share this book" row.
export function BookCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-2xl font-bold tracking-[0.2em] text-ink select-all">{code}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
        }}
        className="text-sm font-semibold text-label hover:text-ink underline underline-offset-2"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  );
}

export default function ImportBookModal({ onClose, onSwitchTo }: {
  onClose: () => void;
  onSwitchTo: (id: BookLevelId) => void;
}) {
  const [step, setStep] = useState<Step>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<PdfPagePreview[] | null>(null);
  const [pickedPages, setPickedPages] = useState<Set<number>>(new Set());
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<{ aiCalls: number; matched: number } | null>(null);
  const [saved, setSaved] = useState<ImportedBook | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // Pages ticked automatically as a continuation of a page the learner
  // ticked (see findContinuationPages) — labelled so it's not a surprise.
  const [autoAdded, setAutoAdded] = useState<Set<number>>(new Set());
  const bookId = useRef<BookLevelId>(newBookId());
  const [cefrLevel, setCefrLevel] = useState<CefrLevel>(() => cefrLevelFor(getActiveLevel()));

  const busy = step === 'working';

  async function handleFile(f: File | undefined) {
    setError(null);
    setPreviews(null);
    setPickedPages(new Set());
    setAutoAdded(new Set());
    if (!f) return;
    setFile(f);
    setName(f.name.replace(/\.pdf$/i, ''));
    setLoadingPdf(true);
    try {
      const p = await getPdfPagePreviews(f);
      if (!p.some(x => x.hasText)) {
        setError("This PDF has no selectable text (it's probably scanned), so words can't be read from it yet.");
      }
      setPreviews(p);
    } catch {
      setFile(null);
      setError("Couldn't open that file as a PDF.");
    } finally {
      setLoadingPdf(false);
    }
  }

  const continuations = previews ? findContinuationPages(previews) : new Map<number, number>();
  const vocabPages = previews ? findVocabularyPages(previews) : [];

  // Ticking a page also ticks the pages its section overflows onto.
  function togglePage(n: number) {
    const next = new Set(pickedPages);
    const auto = new Set(autoAdded);
    auto.delete(n);
    if (next.has(n)) {
      next.delete(n);
    } else {
      next.add(n);
      for (let k = n + 1; continuations.get(k) === k - 1; k++) {
        if (!next.has(k)) { next.add(k); auto.add(k); }
      }
    }
    setPickedPages(next);
    setAutoAdded(auto);
  }

  // The PDF's own chapters (its bookmarks), in page order — the page list
  // groups under them, and ticking one ticks all its pages.
  const chapterPages = new Map<string, number[]>();
  for (const p of previews ?? []) {
    if (p.chapter && p.hasText) chapterPages.set(p.chapter, [...(chapterPages.get(p.chapter) ?? []), p.page]);
  }
  function toggleChapter(chapter: string) {
    const pages = chapterPages.get(chapter) ?? [];
    const allOn = pages.every(n => pickedPages.has(n));
    const next = new Set(pickedPages);
    for (const n of pages) { if (allOn) next.delete(n); else next.add(n); }
    setPickedPages(next);
    setAutoAdded(new Set([...autoAdded].filter(n => !pages.includes(n))));
  }

  function selectVocabularyPages() {
    setPickedPages(new Set(vocabPages));
    setAutoAdded(new Set(vocabPages.filter(p => continuations.has(p))));
  }

  async function handleShare() {
    if (!saved) return;
    setSharing(true);
    setError(null);
    try {
      setShareCode(await shareImportedBook(saved.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a code.");
    } finally {
      setSharing(false);
    }
  }

  async function handleExtract() {
    if (!file || pickedPages.size === 0) return;
    if (pickedPages.size > MAX_IMPORT_PAGES) { setError(`At most ${MAX_IMPORT_PAGES} pages per import.`); return; }
    const pages = [...pickedPages].sort((a, b) => a - b);
    setError(null);
    setStep('working');
    setStage(null);
    try {
      const chapterOf = new Map((previews ?? []).map(p => [p.page, p.chapter]));
      const result = await extractBookWords(file, pages, bookId.current, setStage, n => chapterOf.get(n));
      setCandidates(result.candidates);
      setExcluded(new Set());
      setStats({ aiCalls: result.aiCalls, matched: result.candidates.filter(c => c.source === 'corpus').length });
      setStep('review');
    } catch (e) {
      setError(
        e instanceof DailyLimitReachedError ? "You've reached today's AI limit — try again tomorrow."
          : e instanceof AIUnreachableError ? "Couldn't reach the server. Check your connection and try again."
            : e instanceof Error ? e.message : 'Something went wrong.',
      );
      setStep('pick');
    }
  }

  const selected = candidates.filter(c => !excluded.has(c.word.id));
  const selectedPhrases = selected.filter(c => c.kind === 'phrase').length;
  const foundPhrases = candidates.filter(c => c.kind === 'phrase').length;

  // The review list, by the book's own chapters (one unnamed group when
  // the PDF has none), in the order they appear.
  const groups: { section?: string; items: ImportCandidate[] }[] = [];
  for (const c of candidates) {
    const g = groups.find(x => x.section === c.section);
    if (g) g.items.push(c); else groups.push({ section: c.section, items: [c] });
  }

  // A chapter's "Words"/"Phrases" chip: all on -> all off, otherwise all on.
  function toggleKind(items: ImportCandidate[], kind: ImportCandidate['kind']) {
    const ids = items.filter(c => c.kind === kind).map(c => c.word.id);
    const allOn = ids.every(id => !excluded.has(id));
    setExcluded(prev => {
      const next = new Set(prev);
      for (const id of ids) { if (allOn) next.add(id); else next.delete(id); }
      return next;
    });
  }

  const countLabel = (words: number, phrases: number) =>
    [words > 0 || phrases === 0 ? `${words} word${words === 1 ? '' : 's'}` : '', phrases > 0 ? `${phrases} phrase${phrases === 1 ? '' : 's'}` : '']
      .filter(Boolean).join(' and ');

  function toggle(id: string) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSave() {
    setError(null);
    const book: ImportedBook = {
      id: bookId.current,
      name: name.trim() || 'My book',
      createdAt: new Date().toISOString(),
      wordCount: selected.length,
      sourcePages: formatPageList([...pickedPages]),
      cefrLevel,
    };
    try {
      saveImportedBook(book, selected.map(c => c.word));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this book.');
      return;
    }
    scheduleSync();
    setSaved(book);
    setStep('done');
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      style={{ paddingTop: 'calc(1rem + var(--safe-top))', paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="w-full max-w-md max-h-full bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Import a book from PDF</h2>
          {!busy && (
            <button type="button" onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink text-xl leading-none">
              ×
            </button>
          )}
        </div>

        {step === 'pick' && (
          <>
            <p className="text-ink-soft text-sm">
              Spello pulls the German vocabulary out of the pages you choose and makes it its own book,
              studied separately from A1–B2. The PDF stays on your device; only the page text is sent for analysis.
            </p>
            <label className="block">
              <span className="block font-semibold text-ink text-sm mb-1">PDF file</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={e => handleFile(e.target.files?.[0])}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-accent/15 file:px-3 file:py-2 file:font-semibold file:text-label"
              />
            </label>
            {loadingPdf && <p className="text-ink-soft text-sm">Reading pages…</p>}
            {previews && (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink text-sm">Pages to import</span>
                  <span className="text-ink-soft text-xs">{pickedPages.size} selected</span>
                </div>
                {vocabPages.length > 0 && (
                  <button
                    type="button"
                    onClick={selectVocabularyPages}
                    className="self-start bg-accent/15 text-label px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-accent/25 transition-colors"
                  >
                    Select vocabulary pages ({vocabPages.length})
                  </button>
                )}
                <div className="flex-1 min-h-0 max-h-72 overflow-y-auto border border-paper-line rounded-xl divide-y divide-paper-line">
                  {previews.map((p, i) => {
                    const on = pickedPages.has(p.page);
                    const chapterStart = p.chapter && p.chapter !== previews[i - 1]?.chapter ? p.chapter : null;
                    const chapterOn = chapterStart ? (chapterPages.get(chapterStart) ?? []) : [];
                    return (
                      <Fragment key={p.page}>
                      {chapterStart && chapterOn.length > 0 && (
                        <label className="flex items-center gap-3 px-3 py-2 bg-accent/10 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={chapterOn.every(n => pickedPages.has(n))}
                            onChange={() => toggleChapter(chapterStart)}
                            className="accent-accent h-4 w-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1 text-ink text-sm font-semibold truncate">{chapterStart}</span>
                          <span className="shrink-0 text-ink-soft text-xs">
                            {chapterOn.length} page{chapterOn.length === 1 ? '' : 's'}
                          </span>
                        </label>
                      )}
                      <label className={`flex items-center gap-3 py-2 pr-3 ${p.chapter ? 'pl-7' : 'pl-3'} ${p.hasText ? 'cursor-pointer' : 'opacity-45'}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!p.hasText}
                          onChange={() => togglePage(p.page)}
                          className="accent-accent h-4 w-4 shrink-0"
                        />
                        <span className="shrink-0 w-12 text-ink-soft text-xs leading-tight">
                          p. {p.page}
                          {p.printedNumber && <span className="block opacity-75">({p.printedNumber})</span>}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-ink text-sm truncate">{p.hasText ? p.title || '—' : 'No text on this page'}</span>
                          {continuations.has(p.page) && (
                            <span className={`block text-xs ${autoAdded.has(p.page) && on ? 'text-label font-medium' : 'text-ink-soft'}`}>
                              ↳ continues p. {continuations.get(p.page)}{autoAdded.has(p.page) && on ? ' · added' : ''}
                            </span>
                          )}
                        </span>
                      </label>
                      </Fragment>
                    );
                  })}
                </div>
                <span className="block text-ink-soft text-xs">
                  Tick the chapters or pages to learn from. Up to {MAX_IMPORT_PAGES} pages and {MAX_WORDS_PER_BOOK} words per book.
                  {previews.some(p => p.printedNumber) ? ' Numbers in brackets are the ones printed on the page.' : ''}
                </span>
                <button type="button" onClick={handleExtract} disabled={pickedPages.size === 0} className={PRIMARY_BTN}>
                  Find vocabulary
                </button>
              </>
            )}
          </>
        )}

        {step === 'working' && (
          <div className="py-6 flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-4 border-accent/30 border-t-accent animate-spin" />
            <p className="text-ink text-sm font-medium">{stageLabel(stage)}</p>
            <p className="text-ink-soft text-xs text-center">This can take a minute for longer page ranges. Keep this screen open.</p>
          </div>
        )}

        {step === 'review' && (
          <>
            <p className="text-ink-soft text-sm">
              Found {countLabel(candidates.length - foundPhrases, foundPhrases)}
              {stats && stats.matched > 0 ? ` (${stats.matched} matched Spello's built-in lists)` : ''}.
              Untick anything you don&apos;t want to learn.
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto border border-paper-line rounded-xl divide-y divide-paper-line">
              {groups.map(g => {
                const kinds = (['word', 'phrase'] as const)
                  .map(kind => ({ kind, items: g.items.filter(c => c.kind === kind) }))
                  .filter(k => k.items.length > 0);
                return (
                  <Fragment key={g.section ?? ''}>
                    {(g.section || foundPhrases > 0) && (
                      <div className="px-3 py-2 bg-accent/10 flex flex-wrap items-center gap-2">
                        {g.section && <span className="w-full text-ink text-sm font-semibold truncate">{g.section}</span>}
                        {kinds.map(({ kind, items }) => {
                          const on = items.filter(c => !excluded.has(c.word.id)).length;
                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() => toggleKind(g.items, kind)}
                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${on > 0 ? 'bg-accent text-white' : 'bg-paper border border-paper-line text-ink-soft'}`}
                            >
                              {on > 0 ? '✓ ' : ''}{kind === 'phrase' ? 'Phrases' : 'Words'} {on === items.length ? items.length : `${on}/${items.length}`}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {g.items.map(c => {
                      const on = !excluded.has(c.word.id);
                      return (
                        <label key={c.word.id} className={`flex items-center gap-3 px-3 py-1.5 cursor-pointer ${on ? '' : 'opacity-45'}`}>
                          <input type="checkbox" checked={on} onChange={() => toggle(c.word.id)} className="accent-accent h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 text-ink font-medium truncate">
                            {c.word.article ? `${c.word.article} ` : ''}{c.word.de}
                          </span>
                          {c.kind === 'phrase' && <span className="shrink-0 text-ink-soft text-xs">phrase</span>}
                        </label>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
            <label className="block">
              <span className="block font-semibold text-ink text-sm mb-1">Book name</span>
              <input
                value={name}
                onChange={e => setName(e.target.value.slice(0, 60))}
                className="w-full border-2 border-accent/70 rounded-lg px-3 py-2 text-ink focus:outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-ink">
              <span className="font-semibold">Your level <span className="font-normal text-ink-soft text-xs">(for example sentences)</span></span>
              <CefrLevelSelect value={cefrLevel} onChange={setCefrLevel} />
            </label>
            <button type="button" onClick={handleSave} disabled={selected.length === 0} className={PRIMARY_BTN}>
              Save book ({countLabel(selected.length - selectedPhrases, selectedPhrases)})
            </button>
          </>
        )}

        {step === 'done' && saved && (
          <>
            <p className="text-ink text-sm">
              ✓ “{saved.name}” saved with {saved.wordCount} words. It's its own book — your A1–B2 progress is untouched.
            </p>
            <div className="border border-paper-line rounded-xl p-3 flex flex-col gap-2">
              <span className="text-ink text-sm font-semibold">Studying with a class?</span>
              {shareCode ? (
                <BookCodeDisplay code={shareCode} />
              ) : (
                <>
                  <span className="text-ink-soft text-xs">Get a book code — classmates enter it in Profile to get the same words, with their own progress.</span>
                  <button
                    type="button"
                    onClick={handleShare}
                    disabled={sharing}
                    className="self-start bg-accent/15 text-label px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-accent/25 disabled:opacity-50 transition-colors"
                  >
                    {sharing ? 'Creating code…' : 'Create book code'}
                  </button>
                </>
              )}
            </div>
            <button type="button" onClick={() => onSwitchTo(saved.id)} className={PRIMARY_BTN}>
              Study this book now
            </button>
            <button type="button" onClick={onClose} className="text-ink-soft text-sm hover:text-ink">
              Not now
            </button>
          </>
        )}

        {error && <p className="text-clay text-sm">{error}</p>}
      </div>
    </div>,
    document.body,
  );
}
