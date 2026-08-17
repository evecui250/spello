-- Per-user, per-day activity log — powers /admin's words-learned trend and
-- daily leaderboard, neither of which is derivable from user_progress
-- alone: that table is a snapshot overwritten on every sync (see
-- lib/sync.ts's pushToRemote), so it only ever tells you someone's
-- CURRENT total, never a history of past days. This table is written
-- alongside that same existing sync push (one small best-effort extra
-- upsert, not a new tracking system) so it starts accumulating real
-- day-by-day data from whenever this ships — it cannot backfill history
-- that was never recorded before it existed.
--
-- Signed-in + synced users only, same as user_progress — an anonymous
-- learner's progress never reaches the server at all, so there's nothing
-- to log here for them (see usage_pings for the anonymous-visitor side of
-- the picture instead).
create table if not exists public.daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  words_studied int not null default 0,
  words_mastered int not null default 0,
  level text,
  updated_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

alter table public.daily_activity enable row level security;

-- Same ownership model as user_progress: a user can only ever read/write
-- their own row. admin-stats reads everyone's via the service role,
-- which bypasses RLS entirely.
create policy "Users can insert their own daily_activity"
  on public.daily_activity for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own daily_activity"
  on public.daily_activity for update
  using (auth.uid() = user_id);

create policy "Users can view their own daily_activity"
  on public.daily_activity for select
  using (auth.uid() = user_id);
