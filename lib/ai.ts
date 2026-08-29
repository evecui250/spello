'use client';

import { FunctionsFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { WordType } from './words';

// Always succeeds now — see correct-sentence's own comment for why: an
// unusable/absent attempt falls back to a fresh direct translation
// server-side rather than reporting failure, so there's no more "not
// used" case for callers to handle.
export interface SentenceCorrectionResult {
  sentence: string;
  wordForm: string;
}

// Thrown by generateSentence/correctSentence when the server-side daily cap
// (see the Edge Functions' own DAILY_AI_CALL_LIMIT) has been hit — a
// distinct type so callers can show a friendly "come back tomorrow" message
// instead of the generic connection-error retry prompt.
export class DailyLimitReachedError extends Error {
  constructor() {
    super('Daily AI usage limit reached');
    this.name = 'DailyLimitReachedError';
  }
}

// Thrown specifically when the request never reached the Edge Function at
// all (supabase-js's own FunctionsFetchError — a real network-level
// failure, distinct from FunctionsHttpError/FunctionsRelayError, which mean
// the request DID arrive but got an error response). Worth telling apart
// from a generic failure: this is the signature of "can't reach Supabase
// from here" (a flaky connection, or a region where it's blocked/
// unreachable) rather than an ordinary AI/API hiccup — see
// DailySessionFlow's handleAiUnreachable for what callers do with this.
export class AIUnreachableError extends Error {
  constructor() {
    super('Could not reach the AI service');
    this.name = 'AIUnreachableError';
  }
}

function rethrow(error: unknown): never {
  if (error instanceof FunctionsFetchError) throw new AIUnreachableError();
  throw error;
}

// supabase-js's own invoke() has no timeout of its own — a stalled
// connection (poor mobile signal, a dropped packet with no RST) can leave
// the underlying fetch neither resolving nor rejecting, which every
// caller here previously just awaited forever. That read as a card stuck
// on "Preparing an example sentence…"/"Checking…" with no way out short
// of leaving the page — the exact real report this was added for. Every
// invoke() below now races against this timeout and surfaces the same
// AIUnreachableError a genuine network failure already does, so a hang
// reaches the same retry-capable UI instead of hanging indefinitely.
const AI_CALL_TIMEOUT_MS = 20000;
function invokeWithTimeout<T>(fnName: string, body: object): Promise<{ data: T | null; error: unknown }> {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ data: null, error: new AIUnreachableError() });
    }, AI_CALL_TIMEOUT_MS);
    supabase.functions.invoke(fnName, { body }).then(
      result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result as { data: T | null; error: unknown });
      },
      err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ data: null, error: err });
      },
    );
  });
}


export interface AiUsageStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

// Reads this user's own ai_usage rows (RLS-scoped to auth.uid()) to power the
// Settings-page spend tracker — Supabase's own dashboard is the source of
// truth for actual billing, this is just a convenient at-a-glance total.
export async function getAiUsageStats(): Promise<AiUsageStats | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from('ai_usage')
    .select('input_tokens, output_tokens');
  if (error || !data) return null;
  return {
    calls: data.length,
    inputTokens: data.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0),
    outputTokens: data.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0),
  };
}

export interface GeneratedSentence {
  sentence: string;
  // Chinese translation of `sentence`, only requested/returned when
  // nativeLanguage is 'zh' — a pure display-layer addition. The underlying
  // sentence generation itself always stays in English regardless (built
  // only from English known-vocabulary, per getKnownVocabulary), so this
  // never changes what's actually sent to correctSentence below.
  sentenceZh?: string;
}

// Generates the English sentence for round 1's translation exercise, built
// only from vocabulary the learner already knows (see lib/practice.ts's
// getKnownVocabulary) plus the new word itself. Same key-handling rationale
// as correctSentence below. Throws on failure — callers should catch and
// show a retry.
export async function generateSentence(
  wordId: string,
  wordDe: string,
  wordEn: string,
  level: string,
  knownVocabulary: string[],
  nativeLanguage: 'en' | 'zh' = 'en',
): Promise<GeneratedSentence> {
  const { data, error } = await invokeWithTimeout<{ sentence?: string; sentenceZh?: string; limitReached?: boolean }>('generate-sentence', { wordId, wordDe, wordEn, level, knownVocabulary, nativeLanguage });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  if (!data?.sentence) throw new Error('Malformed AI response');
  return { sentence: data.sentence, sentenceZh: data.sentenceZh || undefined };
}

