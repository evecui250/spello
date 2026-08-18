// On-demand ("Why?" button) explanation of a single sentence correction —
// separate from correct-sentence itself so the main check stays fast;
// this only ever runs if the learner actually taps to ask. Deliberately
// GRAMMAR-focused (article/case, adjective agreement, verb tense/
// conjugation, preposition choice, word-class mix-ups like a verb used
// where a noun was needed) rather than a vague "here's what went wrong"
// gloss — that's what's actually learnable from a mistake. Answers in the
// learner's own nativeLanguage (Settings), since a grammar explanation
// they can't read isn't useful. Shares ai_usage's daily cap with
// correct-sentence (same table, counted together) rather than a separate
// budget, so this can't be used to bypass the existing per-caller limit;
// tagged kind='explanation' so admin-stats can see how much this specific
// button actually gets used, separate from corrections.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-4o-mini';

// Same flat daily cap correct-sentence uses, and counted together with it
// (see the query below, which doesn't filter by kind) — this is a bonus
// action on top of a correction that already happened, not a separate
// allowance to budget for independently.
const DAILY_AI_CALL_LIMIT = 50;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 20;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  wordId: string;
  wordDe: string;
  level: string;
  originalAttempt: string;
  correctedSentence: string;
  nativeLanguage?: 'en' | 'zh';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const callerClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await callerClient.auth.getUser();
      userId = userData.user?.id ?? null;
    }
    const forwardedFor = req.headers.get('x-forwarded-for');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : null;
    if (!userId && !ip) {
      return json({ error: 'Could not identify caller' }, 400);
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let usageQuery = supabase
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());
    usageQuery = userId ? usageQuery.eq('user_id', userId) : usageQuery.eq('ip_address', ip);
    const limit = userId ? DAILY_AI_CALL_LIMIT : DAILY_AI_CALL_LIMIT_ANONYMOUS;
    const { count: callsToday, error: countError } = await usageQuery;
    if (!countError && (callsToday ?? 0) >= limit) {
      return json({ limitReached: true });
    }

    const body = (await req.json()) as RequestBody;
    const { wordId, wordDe, level, originalAttempt, correctedSentence, nativeLanguage } = body;
    if (!wordId || !correctedSentence) {
      return json({ error: 'Missing wordId or correctedSentence' }, 400);
    }
    if ((originalAttempt?.length ?? 0) > 300 || correctedSentence.length > 300) {
      return json({ error: 'Sentence too long' }, 400);
    }
    const lang = nativeLanguage === 'zh' ? 'Chinese' : 'English';

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a German tutor. A beginner learner (CEFR ' + (level || 'A1') + ') tried to ' +
              `translate a sentence, practicing the word "${wordDe}". Their attempt: "${originalAttempt || '(nothing — they left it blank)'}". ` +
              `The correct sentence is: "${correctedSentence}". ` +
              'Compare the attempt against the correction and identify up to 3 concrete GRAMMAR ' +
              'points the learner should take away — article/case (der/die/das, den/dem/der ' +
              'agreement), adjective endings, verb tense/conjugation, preposition choice, or a ' +
              'word-class mix-up (e.g. using a verb form where a noun was needed, like ' +
              '"reisen" [to travel] instead of "Reisende" [traveler]). Do NOT mention spelling ' +
              'typos or simply say a word "was wrong" — every point must explain the actual ' +
              'grammar rule behind the fix, briefly, so it is something the learner can apply ' +
              'next time. Lead with the concrete fact itself, not a restated category label — ' +
              'say directly what the gender/case/tense/form actually IS and why, rather than a ' +
              'generic preface like "the noun\'s gender and case need to match" before finally ' +
              'giving the specific answer. For example, in Chinese, prefer a compact phrasing ' +
              'like \'"Sozialarbeiter" 是阳性，所以是der而不是die\' over a longer \'名词的性别和格' +
              '需要正确匹配，例如"der Sozialarbeiter"而不是"die Sozialarbeiter"\' — same ' +
              'information, without the throat-clearing. Skip anything you are not confident is ' +
              'actually correct — accuracy ' +
              'matters more than covering exactly 3 points; 1 or 2 solid points beats 3 shaky ' +
              'ones. If the attempt was blank, too garbled, or simply used different (not ' +
              'wrong) vocabulary with no real grammar issue to point out, return a single point ' +
              'that briefly says what the correct sentence means instead. Each point must be ' +
              `ONE short, plain sentence (no more than ~20 words), written in ${lang}, and must ` +
              'NOT repeat the full corrected sentence back — the learner can already see it. ' +
              'Respond with exactly this JSON: {"points": ["...", ...]}.',
          },
        ],
        temperature: 0.2,
        max_tokens: 260,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error (explain-correction):', errText);
      return json({ error: 'Explanation failed' }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { points?: string[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed empty — caught by the check below
    }
    const usage = result.usage ?? {};
    await supabase.from('ai_usage').insert({
      user_id: userId,
      ip_address: ip,
      word_id: wordId,
      level: level || 'unknown',
      model: MODEL,
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      kind: 'explanation',
    });

    const points = Array.isArray(parsed.points) ? parsed.points.filter(p => typeof p === 'string' && p.trim()) : [];
    if (points.length === 0) {
      console.error('Malformed AI response (explain-correction):', raw);
      return json({ error: 'AI returned an empty explanation' }, 502);
    }
    return json({ points });
  } catch (err) {
    console.error('explain-correction error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
