'use client';

import { WORDS, Word, BookLevelId, CefrLevel } from './words';
import { extractHeadwords, defineHeadwords, Headword } from './ai';
import { extractPdfPagesText, chunkPageTexts } from './pdf';
import {
  MAX_WORDS_PER_BOOK, newCustomWordId, newBookId, ImportedBook, saveImportedBook,
  getImportedBook, setImportedBookShareCode, getAllCustomWordsForLevel,
} from './storage';
import { supabase } from './supabase';
import { scheduleSync } from './sync';

// The pipeline behind components/ImportBookModal.tsx:
//   PDF pages -> text (on device) -> headwords (AI, one call per chunk)
//   -> corpus match (free) -> define the rest (AI, batched).
// The corpus-match step is the big quality/cost win: the DTZ wordlists
// the A1/A2/B1 corpus came from are exactly the kind of PDF a learner
// imports, so most headwords already exist in WORDS with hand-curated
// exercisePrompt/zh/category — cloning those beats any fresh AI entry.

export interface ImportCandidate {
  word: Word;
  source: 'corpus' | 'ai';
}

export interface ImportResult {
  candidates: ImportCandidate[];
  aiCalls: number;
  headwordCount: number;
}

export type ImportStage =
  | { stage: 'reading' }
  | { stage: 'extracting'; done: number; total: number }
  | { stage: 'defining'; done: number; total: number };

const DEFINE_BATCH = 40;
const CONCURRENCY = 3;

