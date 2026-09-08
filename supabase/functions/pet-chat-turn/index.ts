// Powers the "Text to Pet" free-form German conversation feature (see
// components/PetChatFlow.tsx). ONE structured call per user turn, doing
// four things at once: leading the conversation naturally (as the PET,
// which never corrects the learner itself), correcting the learner's
// grammar/spelling (as Spello's separate tutoring system — the corrected
// sentence is shown by the CLIENT, underneath the learner's own message,
// reusing the exact same diff/highlight UI as correct-sentence's own
// SentenceExercise), detecting mixed-language vocabulary gaps (a learner
// dropping in an English/Chinese word because they don't know the German
// one yet — tracked as its own event type, never folded into the grammar
// correction), and deciding whether the session is naturally winding down.
//
// Handles TWO shapes of request, discriminated by whether `sessionId` is
// present:
//   - start (no sessionId): creates a new pet_chat_sessions row and asks
//     the model to open the conversation — no correction/events are
//     meaningful yet (there's no user message to correct).
//   - continue (sessionId + userMessage): loads the session, its prior
//     messages (built into real chat history — never re-sent by the
//     client, so history can't be tampered with and the request payload
//     stays small), and any confirmed pet_memories for this learner, then
//     asks the model to reply/correct/classify/decide-to-conclude in one
//     shot.
//
// Same auth/rate-limit/ai_usage skeleton as correct-sentence/explain-
// correction (this codebase has no _shared/ module — every Edge Function
// duplicates this preamble by hand, see those functions' own comments) —
// works whether signed in or not, sharing the exact same daily cap/pool as
// every other AI feature.
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = 'gpt-5.6-terra';

const DAILY_AI_CALL_LIMIT = 1000;
const DAILY_AI_CALL_LIMIT_ANONYMOUS = 300;

// A normal session is 7 user messages (see PetChatFlow's own comment) —
// the server floors shouldConclude at this regardless of the model's own
// judgment, so turn 7 always offers a summary even if the model doesn't
// naturally wrap up on its own.
const NORMAL_SESSION_LENGTH = 7;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface StartBody {
  deviceId: string;
  topic: string;
  level: string;
  nativeLanguage?: 'en' | 'zh';
}
interface ContinueBody {
  deviceId: string;
  sessionId: number;
  userMessage: string;
  // Client-computed via lib/practice.ts's buildReviewWords -- no SRS logic
  // duplicated here. Used only if it naturally fits (see the prompt) --
  // never forced in.
  recentWords?: { de: string; en: string }[];
}
type RequestBody = Partial<StartBody & ContinueBody>;

type EventType = 'grammarMistake' | 'spellingMistake' | 'unknownVocabulary' | 'hintUsed' | 'successfulRecentWordUse';
interface TurnEvent { type: EventType; wrong: string; correct: string; detail: string }
interface TurnResult {
  petReply: string;
  petReplyTranslation: string;
  correctedSentence: string; // '' = nothing needed fixing
  events: TurnEvent[];
  shouldConclude: boolean;
}

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    petReply: { type: 'string' },
    petReplyTranslation: { type: 'string' },
    correctedSentence: { type: 'string' },
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['grammarMistake', 'spellingMistake', 'unknownVocabulary', 'hintUsed', 'successfulRecentWordUse'] },
          wrong: { type: 'string' },
          correct: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['type', 'wrong', 'correct', 'detail'],
        additionalProperties: false,
      },
    },
    shouldConclude: { type: 'boolean' },
  },
  required: ['petReply', 'petReplyTranslation', 'correctedSentence', 'events', 'shouldConclude'],
  additionalProperties: false,
};

// Mirrors generate-sentence's WORD_RANGE/LEVEL_VOCAB_GUIDANCE precision --
// a lookup table, not a vague instruction, so the progression the product
// spec asks for (turns 1-2 concrete, 3-4 experiences, 5-6 reasons/
// hypotheticals, 7+ reflection) actually holds turn over turn rather than
// drifting.
// Turn NORMAL_SESSION_LENGTH (7) is handled separately, below, as a
// mandatory close rather than another stage of question — see this
// function's own caller.
function turnStageGuidance(turnNumber: number): string {
  if (turnNumber <= 2) {
    return 'Ask a simple, concrete question — a preference or a plain fact (e.g. "what," "when," "how many").';
  }
  if (turnNumber <= 4) {
    return 'Ask about an experience, a description, or a natural follow-up to what they just said.';
  }
  return 'Ask for a reason, a comparison, use "Warum?", or pose a simple hypothetical situation.';
}

