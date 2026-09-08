// "Save the report" on the Text to Pet summary screen — flips one
// concluded session's report_saved flag so it starts showing up in My
// Notebook's Conversations tab (see pet-chat-list-reports). No AI call,
// same "just a status update, routed through a service-role function
// because RLS can't verify a claimed device_id" reasoning as
// pet-memory-decide.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  sessionId: number;
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

    const { sessionId, deviceId } = (await req.json()) as RequestBody;
    if (!sessionId || !deviceId) {
      return json({ error: 'Missing sessionId or deviceId' }, 400);
    }

    const { data: session } = await admin
      .from('pet_chat_sessions')
      .select('id, device_id, user_id, summary')
      .eq('id', sessionId)
      .single();
    if (!session || (session.device_id !== deviceId && (!userId || session.user_id !== userId))) {
      return json({ error: 'Conversation not found' }, 404);
    }
    if (!session.summary) {
      return json({ error: 'This conversation has no summary yet' }, 400);
    }

    await admin.from('pet_chat_sessions').update({ report_saved: true }).eq('id', sessionId);
    return json({ ok: true });
  } catch (err) {
    console.error('pet-chat-save-report error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
