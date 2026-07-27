'use client';

import { supabase } from './supabase';

export type SentenceCorrectionResult =
  | { used: true; sentence: string; wordForm: string }
  | { used: false };

// Fires immediately with the current signed-in state, then again on every
// sign-in/out — safe against a freshly-mounted page racing the Supabase
// client still finishing its own session rehydration from storage (a
// one-shot getSession() check right at mount could otherwise read `null`
// briefly). Returns an unsubscribe function.
export function watchSignedIn(cb: (signedIn: boolean) => void): () => void {
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(!!session);
  });
  return () => sub.subscription.unsubscribe();
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

// Sends a learner's rough sentence attempt to the correct-sentence Supabase
// Edge Function, which holds the OpenAI key server-side (Spello is a public
// static site with no server of its own, so a client-embedded key would be
// extractable by anyone) and logs the call to ai_usage for spend tracking.
// Throws on any failure — callers should catch and let the learner retry.
export async function correctSentence(
  wordId: string,
  wordDe: string,
  level: string,
  userSentence: string,
): Promise<SentenceCorrectionResult> {
  const { data, error } = await supabase.functions.invoke('correct-sentence', {
    body: { wordId, wordDe, level, userSentence },
  });
  if (error) throw error;
  if (data?.used === false) return { used: false };
  if (!data?.sentence || !data?.wordForm) throw new Error('Malformed AI response');
  return { used: true, sentence: data.sentence, wordForm: data.wordForm };
}
