// One-off maintenance tool, NOT part of the live app — same posture as
// fix-exercise-prompt (undeployed again once the sweep that prompted it is
// done; no auth/rate-limiting of its own, not meant to be a standing public
// endpoint; doesn't log to ai_usage since this is offline content tooling).
//
// Checks a batch of already-baked exercisePrompt sentences for the "beraten
// bug" failure class: a sentence whose ENGLISH structure only really fits a
// different German word that happens to share the same English gloss as the
// actual target word (e.g. generate-sentence once produced "I advise you to
// check the address" for the target "beraten" — that ADVISE-SOMEONE-TO-DO-X
// shape is what "raten" fits, not "beraten"). generate-sentence's prompt now
// guards against this going forward; this function is for sweeping the
// ~3,600 sentences baked into lib/words.ts before that fix existed.
//
// Uses gpt-4o, not gpt-4o-mini — spot-checking the analogous check in
// fix-exercise-prompt found mini unreliable on nuanced judgment calls like
// this one, while the full model held up.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const MODEL = 'gpt-4o';

interface Item {
  id: string;
  wordDe: string;
  wordEn: string;
  sentence: string;
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
      .map(it => `- id "${it.id}": target German word "${it.wordDe}" (English gloss: "${it.wordEn}"). Sentence: "${it.sentence}"`)
      .join('\n');

    const systemPrompt =
      'You are auditing translation-exercise sentences for a German-learning app. Each ' +
      'sentence is meant to be translated into German using ONE specific target word, given ' +
      'below as "target German word". The bug being hunted: sometimes the ENGLISH sentence\'s ' +
      'structure only really fits a DIFFERENT German word that happens to share the same ' +
      'English gloss — not the actual target. A real confirmed example: target word "beraten" ' +
      '(gloss "to advise") with the sentence "I advise you to check the address" — that ' +
      'ADVISE-SOMEONE-TO-DO-X sentence shape is what "raten" (dative person + zu + infinitive) ' +
      'naturally fits, not "beraten" (accusative person, closer to "consult with/counsel", not ' +
      'naturally followed by "advise them TO DO a specific action"). For each item below, recall ' +
      'the target German word\'s actual grammar (case/preposition it governs, whether it takes a ' +
      'direct object vs. an infinitive clause, separable-prefix meaning shifts, reflexive use, ' +
      'etc.) and judge whether the English sentence, translated naturally, would actually call ' +
      'for THAT specific word — not merely a plausible one sharing the same rough English gloss. ' +
      'Only flag a genuine structural mismatch of this kind (a different, specific German word ' +
      'is what the sentence structure actually demands) — do NOT flag a sentence just because it ' +
      'is bland, or because several German words could loosely translate the gloss in general; ' +
      'the question is narrowly whether the SENTENCE\'S OWN STRUCTURE forces a different word ' +
      'than the target. When genuinely unsure, do not flag it.\n\n' +
      `Items to check:\n${itemsBlock}\n\n` +
      'Respond with exactly this JSON: {"results": {"<id>": {"fits": true}, "<id2>": ' +
      '{"fits": false, "reason": "short reason naming the word the sentence actually fits"}, ' +
      '...}} — one entry per id given above. Do not explain yourself outside the JSON.';

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
      console.error('OpenAI error (audit-word-fit):', errText);
      return json({ error: 'Check failed', detail: errText }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { results?: Record<string, { fits?: boolean; reason?: string }> } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'Malformed AI response', raw }, 502);
    }
    if (!parsed.results) return json({ error: 'AI response missing results', raw }, 502);

    return json({ results: parsed.results });
  } catch (err) {
    console.error('audit-word-fit error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
