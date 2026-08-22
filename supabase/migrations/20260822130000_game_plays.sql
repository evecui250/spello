-- Tracks each Word Match game session so the admin dashboard can answer
-- "how many people are actually playing this, and from where" -- the game
-- currently only has one real entry point (Settings' preview link, see
-- app/game/page.tsx's own top comment), but `source` already distinguishes
-- that from the eventual post-congrats daily-flow entry point so the split
-- is real the moment that's wired in, rather than needing another
-- migration then. One row per completed game (timer hit zero), not per
-- round within it -- device_id/user_id/insert-only RLS follow the exact
-- same pattern as usage_pings/bug_reports (no IP capture needed here, so
-- no server-side Edge Function detour is needed either -- a direct client
-- insert is enough).
create table if not exists public.game_plays (
  id bigint generated always as identity primary key,
  device_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('settings_preview', 'daily_flow')),
  pairs_matched integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.game_plays enable row level security;

create policy "Anyone can record a game play"
  on public.game_plays for insert
  to anon, authenticated
  with check (true);