// "der Tisch" / "Tisch," / "sich freuen" all key the same as the corpus's
// own bare dictionary form.
function matchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss') // Swiss books write "heiss" for "heiß"
    .split(',')[0] // "Stadt, -¨e" — a plural ending isn't part of the word
    .replace(/\([^)]*\)/g, ' ') // "(Sg.)", "(sich)"
    .replace(/^(der|die|das)\s+/, '')
    .replace(/^sich\s+/, '')
    .replace(/[.,;:!?()"„“]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let corpusIndex: Map<string, Word[]> | null = null;
// Case matters for the match even though the key is lowercased: "Fest"
// (noun, a party) must not pick up "fest" (adjective, firm), nor
// "Unternehmen" the verb "unternehmen". A headword written with an
// article, or capitalized, only matches a corpus noun; a lowercase one
// only a non-noun. No acceptable match -> the AI defines it instead.
function corpusLookup(term: string): Word | undefined {
  if (!corpusIndex) {
    corpusIndex = new Map();
    for (const w of WORDS) {
      const k = matchKey(w.de);
      corpusIndex.set(k, [...(corpusIndex.get(k) ?? []), w]);
    }
  }
  const bare = term.trim().replace(/^\(?sich\)?\s+/i, '');
  const wantsNoun = /^(der|die|das)\s/i.test(bare) || /^\p{Lu}/u.test(bare);
  const candidates = (corpusIndex.get(matchKey(term)) ?? []).filter(w => (w.type === 'noun') === wantsNoun);
  // One with a pre-baked exercisePrompt beats one without (it skips a
  // live sentence-generation call later).
  return candidates.find(w => w.exercisePrompt) ?? candidates[0];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onDone: () => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      onDone();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function extractBookWords(
  file: File,
  pages: number[],
  bookId: BookLevelId,
  onProgress: (s: ImportStage) => void,
): Promise<ImportResult> {
  onProgress({ stage: 'reading' });
  const pageTexts = await extractPdfPagesText(file, pages);
  const chunks = chunkPageTexts(pageTexts);
  if (chunks.length === 0) {
    throw new Error("Couldn't find any text on those pages. Scanned (image-only) PDFs aren't supported yet.");
  }

  let aiCalls = 0;
  let done = 0;
  onProgress({ stage: 'extracting', done, total: chunks.length });
  const perChunk = await mapLimit(chunks, CONCURRENCY, async c => { aiCalls++; return extractHeadwords(c, bookId); },
    () => onProgress({ stage: 'extracting', done: ++done, total: chunks.length }));

  const seen = new Set<string>();
  const headwords: Headword[] = [];
  for (const w of perChunk.flat()) {
    const k = matchKey(w.de);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    headwords.push(w);
  }
  if (headwords.length === 0) throw new Error('No German vocabulary found on those pages.');
  if (headwords.length > MAX_WORDS_PER_BOOK) {
    throw new Error(`Those pages have about ${headwords.length} words — a book holds at most ${MAX_WORDS_PER_BOOK}. Choose fewer pages and import the rest as a second book.`);
  }

  // Keeps the book's original order, whichever path each word takes.
  const slots: (ImportCandidate | null)[] = headwords.map(h => {
    const hit = corpusLookup(h.de);
    return hit ? { word: { ...hit, id: newCustomWordId(), level: bookId, sourceId: hit.id }, source: 'corpus' } : null;
  });
  const unmatchedIdx = slots.flatMap((s, i) => (s ? [] : [i]));
  const batches: number[][] = [];
  for (let i = 0; i < unmatchedIdx.length; i += DEFINE_BATCH) batches.push(unmatchedIdx.slice(i, i + DEFINE_BATCH));

  done = 0;
  if (batches.length > 0) onProgress({ stage: 'defining', done, total: batches.length });
  await mapLimit(batches, CONCURRENCY, async idxs => {
    aiCalls++;
    const defs = await defineHeadwords(idxs.map(i => headwords[i]), bookId);
    // The model may drop noise entries, so match definitions back by
    // headword; positional only when nothing was dropped (it may also
    // normalize a headword, e.g. "Tischen" -> "Tisch").
    const byKey = new Map(defs.map(d => [matchKey(d.de), d]));
    idxs.forEach((i, pos) => {
      const d = byKey.get(matchKey(headwords[i].de)) ?? (defs.length === idxs.length ? defs[pos] : undefined);
      if (d) slots[i] = { word: { ...d, id: newCustomWordId(), level: bookId }, source: 'ai' };
    });
  }, () => onProgress({ stage: 'defining', done: ++done, total: batches.length }));

  // Two headwords can still end up as the same word once resolved ("im
  // Norden" and "der Norden" on different pages) — keep the first.
  const seenWords = new Set<string>();
  const candidates = slots.filter((s): s is ImportCandidate => {
    if (!s) return false;
    const k = `${s.word.article ?? ''} ${matchKey(s.word.de)}`;
    if (seenWords.has(k)) return false;
    seenWords.add(k);
    return true;
  });

  return {
    candidates,
    aiCalls,
    headwordCount: headwords.length,
  };
}

// --- Book codes (see supabase/functions/share-book) ---

export interface SharedBook {
  code: string;
  name: string;
  sourcePages: string;
  wordCount: number;
  words: Omit<Word, 'id' | 'level'>[];
}

export class ShareLimitReachedError extends Error {}

// Copies the book's current word list to the server and returns its code
// (or the code it already has). Only words are shared, never progress.
export async function shareImportedBook(bookId: BookLevelId): Promise<string> {
  const book = getImportedBook(bookId);
  if (!book) throw new Error('Book not found');
  if (book.shareCode) return book.shareCode;
  const words = Object.values(getAllCustomWordsForLevel(bookId)).map(({ id: _id, level: _level, ...rest }) => rest);
  const { data, error } = await supabase.functions.invoke<{ code?: string; limitReached?: boolean }>('share-book', {
    body: { action: 'create', name: book.name, sourcePages: book.sourcePages, words },
  });
  if (error || !data) throw new Error("Couldn't create a code. Check your connection and try again.");
  if (data.limitReached) throw new ShareLimitReachedError("You've shared a lot of books today — try again tomorrow.");
  if (!data.code) throw new Error("Couldn't create a code.");
  setImportedBookShareCode(bookId, data.code);
  scheduleSync();
  return data.code;
}

export function normalizeBookCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// join=true counts it as a join (only on the final "add" step, not the
// preview), so the sharer could one day see how many classmates joined.
export async function fetchSharedBook(code: string, join = false): Promise<SharedBook | null> {
  const { data, error } = await supabase.functions.invoke<{ found?: boolean; book?: SharedBook }>('share-book', {
    body: { action: 'get', code: normalizeBookCode(code), join },
  });
  if (error) throw new Error("Couldn't reach the server. Check your connection and try again.");
  return data?.found && data.book ? data.book : null;
}

// Adds a shared book as this learner's own imported book: fresh book id
// and word ids (ids are per-device-unique; reusing the sharer's would
// collide if the same person joined on a device that already has it).
export function addSharedBook(shared: SharedBook, cefrLevel: CefrLevel): ImportedBook {
  const id = newBookId();
  const book: ImportedBook = {
    id,
    name: shared.name,
    createdAt: new Date().toISOString(),
    wordCount: shared.words.length,
    sourcePages: shared.sourcePages,
    shareCode: shared.code,
    cefrLevel,
  };
  saveImportedBook(book, shared.words.map(w => ({ ...w, id: newCustomWordId(), level: id }) as Word));
  scheduleSync();
  return book;
}
