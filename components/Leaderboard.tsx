'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { SYNCED_EVENT } from '../lib/sync';
import { avatarImageFor } from '../lib/shop';
import { PointsIcon } from './icons';

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  avatarId: string;
  equippedAccessoryId: string | null;
  points: number;
}

interface DateRange {
  start: string;
  end: string;
}

interface LeaderboardResponse {
  week: LeaderboardEntry[];
  month: LeaderboardEntry[];
  weekRange: DateRange;
  monthRange: DateRange;
}

const MEDAL_COLOR = ['#E8C76A', '#B8B8B8', '#C9863F'];

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmtRange(range: DateRange): string {
  return `${fmtDay(range.start)} – ${fmtDay(range.end)}`;
}

// Public/read-only for everyone, signed in or not — no props, no auth
// awareness needed. Fetches on mount and again whenever a sync completes
// (the viewer's own just-synced activity can change their rank).
export default function Leaderboard() {
  const [tab, setTab] = useState<'week' | 'month'>('week');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [enlarged, setEnlarged] = useState<LeaderboardEntry | null>(null);

  useEffect(() => {
    const load = () => {
      supabase.functions.invoke<LeaderboardResponse>('get-leaderboard')
        .then(({ data: result }) => { if (result) setData(result); })
        .catch(() => {});
    };
    load();
    window.addEventListener(SYNCED_EVENT, load);
    return () => window.removeEventListener(SYNCED_EVENT, load);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setMyUserId(session?.user.id ?? null);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setMyUserId(session?.user.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const entries = data?.[tab] ?? [];
  const range = data ? (tab === 'week' ? data.weekRange : data.monthRange) : null;
  if (data && data.week.length === 0 && data.month.length === 0) return null;

  return (
    <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <h2 className="font-bold text-ink">Top Learners</h2>
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            aria-label="What is this?"
            className="w-4 h-4 rounded-full border border-ink-soft text-ink-soft text-[10px] font-bold flex items-center justify-center hover:border-ink hover:text-ink transition-colors"
          >
            ?
          </button>
        </div>
        <div className="flex gap-1 bg-paper-dim rounded-full p-1">
          {(['week', 'month'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
                tab === t ? 'bg-accent-deep text-white' : 'text-ink-soft'
              }`}
            >
              {t === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
      </div>
      {showHelp && (
        <p className="text-ink-soft text-xs bg-paper-dim rounded-lg px-3 py-2 mb-3">
          Change your own nickname and profile picture in Settings → Account.
        </p>
      )}
      {range && <p className="text-ink-soft text-xs mb-3">{fmtRange(range)}</p>}
      {entries.length === 0 ? (
        <p className="text-ink-soft text-sm">No one has studied {tab === 'week' ? 'this week' : 'this month'} yet — be the first!</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e, i) => {
            const isMe = e.userId === myUserId;
            return (
              <div
                key={i}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 ${isMe ? 'bg-accent/15 border border-accent' : 'bg-paper-dim'}`}
              >
                <span className="font-mono font-bold text-sm w-4 text-center" style={{ color: MEDAL_COLOR[i] }}>
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setEnlarged(e)}
                  className="w-8 h-8 rounded-full overflow-hidden border border-paper-line shrink-0"
                  aria-label={`View ${e.displayName}'s picture`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${avatarImageFor(e.avatarId, e.equippedAccessoryId)}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </button>
                <span className="flex-1 text-sm font-semibold text-ink truncate">
                  {e.displayName}
                  {isMe && <span className="ml-1.5 text-xs font-bold text-accent-deep">(you)</span>}
                </span>
                <span className="flex items-center gap-1 font-mono text-sm font-semibold text-label">
                  <PointsIcon className="w-3.5 h-3.5" /> {e.points.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {authChecked && !myUserId && (
        <p className="text-ink-soft text-xs mt-3 pt-3 border-t border-paper-line/60">
          Sign in (Settings → Account) to appear on this leaderboard yourself.
        </p>
      )}

      {enlarged && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEnlarged(null)}
        >
          <div
            className="bg-paper rounded-2xl shadow-xl p-6 flex flex-col items-center gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-paper-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${avatarImageFor(enlarged.avatarId, enlarged.equippedAccessoryId)}`}
                alt=""
                className="w-full h-full object-cover"
              />
            </div>
            <span className="font-bold text-ink text-lg">{enlarged.displayName}</span>
            <button
              type="button"
              onClick={() => setEnlarged(null)}
              className="text-ink-soft hover:text-ink text-sm font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
