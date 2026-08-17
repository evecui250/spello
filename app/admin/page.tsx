'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { TrendChart, LevelBars } from '../../components/AdminCharts';

interface AiUsageSummary {
  calls: number;
  distinctCallers: number;
  estimatedCostUsd: number;
}

interface AdminStats {
  totals: {
    totalAccounts: number;
    accountsStartedLearning: number;
  };
  today: {
    newSignups: number;
    newDevicesSignedIn: number;
    newDevicesAnonymous: number;
    newIpsTotal: number;
    newIpsSignedIn: number;
    wordsStudied: number;
    aiUsage: { signedIn: AiUsageSummary; anonymous: AiUsageSummary };
  };
  trends: {
    signups: { date: string; count: number }[];
    devices: { date: string; signedIn: number; anonymous: number }[];
    aiUsage: { date: string; signedInCalls: number; anonymousCalls: number; costUsd: number }[];
    wordsStudied: { date: string; total: number }[];
  };
  levelBreakdown: { level: string; signedIn: number; anonymous: number }[];
  leaderboardToday: { email: string; wordsStudied: number; wordsMastered: number; level: string | null }[];
  bugReportCount: number;
  recentBugReports: { id: number; message: string; page_path: string | null; created_at: string }[];
}

type Status = 'loading' | 'signed-out' | 'unauthorized' | 'ready' | 'error';

// Shared signed-in (accent indigo) / anonymous (muted stone) colors, used
// consistently across every chart below so the same color always means
// the same thing on this page.
const SIGNED_IN_COLOR = '#4f46e5';
const ANONYMOUS_COLOR = '#a8a29e';

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

  const dates = stats.trends.signups.map(t => t.date);
  const aiWindowCostUsd = Math.round(stats.trends.aiUsage.reduce((s, t) => s + t.costUsd, 0) * 10000) / 10000;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Admin</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total accounts" value={stats.totals.totalAccounts} />
        <StatCard label="Accounts that started learning" value={stats.totals.accountsStartedLearning} />
      </div>

      {/* Today */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
        <h2 className="font-semibold text-stone-800">Today</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="New signups" value={stats.today.newSignups} />
          <StatCard label="Words studied (signed-in)" value={stats.today.wordsStudied} />
          <StatCard label="New devices — signed in" value={stats.today.newDevicesSignedIn} />
          <StatCard label="New devices — anonymous" value={stats.today.newDevicesAnonymous} />
          <StatCard label="New IPs" value={stats.today.newIpsTotal} />
          <StatCard label="...of which signed in" value={stats.today.newIpsSignedIn} />
        </div>
        <div className="flex flex-col gap-2">
          <AiUsageRow label="AI calls — signed in" summary={stats.today.aiUsage.signedIn} />
          <AiUsageRow label="AI calls — anonymous" summary={stats.today.aiUsage.anonymous} />
        </div>
      </div>

      {/* Trends */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-5">
        <h2 className="font-semibold text-stone-800">Last 30 days</h2>
        <TrendChart
          title="New signups / day"
          dates={dates}
          series={[{ label: 'Signups', color: SIGNED_IN_COLOR, values: stats.trends.signups.map(t => t.count) }]}
        />
        <TrendChart
          title="Devices seen / day"
          dates={dates}
          series={[
            { label: 'Signed in', color: SIGNED_IN_COLOR, values: stats.trends.devices.map(t => t.signedIn) },
            { label: 'Anonymous', color: ANONYMOUS_COLOR, values: stats.trends.devices.map(t => t.anonymous) },
          ]}
        />
        <TrendChart
          title={`AI calls / day (~$${aiWindowCostUsd.toFixed(4)} over 30 days)`}
          dates={dates}
          series={[
            { label: 'Signed in', color: SIGNED_IN_COLOR, values: stats.trends.aiUsage.map(t => t.signedInCalls) },
            { label: 'Anonymous', color: ANONYMOUS_COLOR, values: stats.trends.aiUsage.map(t => t.anonymousCalls) },
          ]}
        />
        <TrendChart
          title="Words studied / day (signed-in accounts only)"
          dates={dates}
          series={[{ label: 'Words studied', color: SIGNED_IN_COLOR, values: stats.trends.wordsStudied.map(t => t.total) }]}
          emptyNote="Tracking just started — this fills in day by day from here, it can't show history from before this was added."
        />
      </div>

      {/* Levels */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-stone-800">Levels</h2>
          <div className="flex gap-2.5 text-[11px] text-stone-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: SIGNED_IN_COLOR }} />Signed in</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: ANONYMOUS_COLOR }} />Anonymous</span>
          </div>
        </div>
        {stats.levelBreakdown.length === 0 ? (
          <p className="text-stone-500 text-sm">No data yet.</p>
        ) : (
          <LevelBars
            rows={stats.levelBreakdown.map(l => ({
              label: l.level,
              segments: [
                { value: l.signedIn, color: SIGNED_IN_COLOR },
                { value: l.anonymous, color: ANONYMOUS_COLOR },
              ],
            }))}
          />
        )}
      </div>

      {/* Leaderboard */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
        <h2 className="font-semibold text-stone-800">Most active today</h2>
        <p className="text-stone-400 text-xs -mt-1">Signed-in learners only — anonymous activity can't be tied to a person.</p>
        {stats.leaderboardToday.length === 0 ? (
          <p className="text-stone-500 text-sm">Nobody's studied yet today.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {stats.leaderboardToday.map((row, i) => (
              <div key={row.email + i} className="bg-white/60 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-stone-700 text-sm truncate">
                  <span className="text-stone-400 mr-1.5">{i + 1}.</span>
                  {row.email}
                </span>
                <span className="text-stone-500 text-xs text-right shrink-0">
                  {row.wordsStudied} studied · {row.wordsMastered} mastered · {row.level ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bug reports */}
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