// Sends a learner's translation attempt (of the English sentence from
// generateSentence) to the correct-sentence Supabase Edge Function, which
// holds the OpenAI key server-side (Spello is a public static site with no
// server of its own, so a client-embedded key would be extractable by
// anyone) and logs the call to ai_usage for spend tracking. Corrects THEIR
// translation rather than substituting an independent one — see the
// function's own prompt for why. userTranslation is OPTIONAL — omit it
// entirely for "sentence writing mode" off (Settings), where the learner
// skips writing anything and this just fetches a correct example sentence
// directly. Throws on any failure — callers should catch and let the
// learner retry.
export async function correctSentence(
  wordId: string,
  wordDe: string,
  level: string,
  englishPrompt: string,
  userTranslation?: string,
): Promise<SentenceCorrectionResult> {
  const { data, error } = await invokeWithTimeout<{ sentence?: string; wordForm?: string; limitReached?: boolean }>('correct-sentence', { wordId, wordDe, level, englishPrompt, userTranslation });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  if (!data?.sentence || !data?.wordForm) throw new Error('Malformed AI response');
  return { sentence: data.sentence, wordForm: data.wordForm };
}

// A single misspelled word, paired with its correction — kept as
// STRUCTURED data (not folded into a prose `points` bullet) specifically
// so the UI can compute its own letter-level diff and underline exactly
// what changed, rather than trying to parse that back out of AI-written
// text. wrong/correct are the exact substrings as they literally appear
// in the attempt/correction (verbatim, so a client-side diff lines up).
export interface SpellingMistake {
  wrong: string;
  correct: string;
}

export interface ExplanationResult {
  points: string[];
  spelling: SpellingMistake[];
}

// The "Why?" button — a short, on-demand GRAMMAR explanation (article/
// case, adjective endings, verb tense, word order, preposition choice,
// word-class mix-ups) of a single correction, PLUS every pure spelling
// slip found separately (see SpellingMistake) — only ever called if the
// learner taps for it (never part of the main check flow, so it never
// adds latency there). `points` is capped at 3 short bullets, in the
// learner's own nativeLanguage; `spelling` has no such cap (a sentence
// with three typos should surface all three, not just the first). Shares
// correct-sentence's daily cap (see explain-correction's own comment) and
// throws the same way, so callers can reuse the exact same error handling
// (AIUnreachableError/DailyLimitReachedError) already built for corrections.
export async function explainCorrection(
  wordId: string,
  wordDe: string,
  level: string,
  originalAttempt: string,
  correctedSentence: string,
  nativeLanguage: 'en' | 'zh' = 'en',
  maxPoints?: number,
): Promise<ExplanationResult> {
  const { data, error } = await invokeWithTimeout<{ points?: string[]; spelling?: SpellingMistake[]; limitReached?: boolean }>('explain-correction', { wordId, wordDe, level, originalAttempt, correctedSentence, nativeLanguage, maxPoints });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  const points = Array.isArray(data?.points) ? data.points : [];
  const spelling = Array.isArray(data?.spelling)
    ? data.spelling.filter((s): s is SpellingMistake => !!s && typeof s.wrong === 'string' && typeof s.correct === 'string')
    : [];
  if (points.length === 0 && spelling.length === 0) throw new Error('Malformed AI response');
  return { points, spelling };
}

export interface GeneratedParagraph {
  paragraph: string; // contains [[0]], [[1]], ... placeholders -- see lib/practice.ts's parseParagraphResponse
  answers: string[]; // answers[i] is the correct inflected form for placeholder [[i]]
}

export interface ParagraphWordInput {
  de: string;
  article?: string;
  plural?: string;
  type: string;
  thirdPerson?: string;
  pastTense?: string;
  perfectTense?: string;
}

