'use client';

// Client-only PDF text extraction for book import (see
// components/ImportBookModal.tsx). The PDF never leaves the device: it's
// parsed here and only the requested pages' plain text goes on to the AI.
// That keeps the learner's file private, sidesteps Edge Function body
// limits, and works under `output: 'export'`/Capacitor with no server.
// The legacy build is used deliberately: the modern one relies on very
// recent JS APIs that older iOS WKWebViews don't have.

// Hard upper bound on pages per import — an import beyond this would blow
// past MAX_WORDS_PER_BOOK anyway, and every page costs AI calls.
export const MAX_IMPORT_PAGES = 30;

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  return pdfjs;
}

export interface PdfPagePreview {
  page: number;          // 1-based index in the PDF file itself
  printedNumber?: string; // the number printed on the page, when it differs
  title: string;         // first meaningful line, for picking pages by eye
  hasText: boolean;
}

function pageLines(content: { items: unknown[] }): string[] {
  let text = '';
  for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
    if (typeof item.str !== 'string') continue;
    text += item.str + (item.hasEOL ? '\n' : ' ');
  }
  return text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// One preview per page, so the learner picks pages by their heading
// instead of typing a range — the pages they want are often not
// consecutive (vocabulary sections interleaved with grammar tables), and
// a coursebook excerpt's printed page numbers ("p. 73") rarely match the
// PDF's own 1..N numbering, which is what a typed range would need.
export async function getPdfPagePreviews(file: File): Promise<PdfPagePreview[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const all: string[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      all.push(pageLines(await page.getTextContent()));
      page.cleanup();
    }
    // A running header/footer repeats on most pages — never a useful title.
    const freq = new Map<string, number>();
    for (const lines of all) for (const l of new Set(lines)) freq.set(l, (freq.get(l) ?? 0) + 1);
    const repeated = (l: string) => all.length >= 3 && (freq.get(l) ?? 0) >= all.length / 2;
    return all.map((lines, i) => {
      // Some PDFs carry the number twice in their text layer ("6 6").
      const pageNum = (l: string | undefined) => l?.match(/^(\d{1,4})(?: \1)*$/)?.[1];
      const printedRaw = pageNum(lines[lines.length - 1]);
      const printed = printedRaw && Number(printedRaw) !== i + 1 ? printedRaw : undefined;
      const title = lines.find(l => !repeated(l) && !pageNum(l) && l.length >= 3) ?? '';
      return { page: i + 1, printedNumber: printed, title: title.slice(0, 80), hasText: lines.length > 0 };
    });
  } finally {
    await doc.destroy();
  }
}

// [1,2,3,5,6,16] -> "1-3, 5-6, 16" — stored on the book as provenance.
export function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

// One string per requested page, lines rebuilt from pdf.js's positioned
// text items (a new line wherever the item says it ends one).
export async function extractPdfPagesText(file: File, pages: number[]): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const out: string[] = [];
    for (const n of pages) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      out.push(pageLines(content).join('\n'));
      page.cleanup();
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

// One AI extraction call per chunk: a page is never merged with another,
// and a long page is split on line boundaries. Measured on a real
// coursebook PDF: packing ~3 pages into one ~5,000-char call made the model
// silently skip about a quarter of the entries (mostly verbs/adjectives),
// while the same pages sent one at a time came back complete. A few extra
// small calls are far cheaper than missing vocabulary.
export function chunkPageTexts(pageTexts: string[], maxChars = 2500): string[] {
  const chunks: string[] = [];
  for (const text of pageTexts) {
    if (!text) continue;
    let cur = '';
    for (const line of text.split('\n')) {
      const l = line.slice(0, maxChars);
      if (cur && cur.length + l.length + 1 > maxChars) { chunks.push(cur); cur = ''; }
      cur = cur ? `${cur}\n${l}` : l;
    }
    if (cur) chunks.push(cur);
  }
  return chunks;
}

// A vocabulary section often overflows onto the next page, and that page
// carries no section heading of its own ("Kulturelles Leben" continuing
// "Wortschatz – Leben in Zürich") — easy to forget to tick. In a PDF that
// is an excerpt of a larger book (its printed page numbers jump somewhere,
// e.g. 6, 7, 35, 60, 73, 74…), a page whose printed number directly
// follows the previous page's is that page's continuation. A PDF whose
// numbering never jumps (a whole book, or no printed numbers at all) gives
// no such signal, so nothing is treated as a continuation there — otherwise
// ticking one page would cascade to the end of the book.
// Returns: page -> the page it continues.
export function findContinuationPages(previews: PdfPagePreview[]): Map<number, number> {
  const nums = previews.map(p => (p.printedNumber ? Number(p.printedNumber) : null));
  const isExcerpt = nums.some((n, i) => i > 0 && n !== null && nums[i - 1] !== null && n !== nums[i - 1]! + 1);
  const out = new Map<number, number>();
  if (!isExcerpt) return out;
  for (let i = 1; i < previews.length; i++) {
    if (nums[i] !== null && nums[i - 1] !== null && nums[i] === nums[i - 1]! + 1) out.set(previews[i].page, previews[i - 1].page);
  }
  return out;
}

const VOCAB_HEADING_RE = /wortschatz|vokabel|wortliste|wörterliste|vocabulary|glossar/i;

// Pages whose heading names a vocabulary section, plus each one's
// continuation pages — the one-tap "Select vocabulary pages" pick.
export function findVocabularyPages(previews: PdfPagePreview[]): number[] {
  const cont = findContinuationPages(previews);
  const picked = new Set<number>();
  for (const p of previews) {
    if (VOCAB_HEADING_RE.test(p.title) || (cont.has(p.page) && picked.has(cont.get(p.page)!))) picked.add(p.page);
  }
  return [...picked];
}
