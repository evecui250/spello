'use client';

import { supabase } from './supabase';

export type SentenceCorrectionResult =
  | { used: true; sentence: string; wordForm: string }
  | { used: false };


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
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('generate-sentence', {
    body: { wordId, wordDe, wordEn, level, knownVocabulary },
  });
  if (error) throw error;
  if (!data?.sentence) throw new Error('Malformed AI response');
  return data.sentence;
}

// Sends a learner's translation attempt (of the English sentence from
// generateSentence) to the correct-sentence Supabase Edge Function, which
// holds the OpenAI key server-side (Spello is a public static site with no
// server of its own, so a client-embedded key would be extractable by
// anyone) and logs the call to ai_usage for spend tracking. Corrects THEIR
// translation rather than substituting an independent one — see the
// function's own prompt for why. Throws on any failure — callers should
// catch and let the learner retry.
export async function correctSentence(
  wordId: string,
  wordDe: string,
  level: string,
  englishPrompt: string,
  userTranslation: string,
): Promise<SentenceCorrectionResult> {
  const { data, error } = await supabase.functions.invoke('correct-sentence', {
    body: { wordId, wordDe, level, englishPrompt, userTranslation },
  });
  if (error) throw error;
  if (data?.used === false) return { used: false };
  if (!data?.sentence || !data?.wordForm) throw new Error('Malformed AI response');
  return { used: true, sentence: data.sentence, wordForm: data.wordForm };
}
