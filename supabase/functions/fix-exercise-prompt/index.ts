// One-off maintenance tool, NOT part of the live app — companion to
// scripts/generate-exercise-prompts.py's original batch generation. That
// script constrains the AI to a level's known-vocabulary list when first
// baking each word's exercisePrompt, but never verifies the AI actually
// honored that constraint (it only retries on sentence LENGTH). This
// function does a combined validate-then-fix pass over a BATCH of
// already-baked sentences sharing the same level (and so the same known-
// vocabulary list) — batching specifically because sending that list once
// per item, one item per call, blew through this account's gpt-4o TPM
// rate limit almost immediately and made the vocab-list tokens dominate
// total cost; batching amortizes it across many items per call instead.
// Deliberately undeployed again once the corpus-wide sweep that prompted
// it is done — see the sweep script for how it's driven — since it holds
// no auth/rate-limiting of its own and isn't meant to be a standing
// public endpoint. Doesn't log to ai_usage: this is offline content
// tooling, not real app/user activity, and folding it in would skew
// admin-stats' usage numbers.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
// Spot-checking gpt-4o-mini showed it repeatedly flagged ordinary
// everyday words ("good", "very", "young", "give", "now") as violations
// despite explicit instructions and examples not to — it defaults to
// "not literally on the list -> flag it" rather than making the nuanced
// everyday-vs-specialized judgment call this check actually needs. The
// full model gave meaningfully better judgment in the same spot-check.
const MODEL = 'gpt-4o';

interface Item {
  id: string;
  targetEn: string;
  targetDe: string;
  sentence: string;
  sentenceZh?: string;
}

interface RequestBody {
  level: string;
  knownVocab: string[];
  minWords: number;
  maxWords: number;
  items: Item[];
}

Deno.serve(async (req: Request) => {
  try {
    const body = (await req.json()) as RequestBody;
    const { level, knownVocab, minWords, maxWords, items } = body;
    if (!level || !Array.isArray(knownVocab) || !Array.isArray(items) || items.length === 0) {
      return json({ error: 'Missing required field' }, 400);
    }

    const itemsBlock = items
      .map(it => `- id "${it.id}": target word "${it.targetEn}" (German: "${it.targetDe}"). Sentence: "${it.sentence}"`)
      .join('\n');

    const systemPrompt =
      `You are reviewing a batch of translation-exercise sentences for CEFR ${level} German ` +
      'learners. Each sentence practices its own target word. The goal is simply that each ' +
      'sentence stays readable for a learner at this level — it does NOT need to use only ' +
      `words from a fixed list. This level's corpus already includes: ${knownVocab.join(', ')} ` +
      '(own natural inflections count too — plural, verb tense, participle, comparative, etc.). ' +
      'In a given sentence, flag a word as a violation ONLY if it is BOTH (1) not that ' +
      "sentence's own target word or one of the corpus words/inflections above, AND (2) a " +
      'genuinely specialized, technical, formal, or abstract word that an ordinary beginner ' +
      'would NOT already know from everyday life — for example "policy", "insurance", ' +
      '"marketing", "civil servant", "philosophy", "unemployment", "innovative", ' +
      '"comprehensive", "colonization", "industrialization". Do NOT flag ordinary, concrete, ' +
      'everyday words just because they happen to not be on the corpus list — common people/ ' +
      'family/food/home/body/weather/feelings/actions/objects/time/place/number/color/size/ ' +
      'quality words (e.g. "good", "bad", "happy", "want", "give", "near", "yesterday", ' +
      '"young", "very", "dinner", "breakfast", "idea", "address", "airplane", "offer", ' +
      '"answer", "bakery", "brother", "week") are things any real beginner already knows from ' +
      "life regardless of this app's own curriculum, and must always be treated as fine — as " +
      'should any ordinary function/grammar word (articles, pronouns, prepositions, ' +
      'conjunctions, auxiliary/modal verbs, basic quantifiers). Each sentence must also stay ' +
      `between ${minWords} and ${maxWords} words long (inclusive), and its own target word ` +
      '(in any natural inflection) is REQUIRED to appear — never list the target word itself ' +
      'as a violation or drop it from a fixed sentence.\n\n' +
      `Sentences to check:\n${itemsBlock}\n\n` +
      'For each one, check it against the rule above — when genuinely unsure whether a word ' +
      'counts as "everyday" vs. "specialized", prefer NOT flagging it (a false alarm here is ' +
      'worse than missing a rare borderline case; this exists to catch clearly-too-advanced ' +
      'words, not to enforce a strict wordlist). Respond with exactly this JSON: {"results": ' +
      '{"<id>": {"ok": true}, "<id2>": {"ok": false, "violations": ["word1", ...], "sentence": ' +
      '"...", "sentenceZh": "..."}, ...}} — one entry per id given above, in the same order. ' +
      'For an "ok": false entry, "sentence"/"sentenceZh" are a new sentence (and its natural ' +
      "Chinese translation) that replaces only the flagged word(s) with everyday/known " +
      'vocabulary, staying natural, meaningful, and within that sentence\'s word-count range. ' +
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
        temperature: 0.3,
        max_tokens: 400 + items.length * 130,
      }),
    });

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI error (fix-exercise-prompt):', errText);
      return json({ error: 'Check failed', detail: errText }, 502);
    }

    const result = await completion.json();
    const raw: string = result.choices?.[0]?.message?.content ?? '{}';
    let parsed: { results?: Record<string, { ok?: boolean; violations?: string[]; sentence?: string; sentenceZh?: string }> } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: 'Malformed AI response', raw }, 502);
    }
    if (!parsed.results) return json({ error: 'AI response missing results', raw }, 502);

    // Mechanical safety net: spot-checking found the model sometimes
    // flags an item's OWN target word as a "violation" (losing track of
    // which target belongs to which sentence across a multi-item batch)
    // and produces a "fixed" sentence that no longer teaches the word at
    // all — worse than leaving the original alone. Prompt wording alone
    // didn't reliably prevent this, so every "ok: false" fix is checked
    // here for actually containing its own target word (a loose
    // substring check against either the whole target phrase or any of
    // its individual words, to tolerate inflections) before being
    // trusted; a fix that drops the target word is downgraded back to
    // "ok: true" (i.e. discarded, leaving the original sentence as-is)
    // rather than silently applied.
    const byId = new Map(items.map(it => [it.id, it]));
    for (const [id, r] of Object.entries(parsed.results)) {
      if (r?.ok !== false || !r.sentence) continue;
      const target = byId.get(id)?.targetEn;
      if (!target) continue;
      const hay = r.sentence.toLowerCase();
      const targetWords = target.toLowerCase().split(/[^a-z']+/).filter(w => w.length > 2 && w !== 'to');
      const present = targetWords.length === 0 || targetWords.some(w => hay.includes(w));
      if (!present) {
        parsed.results[id] = { ok: true };
      }
    }

    return json({ results: parsed.results });
  } catch (err) {
    console.error('fix-exercise-prompt error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
