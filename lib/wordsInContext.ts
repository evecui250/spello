'use client';

import { Word, Level } from './words';
import { ParagraphExercise } from './storage';
import { generateParagraphExercise, AIUnreachableError, DailyLimitReachedError } from './ai';
import { sharedCategoryHint, parseParagraphResponse, combineParagraphExercises, addDistractors } from './practice';

// One Words in Context exercise for a batch of words (see
// buildWordsInContextBatches): the AI writes a short text with a blank per
// word, then decoys are added to the tray. Shared by the Words in Context
// game (components/WordsInContextGame.tsx) and any old daily session
// still mid-exercise from when it was part of the daily flow.
// Resolves to null when the AI couldn't produce a usable text; throws
// AIUnreachableError / DailyLimitReachedError as-is.
export async function generateWordsInContextExercise(
  batch: Word[], level: Level, nativeLanguage: 'en' | 'zh', excludeWordIds: Set<string>,
): Promise<ParagraphExercise | null> {
  const generateFor = (words: Word[]) => generateParagraphExercise(
    level,
    words.map(w => ({ de: w.de, en: w.en, article: w.article, plural: w.plural, type: w.type, thirdPerson: w.thirdPerson, pastTense: w.pastTense, perfectTense: w.perfectTense })),
    sharedCategoryHint(words),
    nativeLanguage,
  ).then(({ paragraph, answers, sentences, translations }) => parseParagraphResponse(paragraph, answers, words, sentences, translations));
  // A failed generation (beyond the two errors splitting can't help with)
  // resolves to null, so "the AI gave up after its own retry" and "came
  // back but didn't parse" are handled the same way below.
  const tryGenerate = (words: Word[]): Promise<ParagraphExercise | null> => generateFor(words).then(
    parsed => parsed,
    err => { if (err instanceof AIUnreachableError || err instanceof DailyLimitReachedError) throw err; return null; },
  );

  let parsed = await tryGenerate(batch);
  // Last resort: two smaller texts stitched into one exercise (see
  // combineParagraphExercises).
  if (!parsed && batch.length >= 2) {
    const mid = Math.ceil(batch.length / 2);
    const [a, b] = await Promise.all([tryGenerate(batch.slice(0, mid)), tryGenerate(batch.slice(mid))]);
    parsed = a && b ? combineParagraphExercises(a, b) : null;
  }
  return parsed ? addDistractors(parsed, batch, excludeWordIds) : null;
}
