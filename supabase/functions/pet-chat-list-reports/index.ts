// Lists every saved Text to Pet report (report_saved=true) for the
// caller's device/account, newest first — backs My Notebook's
// Conversations tab (see app/mistakes/page.tsx). No AI call — the summary
// JSON was already computed and persisted once by pet-chat-summary.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  deviceId: string;
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

    const { deviceId } = (await req.json()) as RequestBody;
    if (!deviceId) {
      return json({ error: 'Missing deviceId' }, 400);
    }

    let query = admin
      .from('pet_chat_sessions')
      .select('id, topic, level, created_at, summary')
      .eq('report_saved', true)
      .order('created_at', { ascending: false });
    query = userId ? query.or(`device_id.eq.${deviceId},user_id.eq.${userId}`) : query.eq('device_id', deviceId);
    const { data: sessions } = await query;
    const sessionIds = (sessions ?? []).map(s => s.id);

    // Full transcript per session — "a screenshot of our chatting history,"
    // per the product request, not just the aggregate stats. One query for
    // ALL saved sessions' messages/events (not one per session) — a
    // learner with many saved reports shouldn't mean N+1 round trips.
    const [{ data: allMessages }, { data: allEvents }] = sessionIds.length === 0 ? [{ data: [] }, { data: [] }] : await Promise.all([
      admin.from('pet_chat_messages').select('session_id, turn_number, role, text, corrected_text, translation').in('session_id', sessionIds).order('id', { ascending: true }),
      admin.from('pet_chat_events').select('session_id, turn_number, event_type, wrong, correct, detail').in('session_id', sessionIds).order('id', { ascending: true }),
    ]);

    const eventsBySessionTurn = new Map<string, { type: string; wrong: string; correct: string; detail: string }[]>();
    for (const e of allEvents ?? []) {
      const key = `${e.session_id}:${e.turn_number}`;
      const list = eventsBySessionTurn.get(key) ?? [];
      list.push({ type: e.event_type, wrong: e.wrong, correct: e.correct, detail: e.detail });
      eventsBySessionTurn.set(key, list);
    }
    const messagesBySession = new Map<number, unknown[]>();
    for (const m of allMessages ?? []) {
      const list = messagesBySession.get(m.session_id as number) ?? [];
      list.push(m.role === 'user'
        ? { role: 'user', text: m.text, correctedSentence: m.corrected_text ?? '', events: eventsBySessionTurn.get(`${m.session_id}:${m.turn_number}`) ?? [] }
        : { role: 'pet', text: m.text, translation: m.translation ?? '' });
      messagesBySession.set(m.session_id as number, list);
    }

    const reports = (sessions ?? []).map(s => ({
      sessionId: s.id,
      topic: s.topic,
      level: s.level,
      createdAt: s.created_at,
      transcript: messagesBySession.get(s.id) ?? [],
      ...(s.summary as Record<string, unknown>),
    }));

    return json({ reports });
  } catch (err) {
    console.error('pet-chat-list-reports error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
