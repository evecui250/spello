// One-off maintenance tool, NOT part of the live app — second-pass filter
// companion to audit-word-fit. audit-word-fit's first pass flagged 413/3198
// baked sentences (13%), but a manual spot-check of 25 flags found ~40%
// were false positives: the auditor treated "a different, perhaps more
// common word ALSO fits" as a bug, when the actual failure class we're
// hunting is narrower — the target word being flatly WRONG/unnatural for
// the sentence, the way "raten" is required and "beraten" is impossible for
// "I advise you to check the address." A valid synonym existing is not a
// bug (many English glosses have two decent German renderings); this pass
// asks the sharper, narrower question directly.
//
// Same posture as audit-word-fit/fix-exercise-prompt: undeployed again once
// the sweep is done, no auth of its own, doesn't log to ai_usage.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o';

interface Item {
  id: string;
  wordDe: string;
  wordEn: string;
  sentence: string;
  firstPassReason: string;
}

interface RequestBody {
  items: Item[];
}

Deno.serve(async (req: Request) => {
  try {
    const body = (await req.json()) as RequestBody;
    const { items } = body;
    if (!Array.isArray(items) || items.length === 0) {
      return json({ error: 'Missing items' }, 400);
    }

    const itemsBlock = items
      .map(it => `- id "${it.id}": target German word "${it.wordDe}" (English gloss: "${it.wordEn}"). Sentence: "${it.sentence}". A first-pass reviewer suggested this instead fits: "${it.firstPassReason}"`)
      .join('\n');

    const systemPrompt =
      'You are the SECOND, stricter reviewer in a two-pass audit of translation-exercise ' +
      'sentences for a German-learning app. A first-pass reviewer already flagged each item ' +
      'below as suspicious. Your job is to confirm or reject each flag using a narrower test.\n\n' +
      'REJECT the flag (say confirmed: false) if translating the sentence using the target ' +
      'German word — in a natural inflected form — would still produce a correct, natural ' +
      'German sentence, EVEN IF a different word is more common or was the first-pass ' +
      'reviewer\'s preference. A valid synonym existing is NOT a bug — many English glosses ' +
      'have more than one decent German rendering, and that alone must not be flagged.\n\n' +
      'CONFIRM the flag (say confirmed: true) only if using the target word would actually be ' +
      'WRONG or distinctly unnatural for this sentence — e.g. it is the wrong part of speech ' +
      'for how the English sentence uses the gloss word (an English word used as a verb, like ' +
      '"I will direct the group", while the German target is only an adjective/adverb like ' +
      '"direkt"), or it is a different, unrelated sense of a polysemous English gloss (English ' +
      '"so" the degree-adverb in "so big" vs. German "also" which means "so/thus" the discourse ' +
      'connective, a totally different word), or the sentence\'s grammatical structure ' +
      '(case/preposition/complement type) specifically calls for the OTHER word the way "I ' +
      'advise you to check the address" calls for "raten" and structurally cannot take ' +
      '"beraten". When genuinely unsure, or when it is really just "another word would also ' +
      'work," reject the flag.\n\n' +
      `Items to review:\n${itemsBlock}\n\n` +
      'Respond with exactly this JSON: {"results": {"<id>": {"confirmed": true, "reason": ' +
      '"short reason"}, "<id2>": {"confirmed": false}, ...}} — one entry per id given above. ' +
      'Do not explain yourself outside the JSON.';

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }],
        temperature: 0.2,
        max_tokens: 200 + items.length * 60,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error (confirm-word-fit):', errText);
      return json({ error: 'Check failed', detail: errText }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { results?: Record<string, { confirmed?: boolean; reason?: string }> } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'Malformed AI response', raw }, 502);
    }
    if (!parsed.results) return json({ error: 'AI response missing results', raw }, 502);

    return json({ results: parsed.results });
  } catch (err) {
    console.error('confirm-word-fit error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
