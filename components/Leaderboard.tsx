'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { SYNCED_EVENT } from '../lib/sync';
import { avatarImageFor } from '../lib/shop';
import { PointsIcon } from './icons';

interface LeaderboardEntry {
  userId: string;
  rank: number;
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
// Shared between the compact card's own rows and the full-rankings
// modal's rows, so the two never visually drift apart.
function LeaderboardRow({ entry, isMe, onAvatarClick }: { entry: LeaderboardEntry; isMe: boolean; onAvatarClick: () => void }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2 ${isMe ? 'bg-accent/15 border border-accent' : 'bg-paper-dim'}`}>
      <span
        className="font-mono font-bold text-sm w-6 text-center shrink-0"
        style={entry.rank <= 3 ? { color: MEDAL_COLOR[entry.rank - 1] } : undefined}
      >
        {entry.rank}
      </span>
      <button
        type="button"
        onClick={onAvatarClick}
        className="w-8 h-8 rounded-full overflow-hidden border border-paper-line shrink-0"
        aria-label={`View ${entry.displayName}'s picture`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${avatarImageFor(entry.avatarId, entry.equippedAccessoryId)}`}
          alt=""
          className="w-full h-full object-cover"
        />
      </button>
      <span className="flex-1 text-sm font-semibold text-ink truncate">
        {entry.displayName}
        {isMe && <span className="ml-1.5 text-xs font-bold text-accent-deep">(you)</span>}
      </span>
      <span className="flex items-center gap-1 font-mono text-sm font-semibold text-label">
        <PointsIcon className="w-3.5 h-3.5" /> {entry.points.toLocaleString()}
      </span>
    </div>
  );
}

// The "…" affordance below the top 3 — doubles as a rank ellipsis (when
// the viewer's own row follows) and a plain "see everyone" button
// (when it doesn't, or the viewer isn't signed in) — either way it opens
// the same full-rankings view.
function MoreRow({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center justify-center py-1">
      {/* A bare "···" read as plain decoration, not a tappable control —
          the circle (same rounded-full + bg-paper-dim pill treatment used
          elsewhere for a tappable badge, e.g. ProgressBadge's "New" pill)
          is what actually signals "this is a button." */}
      <button
        type="button"
        onClick={onClick}
        aria-label="See full rankings"
        className="w-8 h-8 rounded-full border border-ink-soft/40 bg-paper-dim text-ink-soft hover:text-ink hover:border-ink-soft transition-colors flex items-center justify-center active:scale-95"
      >
        <span className="font-mono font-bold tracking-widest text-xs">···</span>
      </button>
    </div>
  );
}

export default function Leaderboard() {
  const [tab, setTab] = useState<'week' | 'month'>('week');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [enlarged, setEnlarged] = useState<LeaderboardEntry | null>(null);
  const [showFullRankings, setShowFullRankings] = useState(false);

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

  const top3 = entries.slice(0, 3);
  const myEntry = myUserId ? entries.find(e => e.userId === myUserId) ?? null : null;
  // Only shown as its own row below the "…" when it's NOT already
  // visible in top3 — a top-3 learner's own row is redundant there (see
  // the owner's own framing: "if the user is in top 3, there will only
  // be the '…' button").
  const myRowBelow = myEntry && myEntry.rank > 3 ? myEntry : null;

  return (
    <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowFullRankings(true)}
            disabled={entries.length === 0}
            className="font-bold text-ink hover:text-label transition-colors disabled:hover:text-ink disabled:cursor-default"
          >
            Top Learners
          </button>
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
          Change your own nickname and profile picture in Settings → Account. Tap the title or the ··· below to see every ranked learner.
        </p>
      )}
      {range && <p className="text-ink-soft text-xs mb-3">{fmtRange(range)}</p>}
      {entries.length === 0 ? (
        <p className="text-ink-soft text-sm">No one has studied {tab === 'week' ? 'this week' : 'this month'} yet — be the first!</p>
      ) : (
        <div className="flex flex-col gap-1">
          {top3.map(e => (
            <LeaderboardRow key={e.userId} entry={e} isMe={e.userId === myUserId} onAvatarClick={() => setEnlarged(e)} />
          ))}
          {entries.length > 3 && <MoreRow onClick={() => setShowFullRankings(true)} />}
          {myRowBelow && (
            <LeaderboardRow entry={myRowBelow} isMe onAvatarClick={() => setEnlarged(myRowBelow)} />
          )}
        </div>
      )}
      {authChecked && !myUserId && (
        <p className="text-ink-soft text-xs mt-3 pt-3 border-t border-paper-line/60">
          Sign in (Settings → Account) to appear on this leaderboard yourself.
        </p>
      )}

      {showFullRankings && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowFullRankings(false)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-paper rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-ink">Full Rankings</h2>
              <button
                type="button"
                onClick={() => setShowFullRankings(false)}
                aria-label="Close"
                className="text-ink-soft hover:text-ink text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex gap-1 bg-paper-dim rounded-full p-1 self-start">
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
            {range && <p className="text-ink-soft text-xs -mt-1">{fmtRange(range)}</p>}
            <div className="flex flex-col gap-1.5">
              {entries.map(e => (
                <LeaderboardRow key={e.userId} entry={e} isMe={e.userId === myUserId} onAvatarClick={() => setEnlarged(e)} />
              ))}
            </div>
          </div>
        </div>,
        document.body,
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
