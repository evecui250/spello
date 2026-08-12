'use client';

import { supabase } from './supabase';

// Always succeeds now — see correct-sentence's own comment for why: an
// unusable/absent attempt falls back to a fresh direct translation
// server-side rather than reporting failure, so there's no more "not
// used" case for callers to handle.
export interface SentenceCorrectionResult {
  sentence: string;
  wordForm: string;
  lemmas: Record<string, string>;
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
  if (error) throw error;
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
  if (error) throw error;
  if (data?.limitReached) throw new DailyLimitReachedError();
  if (!data?.sentence || !data?.wordForm) throw new Error('Malformed AI response');
  const lemmas = data?.lemmas && typeof data.lemmas === 'object' ? data.lemmas : {};
  return { sentence: data.sentence, wordForm: data.wordForm, lemmas };
}
