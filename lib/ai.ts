'use client';

import { supabase } from './supabase';

export interface SentenceCorrection {
  sentence: string;
  wordForm: string;
}

// True when a Supabase session exists — the round-1 "write your own
// sentence" exercise needs this (see correctSentence below) since the AI
// call is gated/logged per user; callers fall back to the old copy-the-word
// exercise when signed out instead of attempting the call.
export async function isSignedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
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
): Promise<SentenceCorrection> {
  const { data, error } = await supabase.functions.invoke('correct-sentence', {
    body: { wordId, wordDe, level, userSentence },
  });
  if (error) throw error;
  if (!data?.sentence || !data?.wordForm) throw new Error('Malformed AI response');
  return { sentence: data.sentence, wordForm: data.wordForm };
}