// Generates the bonus end-of-introduction cloze paragraph (see
// generate-paragraph's own comment for the full contract) for a batch of
// 3-5 of today's newly-introduced words. Same daily-cap/unreachable
// handling as every other AI call here -- callers should catch
// DailyLimitReachedError/AIUnreachableError and let the learner skip
// today's story rather than block the rest of the session on it.
export async function generateParagraphExercise(
  level: string,
  words: ParagraphWordInput[],
  themeHint?: string,
): Promise<GeneratedParagraph> {
  const { data, error } = await invokeWithTimeout<{ paragraph?: string; answers?: string[]; limitReached?: boolean }>('generate-paragraph', { level, words, themeHint });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  if (!data?.paragraph || !Array.isArray(data.answers)) throw new Error('Malformed AI response');
  return { paragraph: data.paragraph, answers: data.answers };
}

export interface LookupWordResult {
  de: string;
  article?: 'der' | 'die' | 'das';
  plural?: string;
  type: WordType;
  thirdPerson?: string;
  pastTense?: string;
  perfectTense?: string;
  en: string;
  zh: string;
  category?: string;
}

// Backs the Word List page's "look up & add" flow (see
// app/words/page.tsx) — defines a German/English/Chinese term the learner
// typed well enough to become a full Word entry (see lib/words.ts) they
// can save to their own list (see lib/storage.ts's addCustomWord).
// Returns null (not a throw) when the AI genuinely couldn't resolve it to
// a real word/phrase at all — a distinct case from every other error
// here, since it means "try a different search," not "something broke."
export async function lookupWord(term: string, level: string): Promise<LookupWordResult | null> {
  const { data, error } = await invokeWithTimeout<{ found?: boolean; word?: LookupWordResult; limitReached?: boolean }>('lookup-word', { term, level });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  if (data?.found === false) return null;
  if (!data?.word) throw new Error('Malformed AI response');
  return data.word;
}

// Generates and caches a real pronunciation clip for a just-added custom
// word (see app/words/page.tsx's handleAddWord and generate-word-audio's
// own comment for the full rationale) — fire-and-forget by design, never
// awaited in a way that blocks the add itself. Returns false (not a
// throw) on any failure, including the daily cap, since callers here
// treat this as a pure best-effort enhancement: the browser-TTS fallback
// (see lib/speech.ts) already makes the word fully usable regardless.
export async function generateWordAudio(id: string, spokenForm: string): Promise<boolean> {
  try {
    const { data, error } = await invokeWithTimeout<{ ok?: boolean; limitReached?: boolean }>('generate-word-audio', { id, spokenForm });
    if (error || !data?.ok) return false;
    return true;
  } catch {
    return false;
  }
}

export interface WordGloss {
  lemma: string;
  gloss: string;
  // Grammatical detail, only when they genuinely apply (nouns/verbs) —
  // same fields WordInfoPanel already shows for a real corpus word; a
  // real request was for GlossPopup (this data's own display, for a word
  // that ISN'T in the corpus) to show the same level of detail instead of
  // just a bare lemma+gloss.
  article?: string;
  plural?: string;
  thirdPerson?: string;
  pastTense?: string;
  perfectTense?: string;
}

// Per-word lemma + short translation for every content word in an
// AI-corrected sentence — fetched separately AFTER the correction is
// already showing (see correct-sentence's own comment on why the lemma
// map was split out), so this never delays the correction itself.
// Covers every word in the sentence, not just ones already in Spello's
// corpus (see resolveClickedWord's corpus-only fallback in lib/words.ts).
// Best-effort: throws on failure like the other AI calls here, but
// callers should treat that as "words just aren't clickable yet" rather
// than a blocking error — nothing else in the exercise depends on it.
export async function getSentenceGlosses(
  wordId: string,
  sentence: string,
  level: string,
  nativeLanguage: 'en' | 'zh' = 'en',
  // 'native-to-de': `sentence` is the round-1 PROMPT (written in
  // nativeLanguage, not yet translated) — see sentence-glosses' own
  // comment for why this still returns the same {lemma: German, gloss:
  // nativeLanguage} shape either way.
  direction: 'de-to-native' | 'native-to-de' = 'de-to-native',
): Promise<Record<string, WordGloss>> {
  const { data, error } = await invokeWithTimeout<{ words?: Record<string, WordGloss>; limitReached?: boolean }>('sentence-glosses', { wordId, sentence, level, nativeLanguage, direction });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  const words = data?.words && typeof data.words === 'object' ? data.words : {};
  return words as Record<string, WordGloss>;
}
