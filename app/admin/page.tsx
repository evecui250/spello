'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { TrendChart, LevelBars, DonutChart } from '../../components/AdminCharts';

interface AiUsageSummary {
  calls: number;
  distinctCallers: number;
  estimatedCostUsd: number;
}

interface StageCounts {
  puppy: number;
  short: number;
  medium: number;
  'long-crowned': number;
}

// Same order/labels as the app's own Word List and Progress pages
// (STAGE_LABEL in app/words/page.tsx and app/progress/page.tsx) — kept
// consistent here rather than inventing separate admin-only wording.
const STAGE_ORDER: (keyof StageCounts)[] = ['puppy', 'short', 'medium', 'long-crowned'];
const STAGE_LABEL: Record<keyof StageCounts, string> = {
  puppy: 'Introduced', short: 'Familiar', medium: 'Strong', 'long-crowned': 'Mastered',
};

interface AdminStats {
  totals: {
    totalAccounts: number;
    accountsStartedLearning: number;
    totalDistinctIps: number;
    activeIps7d: number;
  };
  today: {
    newSignups: number;
    newDevicesSignedIn: number;
    newDevicesAnonymous: number;
    newIpsTotal: number;
    newIpsSignedIn: number;
    wordsStudied: number;
    aiUsage: { signedIn: AiUsageSummary; anonymous: AiUsageSummary };
    // How many times the "Why?" grammar-explanation button was tapped
    // today — tracked separately from the correction calls above so we
    // can see whether the button is actually getting used.
    explanationClicks: number;
  };
  trends: {
    signups: { date: string; count: number }[];
    devices: { date: string; signedIn: number; anonymous: number }[];
    aiUsage: { date: string; signedInCalls: number; anonymousCalls: number; costUsd: number }[];
    wordsStudied: { date: string; total: number }[];
    explanationClicks: { date: string; count: number }[];
  };
  levelBreakdown: { level: string; signedIn: number; anonymous: number }[];
  geoBreakdown: {
    byIp: { country: string; count: number }[];
    byUser: { country: string; count: number }[];
  };
  leaderboardToday: { email: string; wordsStudied: number; wordsMastered: number; level: string | null }[];
  wordStages: {
    totals: StageCounts;
    byLearner: { email: string; level: string | null; stages: StageCounts }[];
  };
  bugReportCount: number;
  recentBugReports: { id: number; message: string; page_path: string | null; created_at: string }[];
  debugErrors: string[];
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
      // Defensive fallback for fields the currently-deployed Edge Function
      // might not return yet (a frontend deploy can land before the
      // matching function redeploy finishes) — without this, an older
      // response missing geoBreakdown/debugErrors would crash the whole
      // page on stats.geoBreakdown.byUser.map(...) rather than just
      // rendering those sections empty.
      setStats({
        ...data,
        debugErrors: data.debugErrors ?? [],
        geoBreakdown: data.geoBreakdown ?? { byIp: [], byUser: [] },
        today: { ...data.today, explanationClicks: data.today?.explanationClicks ?? 0 },
        trends: { ...data.trends, explanationClicks: data.trends?.explanationClicks ?? [] },
      });
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

      {/* Temporary/diagnostic — a query failing silently used to just
          read as a wrong-looking "0" with no indication anything broke
          (see admin-stats's debugErrors). Only ever renders anything
          when a query actually failed. */}
      {stats.debugErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex flex-col gap-1">
          <p className="text-red-700 text-xs font-semibold">Some data below may be wrong — a query failed:</p>
          {stats.debugErrors.map((e, i) => (
            <p key={i} className="text-red-600 text-xs font-mono">{e}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total accounts" value={stats.totals.totalAccounts} />
        <StatCard label="Accounts that started learning" value={stats.totals.accountsStartedLearning} />
        <StatCard label="Total distinct IPs (all-time)" value={stats.totals.totalDistinctIps} />
        <StatCard label="Active IPs, past 7 days" value={stats.totals.activeIps7d} />
      </div>

      {/* Today */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
        <h2 className="font-semibold text-stone-800">Today</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="New signups" value={stats.today.newSignups} />
          <StatCard label="Words practiced (signed-in)" value={stats.today.wordsStudied} />
          <StatCard label="New devices — signed in" value={stats.today.newDevicesSignedIn} />
          <StatCard label="New devices — anonymous" value={stats.today.newDevicesAnonymous} />
          <StatCard label="New IPs" value={stats.today.newIpsTotal} />
          <StatCard label="...of which signed in" value={stats.today.newIpsSignedIn} />
          <StatCard label="'Why?' button clicks" value={stats.today.explanationClicks} />
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
          title="Words practiced / day (signed-in accounts only)"
          dates={dates}
          series={[{ label: 'Words practiced', color: SIGNED_IN_COLOR, values: stats.trends.wordsStudied.map(t => t.total) }]}
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

      {/* Countries */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-4">
        <div>
          <h2 className="font-semibold text-stone-800">Countries</h2>
          <p className="text-stone-400 text-xs -mt-0.5">
            Looked up from IP address (ip-api.com) each time this page loads — a rough signal, not exact (VPNs, shared networks, roaming all skew it).
          </p>
        </div>
        <DonutChart title="By user (device)" slices={stats.geoBreakdown.byUser.map(g => ({ label: g.country, count: g.count }))} />
        <DonutChart title="By IP" slices={stats.geoBreakdown.byIp.map(g => ({ label: g.country, count: g.count }))} />
      </div>

      {/* Word stages */}
      <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5 flex flex-col gap-3">
        <h2 className="font-semibold text-stone-800">Word stages</h2>
        <p className="text-stone-400 text-xs -mt-1">Signed-in learners only — an anonymous learner's word-by-word progress never reaches the server at all, so there's nothing to show here for them.</p>
        <div className="grid grid-cols-2 gap-3">
          {STAGE_ORDER.map(s => (
            <StatCard key={s} label={STAGE_LABEL[s]} value={stats.wordStages.totals[s]} />
          ))}
        </div>
        {stats.wordStages.byLearner.length === 0 ? (
          <p className="text-stone-500 text-sm">No signed-in learners yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm border-collapse min-w-[420px]">
              <thead>
                <tr className="text-stone-400 text-xs text-left">
                  <th className="font-medium pb-1.5 pr-2">Learner</th>
                  <th className="font-medium pb-1.5 px-2">Level</th>
                  {STAGE_ORDER.map(s => <th key={s} className="font-medium pb-1.5 px-2 text-right">{STAGE_LABEL[s]}</th>)}
                </tr>
              </thead>
              <tbody>
                {stats.wordStages.byLearner.map((row, i) => (
                  <tr key={row.email + i} className="border-t border-amber-100/60">
                    <td className="py-1.5 pr-2 text-stone-700 truncate max-w-[140px]">{row.email}</td>
                    <td className="py-1.5 px-2 text-stone-500">{row.level ?? '—'}</td>
                    {STAGE_ORDER.map(s => <td key={s} className="py-1.5 px-2 text-stone-600 text-right">{row.stages[s]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  {row.wordsStudied} practiced · {row.wordsMastered} mastered · {row.level ?? '—'}
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
