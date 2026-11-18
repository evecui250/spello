// Estimated OpenAI cost of ai_usage rows — shared by admin-stats and
// send-report so /admin and the emailed reports always agree.
//
// USD per 1M units. Most models log real tokens; two log something else:
// - gpt-4o-mini-tts / tts-1-hd (generate-word-audio): input_tokens holds the
//   spoken text's CHARACTER count (output 0), so the rate here is per
//   million characters — for gpt-4o-mini-tts, roughly its ~$0.015/min of
//   audio at ~800 characters a minute.
// - gpt-4o-mini-transcribe: input_tokens counts audio + prompt tokens,
//   priced at the audio rate.
// Check OpenAI's pricing page if these drift.
export const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.60 },
  'gpt-4o': { inputPerM: 2.50, outputPerM: 10.00 },
  'gpt-5.6-luna': { inputPerM: 0.20, outputPerM: 1.20 },
  'gpt-5.6-terra': { inputPerM: 2.00, outputPerM: 12.00 },
  'tts-1-hd': { inputPerM: 30.00, outputPerM: 0 },
  'gpt-4o-mini-tts': { inputPerM: 18.75, outputPerM: 0 },
  'gpt-4o-mini-transcribe': { inputPerM: 3.00, outputPerM: 5.00 },
};
// A model not in the table (a future swap nobody updated here) is costed
// at gpt-4o-mini's rate rather than $0 or a crash.
const DEFAULT_PRICING = MODEL_PRICING['gpt-4o-mini'];

export function costUsd(rows: { model?: string | null; input_tokens: number; output_tokens: number }[]): number {
  let total = 0;
  for (const r of rows) {
    const pricing = (r.model && MODEL_PRICING[r.model]) || DEFAULT_PRICING;
    total += (r.input_tokens ?? 0) * pricing.inputPerM + (r.output_tokens ?? 0) * pricing.outputPerM;
  }
  return Math.round(total / 1000000 * 10000) / 10000;
}
