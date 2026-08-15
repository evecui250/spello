// Emails the app owner whenever a new row lands in public.bug_reports.
// Triggered by a Postgres AFTER INSERT trigger (see the
// notify_bug_report_webhook migration) using pg_net's async http_post —
// NOT a client-callable endpoint, so it's deployed --no-verify-jwt and
// instead checks its own shared secret header (WEBHOOK_SECRET, set via
// `supabase secrets set` and stored in the DB via Vault, never in a
// migration file) to reject anything that isn't the real trigger.
//
// Uses Resend (https://resend.com) for actual delivery — a free account
// covers this easily; see the setup checklist this was handed off with
// for the one-time signup + API key steps a human still has to do.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');
const NOTIFY_EMAIL = Deno.env.get('NOTIFY_EMAIL') || 'zephyr.he07@gmail.com';
// Resend's shared sandbox sender — works immediately with zero domain
// setup, but (Resend's own restriction, not this code's) can only deliver
// to the email address that owns the Resend account itself. Swap this for
// a verified custom domain's address later if NOTIFY_EMAIL ever needs to
// be someone other than the Resend account owner.
const FROM_ADDRESS = 'Spello <onboarding@resend.dev>';

interface BugReportRow {
  id: number;
  user_id: string | null;
  email: string | null;
  message: string;
  page_path: string | null;
  user_agent: string | null;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured — cannot send notification');
    return new Response('Not configured', { status: 500 });
  }

  try {
    const body = await req.json();
    const record = body.record as BugReportRow;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [NOTIFY_EMAIL],
        subject: `Spello bug report: ${record.message.slice(0, 60)}`,
        text: [
          `${record.message}`,
          '',
          `Page: ${record.page_path ?? '(unknown)'}`,
          `Reporter email: ${record.email ?? '(not given)'}`,
          `User id: ${record.user_id ?? '(signed out)'}`,
          `Reported at: ${record.created_at}`,
          `User agent: ${record.user_agent ?? '(unknown)'}`,
        ].join('\n'),
      }),
    });

    if (!res.ok) {
      console.error('Resend send failed:', await res.text());
      return new Response('Send failed', { status: 502 });
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('notify-bug-report error:', err);
    return new Response('Unexpected error', { status: 500 });
  }
});