function levelCalibration(level: string): string {
  const lvl = (level || 'A1').toUpperCase();
  if (lvl === 'A1' || lvl === 'A2') {
    return 'Keep YOUR OWN German simple even at later turns — short sentences, high-frequency vocabulary, ' +
      'no subjunctive or abstract structures the learner has not learned yet.';
  }
  return "You may become more nuanced as the conversation progresses — more varied vocabulary and sentence " +
    'structure, still natural and conversational, never academic or exam-like.';
}

function buildSystemPrompt(opts: {
  topic: string;
  level: string;
  turnNumber: number; // the user-turn this reply is responding to (0 for the session-opening call)
  isOpening: boolean;
  recentWords?: { de: string; en: string }[];
  memories?: string[];
}): string {
  const { topic, level, turnNumber, isOpening, recentWords, memories } = opts;
  let prompt =
    'You are a friendly German-speaking pet, having a natural, casual text conversation with a ' +
    `CEFR ${level || 'A1'} learner. You are their CONVERSATION PARTNER ONLY, never their teacher — a ` +
    'separate system handles corrections, so your petReply must NEVER mention, correct, comment on, or ' +
    "even hint at their grammar, spelling, or word choice, even indirectly. Just respond naturally, as " +
    "if you simply understood what they meant.\n\n" +
    `Today's topic is: "${topic}". Stay naturally on this topic — a real conversation can drift to a ` +
    "closely related sub-thread, but don't wander to an unrelated one.\n\n" +
    'Rules for your OWN German (petReply):\n' +
    '- Natural, short, conversational — 1 to 3 sentences.\n' +
    '- Ask exactly ONE question per reply. Never stack two questions.\n' +
    '- Never repeat a question you (or a close variant of it) already asked earlier in this conversation.\n' +
    '- Never sound like a worksheet or exam ("Describe your daily routine in three sentences" is forbidden ' +
    'phrasing) — talk the way a real person texts a friend.\n' +
    `- ${levelCalibration(level)}\n` +
    'petReplyTranslation must be a natural, whole-sentence translation of petReply, meaning-for-meaning, ' +
    'in the language requested below.\n\n';

  if (isOpening) {
    prompt +=
      'This is the very first message — there is no user message yet. Open the conversation warmly ' +
      `(a short greeting) and ask one simple, concrete opening question about "${topic}". ` +
      'Return correctedSentence as an empty string and events as an empty array — there is nothing to ' +
      'correct yet.';
    return prompt;
  }

  if (turnNumber >= NORMAL_SESSION_LENGTH) {
    // A normal session is exactly NORMAL_SESSION_LENGTH user messages (see
    // PetChatFlow's own comment) -- real report: leaving this as "if it
    // feels natural, wrap up, otherwise continue" let the model keep
    // asking questions past turn 7 almost every time, since a genuinely
    // engaging conversation always "has more to say." This turn is a hard
    // close, not model discretion — petReply must NOT contain a question
    // at all.
    prompt +=
      `This is turn ${turnNumber} — the LAST turn of this session. petReply must be a warm CLOSING remark ` +
      '(e.g. thank them for the chat, wish them well) with NO question in it at all — do not ask anything ' +
      'else, no matter how naturally a follow-up question would occur to you. Set shouldConclude to true.\n\n';
  } else {
    prompt +=
      `This is turn ${turnNumber} of a normal ${NORMAL_SESSION_LENGTH}-turn session. ${turnStageGuidance(turnNumber)}\n\n` +
      'Set shouldConclude to true only if the learner themselves clearly signals they want to stop ' +
      '(e.g. says goodbye) — otherwise false.\n\n';
  }

  if (recentWords && recentWords.length > 0) {
    const list = recentWords.map(w => `${w.de} (${w.en})`).join(', ');
    prompt += `The learner has recently studied these words: ${list}. You may naturally use or encourage ` +
      'ONE of these ONLY if it genuinely fits what you would say anyway — it is completely fine to use ' +
      'none of them this turn. Never force one in.\n\n';
  }

  if (memories && memories.length > 0) {
    prompt += `You may recall these facts about the learner if genuinely relevant right now: ${memories.join('; ')}. ` +
      "Don't force a reference to one — only mention it if it fits naturally.\n\n";
  }

  prompt +=
    'Now classify the learner\'s LATEST message (the final user message below) for Spello\'s tutoring ' +
    'system — this is separate work from your own conversational reply:\n' +
    '- correctedSentence: a grammar/spelling-only clean version of what the learner meant to say. ' +
    'Return an empty string if the message needed no grammar or spelling fix at all. CRITICAL: if the ' +
    'learner dropped a non-German word/phrase into an otherwise-German message (see unknownVocabulary ' +
    'below), leave that foreign fragment EXACTLY as they wrote it inside correctedSentence — do NOT ' +
    'translate or replace it here; only fix genuine grammar/spelling around it. Vocabulary gaps are ' +
    'tracked separately and must never appear as a change inside correctedSentence.\n' +
    '- events: zero or more structured findings about the learner\'s latest message, each one of:\n' +
    '  - grammarMistake: a real grammar/word-order/word-form/meaning error. wrong = what they wrote, ' +
    'correct = the fix.\n' +
    '  - spellingMistake: a pure typo of a word they otherwise used correctly (same word, letters wrong) ' +
    '— never two genuinely different words.\n' +
    '  - unknownVocabulary: the learner used a non-German word/phrase (English, Chinese, or otherwise) ' +
    'in the middle of an otherwise-German message because they didn\'t know the German term (e.g. ' +
    '"Ich muss meinen Termin 推迟" or "Ich gehe often wandern"). wrong = the foreign word/phrase exactly ' +
    'as written, correct = the natural German replacement.\n' +
    '  - hintUsed: the learner explicitly ASKED how to say something in German (e.g. "wie sagt man...", ' +
    'or asked in English/Chinese) rather than just substituting a word directly. detail = what they ' +
    'asked about; correct = the answer you\'d give.\n' +
    '  - successfulRecentWordUse: the learner correctly used one of the recently-studied words listed ' +
    'above. correct = that word.\n' +
    '  Leave wrong/correct as an empty string for any field that genuinely does not apply to that event.\n' +
    '- Return ONLY the structured output required by the schema.';

  return prompt;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
    let usageQuery = admin
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
    if (!body.deviceId) {
      return json({ error: 'Missing deviceId' }, 400);
    }

    // gpt-5.6-terra is a reasoning-tier model -- see correct-sentence's own
    // comment for why (no custom temperature, max_completion_tokens not
    // max_tokens, reasoning_effort with a fallback, an escalation if a
    // completion comes back empty since reasoning tokens can eat the whole
    // budget). Same shape, copied deliberately rather than shared (no
    // _shared/ module in this codebase). Defaults to 'low' (not 'medium',
    // unlike correct-sentence) -- real report: this call already does FOUR
    // things at once (conversational reply, correction, event
    // classification, conclude decision), and a chat feels sluggish at
    // conversational speed in a way a one-off exercise correction doesn't
    // (a learner waits for every reply, not just occasionally). 'low'
    // still produced correct grammar/vocab-gap classification in this
    // session's own live testing -- worth revisiting if quality issues
    // show up at scale, but latency is the more pressing problem for a
    // real-time conversation right now.
    async function callOpenAI(
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
      reasoningEffort: 'medium' | 'low' = 'low',
      maxTokens = 900,
      escalated = false,
    ): Promise<{ result: Record<string, unknown>; raw: string }> {
      const completion = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages,
          reasoning_effort: reasoningEffort,
          max_completion_tokens: maxTokens,
          response_format: { type: 'json_schema', json_schema: { name: 'pet_chat_turn', strict: true, schema: TURN_SCHEMA } },
        }),
      });
      if (!completion.ok) {
        const errText = await completion.text();
        if (reasoningEffort === 'medium' && errText.toLowerCase().includes('reasoning_effort')) {
          return callOpenAI(messages, 'low', maxTokens, escalated);
        }
        console.error('OpenAI error:', errText);
        throw new Error('AI conversation call failed');
      }
      const result = await completion.json();
      const raw: string = result.choices?.[0]?.message?.content ?? '';
      if (!raw.trim() && !escalated) {
        return callOpenAI(messages, reasoningEffort, 1800, true);
      }
      return { result, raw };
    }

    async function logUsage(level: string, result: Record<string, unknown>) {
      const usage = (result.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined) ?? {};
      await admin.from('ai_usage').insert({
        user_id: userId,
        ip_address: ip,
        word_id: 'pet_chat',
        level: level || 'unknown',
        model: MODEL,
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
        kind: 'pet_chat',
      });
    }

    // ---- Start a new session ----
    if (!body.sessionId) {
      const { topic, level, nativeLanguage } = body;
      if (!topic || !level) {
        return json({ error: 'Missing topic or level' }, 400);
      }
      const { data: session, error: insertError } = await admin
        .from('pet_chat_sessions')
        .insert({ device_id: body.deviceId, user_id: userId, topic, level, native_language: nativeLanguage ?? 'en' })
        .select('id')
        .single();
      if (insertError || !session) {
        console.error('pet-chat-turn: failed to create session', insertError);
        return json({ error: 'Could not start conversation' }, 500);
      }

      const messages = [
        { role: 'system' as const, content: buildSystemPrompt({ topic, level, turnNumber: 0, isOpening: true }) },
        { role: 'user' as const, content: 'Please start the conversation.' },
      ];
      const { result, raw } = await callOpenAI(messages);
      let parsed: Partial<TurnResult> = {};
      try { parsed = JSON.parse(raw); } catch { /* caught below */ }
      if (!parsed.petReply || !parsed.petReplyTranslation) {
        console.error('pet-chat-turn: malformed opening response', raw);
        return json({ error: 'AI returned an unexpected format' }, 502);
      }
      await logUsage(level, result);
      await admin.from('pet_chat_messages').insert({
        session_id: session.id, turn_number: 0, role: 'pet', text: parsed.petReply, translation: parsed.petReplyTranslation,
      });

      return json({
        sessionId: session.id, petReply: parsed.petReply, petReplyTranslation: parsed.petReplyTranslation,
        correctedSentence: '', events: [], shouldConclude: false,
      });
    }

    // ---- Continue an existing session ----
    const { sessionId, userMessage, recentWords } = body;
    if (!userMessage || !userMessage.trim()) {
      return json({ error: 'Missing userMessage' }, 400);
    }
    if (userMessage.length > 500) {
      return json({ error: 'Message too long' }, 400);
    }

    const { data: session, error: sessionError } = await admin
      .from('pet_chat_sessions')
      .select('id, device_id, user_id, topic, level, native_language, turn_count, status')
      .eq('id', sessionId)
      .single();
    if (sessionError || !session) {
      return json({ error: 'Conversation not found' }, 404);
    }
    // sessionId is a plain sequential bigint -- without this check, anyone
    // could walk 1, 2, 3... and read/continue a stranger's conversation.
    if (session.device_id !== body.deviceId && (!userId || session.user_id !== userId)) {
      return json({ error: 'Conversation not found' }, 404);
    }
    if (session.status !== 'active') {
      return json({ error: 'This conversation has already ended' }, 400);
    }

    const { data: priorMessages } = await admin
      .from('pet_chat_messages')
      .select('role, text, corrected_text')
      .eq('session_id', sessionId)
      .order('id', { ascending: true });

    // Matches by device_id OR user_id (not just whichever the caller
    // currently is) -- a learner who started chatting anonymously and later
    // signed in on the same device should still get their earlier
    // confirmed memories, not just ones confirmed after signing in.
    const { data: memoryRows } = await admin
      .from('pet_memories')
      .select('fact')
      .eq('status', 'confirmed')
      .or(`device_id.eq.${body.deviceId}${userId ? `,user_id.eq.${userId}` : ''}`);

    const newTurnNumber = (session.turn_count ?? 0) + 1;
    const history = (priorMessages ?? []).map(m => ({
      role: (m.role === 'pet' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.role === 'user' ? (m.corrected_text ?? m.text) : m.text,
    }));

    const messages = [
      {
        role: 'system' as const,
        content: buildSystemPrompt({
          topic: session.topic, level: session.level, turnNumber: newTurnNumber, isOpening: false,
          recentWords, memories: (memoryRows ?? []).map(r => r.fact),
        }),
      },
      ...history,
      { role: 'user' as const, content: userMessage.trim() },
    ];

    const { result, raw } = await callOpenAI(messages);
    let parsed: Partial<TurnResult> = {};
    try { parsed = JSON.parse(raw); } catch { /* caught below */ }
    if (!parsed.petReply || !parsed.petReplyTranslation || typeof parsed.correctedSentence !== 'string' || !Array.isArray(parsed.events)) {
      console.error('pet-chat-turn: malformed continue response', raw);
      return json({ error: 'AI returned an unexpected format' }, 502);
    }
    await logUsage(session.level, result);

    const correctedSentence = parsed.correctedSentence.trim();
    const events = parsed.events.filter((e): e is TurnEvent =>
      !!e && typeof e.type === 'string' && ['grammarMistake', 'spellingMistake', 'unknownVocabulary', 'hintUsed', 'successfulRecentWordUse'].includes(e.type));
    const shouldConclude = !!parsed.shouldConclude || newTurnNumber >= NORMAL_SESSION_LENGTH;

    await admin.from('pet_chat_messages').insert([
      { session_id: sessionId, turn_number: newTurnNumber, role: 'user', text: userMessage.trim(), corrected_text: correctedSentence || null },
      { session_id: sessionId, turn_number: newTurnNumber, role: 'pet', text: parsed.petReply, translation: parsed.petReplyTranslation },
    ]);
    if (events.length > 0) {
      await admin.from('pet_chat_events').insert(
        events.map(e => ({ session_id: sessionId, turn_number: newTurnNumber, event_type: e.type, wrong: e.wrong ?? '', correct: e.correct ?? '', detail: e.detail ?? '' })),
      );
    }
    await admin.from('pet_chat_sessions').update({ turn_count: newTurnNumber, updated_at: new Date().toISOString() }).eq('id', sessionId);

    return json({
      sessionId, petReply: parsed.petReply, petReplyTranslation: parsed.petReplyTranslation,
      correctedSentence, events, shouldConclude,
    });
  } catch (err) {
    console.error('pet-chat-turn error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
