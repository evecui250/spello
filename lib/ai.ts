'use client';

import { FunctionsFetchError } from '@supabase/supabase-js';
import { supabase } from './supabase';

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
  const { data, error } = await supabase.functions.invoke('generate-sentence', {
    body: { wordId, wordDe, wordEn, level, knownVocabulary, nativeLanguage },
  });
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
  const { data, error } = await supabase.functions.invoke('correct-sentence', {
    body: { wordId, wordDe, level, englishPrompt, userTranslation },
  });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  if (!data?.sentence || !data?.wordForm) throw new Error('Malformed AI response');
  return { sentence: data.sentence, wordForm: data.wordForm };
}

// The "Why?" button — a short, on-demand GRAMMAR explanation (article/
// case, adjective endings, verb tense, preposition choice, word-class
// mix-ups — not spelling, not a vague "this was wrong") of a single
// correction, only ever called if the learner taps for it (never part of
// the main check flow, so it never adds latency there). Returns up to 3
// short bullet points, in the learner's own nativeLanguage. Shares
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
): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke('explain-correction', {
    body: { wordId, wordDe, level, originalAttempt, correctedSentence, nativeLanguage, maxPoints },
  });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  if (!Array.isArray(data?.points) || data.points.length === 0) throw new Error('Malformed AI response');
  return data.points as string[];
}

export interface WordGloss {
  lemma: string;
  gloss: string;
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
  const { data, error } = await supabase.functions.invoke('sentence-glosses', {
    body: { wordId, sentence, level, nativeLanguage, direction },
  });
  if (error) rethrow(error);
  if (data?.limitReached) throw new DailyLimitReachedError();
  const words = data?.words && typeof data.words === 'object' ? data.words : {};
  return words as Record<string, WordGloss>;
}
