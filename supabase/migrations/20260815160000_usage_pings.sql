-- Lets Spello count real usage -- including visitors who never sign in,
-- which is most of them now that sign-in is entirely optional (see
-- AuthGate's removal). auth.users/user_progress only ever see someone who
-- explicitly created an account and synced at least once; this table is
-- the only place a purely local, never-signed-in learner shows up at all.
--
-- device_id is a random UUID minted client-side into localStorage (see
-- lib/telemetry.ts) -- NOT a person, just "this browser profile on this
-- device". It's the closest thing to a user count available without
-- requiring sign-in: count distinct device_id for DAU/total reach, or
-- filter signed_in = true to see the signed-in subset specifically. A
-- learner who uses two devices, or clears storage, shows up as two
-- device_ids -- a known, accepted undercount/overcount tradeoff rather
-- than a bug.
--
-- One row per calendar day per device (throttled client-side), not one
-- per page view -- this is meant to answer "how many people used the app
-- today/this week/total", not to be a full analytics/event log.
--
-- Insert-only from the client, exactly like bug_reports -- never read
-- back by the pinging device itself, only via the dashboard/SQL editor
-- (service role bypasses RLS).
create table if not exists public.usage_pings (
  id bigint generated always as identity primary key,
  device_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  signed_in boolean not null default false,
  level text,
  ping_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (device_id, ping_date)
);

alter table public.usage_pings enable row level security;

-- ON CONFLICT (device_id, ping_date) DO NOTHING (see lib/telemetry.ts) only
-- ever needs INSERT privilege -- DO NOTHING never touches an existing row,
-- so no UPDATE policy is needed here.
create policy "Anyone can record a usage ping"
  on public.usage_pings for insert
  to anon, authenticated
  with check (true);
