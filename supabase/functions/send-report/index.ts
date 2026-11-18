// Emails Spello's admins a cost/activity summary, via Resend.
//   period 'weekly':  AI cost of the last 7 days (by feature), vs the 7 before.
//   period 'monthly': AI cost of last calendar month, vs the month before,
//                     plus a summary of learner activity that month.
// Triggered on a schedule by .github/workflows/reports.yml, which sends
// the shared REPORT_SECRET header — not callable by app users. `dryRun`
// returns the email instead of sending it (for checking the numbers).

import { costUsd } from '../_shared/pricing.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const REPORT_SECRET = Deno.env.get('REPORT_SECRET');
const REPORT_EMAILS = (Deno.env.get('REPORT_EMAILS') || 'evecui250@gmail.com,yutong.chen@inf.ethz.ch')
  .split(',').map(e => e.trim()).filter(Boolean);
// Resend's sandbox sender delivers only to the Resend account's own
// address; REPORT_FROM switches to a verified domain's sender.
const FROM_ADDRESS = Deno.env.get('REPORT_FROM') || 'Spello <onboarding@resend.dev>';

// What each ai_usage kind is, in plain words.
const KIND_LABEL: Record<string, string> = {
  correction: 'Sentence corrections',
  explanation: '"Why?" explanations',
  gloss: 'Tap-a-word translations',
  lookup: 'Dictionary look-ups',
  word_audio: 'Word audio (voice)',
  words_in_context: 'Words in Context texts',
  pdf_import: 'PDF book imports',
  speech_to_text: 'Voice entry (speech to text)',
  pet_chat: 'Pet chat',
};

type Row = Record<string, unknown>;

// deno-lint-ignore no-explicit-any
async function fetchAll(query: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>): Promise<Row[]> {
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 1000) return all;
  }
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function change(now: number, before: number): string {
  if (before === 0) return now === 0 ? '' : ' (new)';
  const pct = Math.round(((now - before) / before) * 100);
  return ` (${pct >= 0 ? '+' : ''}${pct}% vs before)`;
}

function table(head: string[], rows: (string | number)[][]): string {
  const th = head.map((h, i) => `<th style="text-align:${i ? 'right' : 'left'};padding:4px 10px;border-bottom:1px solid #ddd">${esc(h)}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map((c, i) => `<td style="text-align:${i ? 'right' : 'left'};padding:4px 10px">${esc(String(c))}</td>`).join('')}</tr>`).join('');
  return `<table style="border-collapse:collapse;font-size:14px">${th ? `<tr>${th}</tr>` : ''}${trs}</table>`;
}

