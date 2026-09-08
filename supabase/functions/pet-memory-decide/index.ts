// Confirms or dismisses one "pet memory" candidate fact (see
// pet-chat-summary, which inserts these as status='pending' — never
// silently promoted to permanent, per the product requirement that a
// candidate must always be user-visible/confirmable first). No AI call
// here at all, just a status update — but still routed through a service-
// role Edge Function rather than a direct client write, since RLS has no
// way to verify a claimed device_id (see pet_chat's own migration
// comment), and this is the one place that check actually happens.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  id: number;
  deviceId: string;
  decision: 'confirmed' | 'dismissed';
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

    const { id, deviceId, decision } = (await req.json()) as RequestBody;
    if (!id || !deviceId || (decision !== 'confirmed' && decision !== 'dismissed')) {
      return json({ error: 'Missing or invalid fields' }, 400);
    }

    const { data: row } = await admin.from('pet_memories').select('id, device_id, user_id').eq('id', id).single();
    if (!row || (row.device_id !== deviceId && (!userId || row.user_id !== userId))) {
      return json({ error: 'Memory not found' }, 404);
    }

    await admin.from('pet_memories').update({ status: decision, decided_at: new Date().toISOString() }).eq('id', id);
    return json({ ok: true });
  } catch (err) {
    console.error('pet-memory-decide error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
