import { Word } from './words';

// Pre-generated illustrations (gpt-image-1) live under /public/images/words,
// named by word id — covers whichever words have a clear, concrete,
// single-image depiction (see scripts/generate-bootstrap-images.py), which
// is still a minority of the full corpus. See lib/wordImageManifest.ts
// (WORDS_WITH_IMAGES) for the actual up-to-date set of ids this covers —
// check that BEFORE calling this, rather than requesting a URL and
// handling a 404, so a word with no image never causes a request or a
// layout flash at all (see RoundWordImage in DailySessionFlow.tsx).
export function imageUrlForWord(word: Word): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/images/words/${word.id}.webp`;
}