Deno.serve(async (req: Request) => {
  if (!REPORT_SECRET || req.headers.get('x-report-secret') !== REPORT_SECRET) {
    return new Response('Not authorized', { status: 401 });
  }
  try {
    const { createClient } = await import('jsr:@supabase/supabase-js@2');
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const period: 'weekly' | 'monthly' = body.period === 'monthly' ? 'monthly' : 'weekly';

    // [start, end) of this report and of the period before it, in UTC.
    const now = new Date();
    let start: Date, end: Date, prevStart: Date, title: string;
    if (period === 'weekly') {
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      start = new Date(end.getTime() - 7 * 86400000);
      prevStart = new Date(start.getTime() - 7 * 86400000);
      title = `Spello weekly AI cost · ${day(start)} – ${day(new Date(end.getTime() - 86400000))}`;
    } else {
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
      prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
      title = `Spello monthly report · ${start.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
    }

    const ai = await fetchAll((f, t) => db.from('ai_usage')
      .select('kind, model, input_tokens, output_tokens, user_id, ip_address, created_at')
      .gte('created_at', prevStart.toISOString()).lt('created_at', end.toISOString())
      .order('id').range(f, t));
    const inPeriod = ai.filter(r => String(r.created_at) >= start.toISOString());
    const before = ai.filter(r => String(r.created_at) < start.toISOString());
    // deno-lint-ignore no-explicit-any
    const cost = (rows: Row[]) => costUsd(rows as any);
    const total = cost(inPeriod), totalBefore = cost(before);

    const kinds = [...new Set(inPeriod.map(r => String(r.kind)))];
    const byKind = kinds
      .map(k => { const rows = inPeriod.filter(r => r.kind === k); return { k, calls: rows.length, cost: cost(rows) }; })
      .sort((a, b) => b.cost - a.cost);
    const callers = new Set(inPeriod.map(r => String(r.user_id ?? r.ip_address))).size;

    let html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#222;max-width:560px">
<h2 style="margin:0 0 4px">${esc(title)}</h2>
<p style="margin:0 0 16px;color:#666">Estimated from logged usage; OpenAI's own billing page is the exact figure.</p>
<h3 style="margin:16px 0 6px">AI cost: ${usd(total)}${change(total, totalBefore)}</h3>
<p style="margin:0 0 8px">${inPeriod.length} AI calls by ${callers} learners/devices.</p>
${table(['Feature', 'Calls', 'Cost'], byKind.map(r => [KIND_LABEL[r.k] ?? r.k, r.calls, usd(r.cost)]))}`;

    if (period === 'monthly') {
      const s = day(start), e = day(end);
      const activity = await fetchAll((f, t) => db.from('daily_activity')
        .select('user_id, activity_date, words_studied').gte('activity_date', s).lt('activity_date', e).range(f, t));
      const pings = await fetchAll((f, t) => db.from('usage_pings')
        .select('device_id, user_id, signed_in, ping_date').gte('ping_date', s).lt('ping_date', e).range(f, t));
      const plays = await fetchAll((f, t) => db.from('game_plays')
        .select('game, created_at').gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).range(f, t));
      const { data: usersPage } = await db.auth.admin.listUsers({ perPage: 1000 });
      const users = usersPage?.users ?? [];
      const newUsers = users.filter(u => u.created_at >= start.toISOString() && u.created_at < end.toISOString());

      // Days studied per signed-in learner this month.
      const daysBy = new Map<string, Set<string>>();
      let wordsStudied = 0;
      for (const r of activity) {
        const id = String(r.user_id);
        if (!daysBy.has(id)) daysBy.set(id, new Set());
        daysBy.get(id)!.add(String(r.activity_date));
        wordsStudied += Number(r.words_studied ?? 0);
      }
      const bucket = (n: number) => [...daysBy.values()].filter(d => d.size >= n).length;
      const signedOutDevices = new Set(pings.filter(p => !p.signed_in).map(p => String(p.device_id))).size;
      // New accounts this month that studied on a second, different day.
      const newCameBack = newUsers.filter(u => (daysBy.get(u.id)?.size ?? 0) >= 2).length;
      const emailOf = new Map(users.map(u => [u.id, u.email ?? '(no email)']));
      const top = [...daysBy.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 5)
        .map(([id, d]) => [emailOf.get(id) ?? id.slice(0, 8), d.size]);
      const gameCount = (g: string) => plays.filter(p => (p.game ?? 'wortpaare') === g).length;

      html += `
<h3 style="margin:24px 0 6px">Learners</h3>
${table([], [
  ['Signed-in learners who studied', daysBy.size],
  ['… on 2+ days', bucket(2)],
  ['… on 7+ days', bucket(7)],
  ['… on 15+ days', bucket(15)],
  ['Signed-out devices that opened Spello', signedOutDevices],
  ['New accounts', newUsers.length],
  ['… of those, came back on a 2nd day', newCameBack],
  ['Total accounts', users.length],
  ['Words studied (signed-in)', wordsStudied],
])}
<h3 style="margin:24px 0 6px">Extras</h3>
${table([], [
  ['Wortpaare rounds', gameCount('wortpaare')],
  ['Artikel Blitz rounds', gameCount('artikel_blitz')],
  ['Words in Context texts', gameCount('words_in_context')],
  ['Bonus sentences built', gameCount('sentence')],
])}
<h3 style="margin:24px 0 6px">Most active</h3>
${table(['Learner', 'Days studied'], top)}`;
    }
    html += `
<p style="margin:24px 0 0;color:#888;font-size:12px">Sent automatically by Spello (supabase/functions/send-report). Full numbers: the Admin page in Profile.</p></div>`;

    if (body.dryRun) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (!RESEND_API_KEY) return new Response('RESEND_API_KEY not set', { status: 500 });

    // One email per admin, so one undeliverable address can't stop the other.
    const results: { to: string; ok: boolean; error?: string }[] = [];
    for (const to of REPORT_EMAILS) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject: title, html }),
      });
      results.push({ to, ok: res.ok, ...(res.ok ? {} : { error: (await res.text()).slice(0, 300) }) });
    }
    return new Response(JSON.stringify({ period, results }), {
      status: results.some(r => r.ok) ? 200 : 502,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-report error:', err);
    return new Response('Unexpected error', { status: 500 });
  }
});
