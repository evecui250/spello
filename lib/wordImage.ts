import { Word } from './words';

// Pre-generated illustrations (gpt-image-1) live under /public/images/words,
// named by word id — currently only covers the ~94 of A1's 220 bootstrap
// words with a clear, concrete, single-image depiction (see
// scripts/generate-bootstrap-images.py). Callers must handle a 404 (e.g. an
// <img onError>) since most words don't have one yet.
export function imageUrlForWord(word: Word): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/images/words/${word.id}.webp`;
}
