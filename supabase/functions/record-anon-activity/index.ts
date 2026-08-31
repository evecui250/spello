// Anonymous counterpart to lib/sync.ts's own daily_activity upsert (see
// that comment, and the daily_activity_anon migration) -- keeps a
// per-device, per-day row of words studied/mastered fresh across a whole
// anonymous session's real activity, not just a page-load snapshot the
// way usage_pings' own once-a-day ping is. Deployed --no-verify-jwt: this
// is specifically for signed-OUT callers (scheduleSync only calls this
// when there's no session at all — see lib/sync.ts), so there is no
// Authorization header to verify in the first place.
//
// Upserts (not insert-once) with the service-role key, bypassing RLS —
// daily_activity_anon has no client policies at all, matching usage_pings'
// own "only the Edge Function may write this" lockdown.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  deviceId: string;
  activityDate: string; // YYYY-MM-DD, caller's local date
  wordsStudied: number;
  wordsMastered: number;
  level?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const { deviceId, activityDate, wordsStudied, wordsMastered, level } = body;
    if (!deviceId || !activityDate) {
      return json({ error: 'Missing deviceId or activityDate' }, 400);
    }

    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await admin.from('daily_activity_anon').upsert({
      device_id: deviceId,
      activity_date: activityDate,
      words_studied: wordsStudied || 0,
      words_mastered: wordsMastered || 0,
      level: level || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'device_id,activity_date' });
    if (error) {
      console.error('daily_activity_anon upsert failed:', error.message);
      return json({ error: 'Upsert failed' }, 500);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('record-anon-activity error:', err);
    return json({ error: 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
