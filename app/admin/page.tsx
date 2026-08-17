'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface AiUsageSummary {
  calls: number;
  distinctCallers: number;
  estimatedCostUsd: number;
}

interface AdminStats {
  totalUsers: number;
  syncedProgressCount: number;
  usage: {
    todayDevices: number;
    last7DaysDevices: number;
    last90DaysDevices: number;
    signedInDevices90d: number;
  };
  last24h: {
    newSignedUpUsers: number;
    newDevices: number;
    aiUsage: { signedIn: AiUsageSummary; anonymous: AiUsageSummary };
  };
  bugReportCount: number;
  recentBugReports: { id: number; message: string; page_path: string | null; created_at: string }[];
}

type Status = 'loading' | 'signed-out' | 'unauthorized' | 'ready' | 'error';

// A lightweight, owner-only stats page — pulls from the admin-stats Edge
// Function (service role, its own email-allowlist check) rather than
// requiring a trip to the Supabase dashboard for a quick glance at usage.
// Not linked from NavBar (irrelevant/confusing for every other visitor);
// reachable by URL, and Settings shows a discreet link to it only when
// the signed-in email matches (see AccountPanel usage in settings/page.tsx).
export default function AdminPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [stats, setStats] = useState<AdminStats | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setStatus('signed-out'); return; }
      const { data, error } = await supabase.functions.invoke<AdminStats>('admin-stats', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error || !data) { setStatus('unauthorized'); return; }
      setStats(data);
      setStatus('ready');
    })();
  }, []);

  if (status === 'loading') return null;

  if (status === 'signed-out') {
    return (
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 text-center">
        <p className="text-stone-600">Sign in from Settings first, then come back here.</p>
      </div>
    );
  }

  if (status === 'unauthorized' || status === 'error') {
    return (
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-6 text-center">
        <p className="text-stone-600">Not authorized to view this page.</p>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Admin</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Signed-up accounts" value={stats.totalUsers} />
        <StatCard label="Accounts with synced progress" value={stats.syncedProgressCount} />
        <StatCard label="Devices today" value={stats.usage.todayDevices} />
        <StatCard label="Devices, past 7 days" value={stats.usage.last7DaysDevices} />
        <StatCard label="Devices, past 90 days" value={stats.usage.last90DaysDevices} />
        <StatCard label="...of which signed in" value={stats.usage.signedInDevices90d} />
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
        <h2 className="font-semibold text-stone-800">Last 24 hours</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="New signed-up accounts" value={stats.last24h.newSignedUpUsers} />
          <StatCard label="New devices (incl. never signed in)" value={stats.last24h.newDevices} />
        </div>
        <div className="flex flex-col gap-2">
          <AiUsageRow label="AI calls — signed in" summary={stats.last24h.aiUsage.signedIn} />
          <AiUsageRow label="AI calls — anonymous" summary={stats.last24h.aiUsage.anonymous} />
        </div>
      </div>

      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
        <h2 className="font-semibold text-stone-800">Bug reports ({stats.bugReportCount} total)</h2>
        {stats.recentBugReports.length === 0 ? (
          <p className="text-stone-500 text-sm">None yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {stats.recentBugReports.map(r => (
              <div key={r.id} className="bg-white/60 rounded-lg px-3 py-2">
                <p className="text-stone-700 text-sm">{r.message}</p>
                <p className="text-stone-400 text-xs mt-0.5">
                  {r.page_path ?? '(unknown page)'} · {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-4 flex flex-col gap-0.5">
      <span className="text-2xl font-bold text-stone-800">{value}</span>
      <span className="text-stone-500 text-xs">{label}</span>
    </div>
  );
}

// Anonymous calls are rate-limited/counted by ip_address rather than
// user_id (see correct-sentence/generate-sentence) — this is the only
// place in the app that surfaces them broken out from signed-in usage,
// since the ai_usage_daily_by_user SQL view lumps every anonymous caller
// into a single user_id-is-null row.
function AiUsageRow({ label, summary }: { label: string; summary: AiUsageSummary }) {
  return (
    <div className="bg-white/60 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
      <span className="text-stone-700 text-sm">{label}</span>
      <span className="text-stone-500 text-xs text-right">
        {summary.calls} call{summary.calls === 1 ? '' : 's'} · {summary.distinctCallers} caller{summary.distinctCallers === 1 ? '' : 's'} · ~${summary.estimatedCostUsd.toFixed(4)}
      </span>
    </div>
  );
}
