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

    const reports = (sessions ?? []).map(s => ({
      sessionId: s.id,
      topic: s.topic,
      level: s.level,
      createdAt: s.created_at,
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
