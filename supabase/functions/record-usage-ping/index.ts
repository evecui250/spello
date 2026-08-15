// Records one usage_pings row per device per day (see the migration for
// the unique (device_id, ping_date) constraint), including the request's
// real IP address -- something only the server can observe honestly, so
// this replaced a direct client-side PostgREST insert (client JS has no
// reliable way to read its own public IP). Deployed --no-verify-jwt since
// it must also work for signed-out visitors; the caller's own session (if
// any) is read from the Authorization header when present, same pattern
// as correct-sentence/generate-sentence use for optional auth.
//
// Writes with the service-role key, bypassing RLS entirely -- this is now
// the only intended writer for usage_pings; see privacy/page.tsx for the
// user-facing disclosure of exactly what this records.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  deviceId: string;
  level: string;
  userAgent?: string;
  pingDate: string; // YYYY-MM-DD, caller's local date
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const { deviceId, level, userAgent, pingDate } = body;
    if (!deviceId || !pingDate) {
      return json({ error: 'Missing deviceId or pingDate' }, 400);
    }

    // Supabase Edge Functions run behind a proxy that sets this to the
    // real client IP as the first entry (a comma-separated chain if the
    // request passed through further proxies upstream of that).
    const forwardedFor = req.headers.get('x-forwarded-for');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : null;

    // Optional: resolve a signed-in user id from the caller's own
    // Authorization header, same as any other authenticated call — but
    // this function works fine without one (signed-out visitors).
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const { createClient } = await import('jsr:@supabase/supabase-js@2');
      const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      userId = data.user?.id ?? null;
    }

    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await admin.from('usage_pings').insert({
      device_id: deviceId,
      user_id: userId,
      signed_in: !!userId,
      level: level || null,
      user_agent: userAgent || null,
      ip_address: ip,
      ping_date: pingDate,
    });
    // 23505 = unique_violation (device already pinged today) -- expected
    // on a race between tabs, not an error worth reporting.
    if (error && error.code !== '23505') {
      console.error('usage_pings insert failed:', error.message);
      return json({ error: 'Insert failed' }, 500);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('record-usage-ping error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
