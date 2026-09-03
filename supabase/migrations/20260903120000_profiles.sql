-- Per-user public identity + preferences for the points/leaderboard/shop
-- feature: nickname, chosen mascot avatar, currently-equipped accessory,
-- and leaderboard opt-out. Lazily created on first write, same convention
-- as daily_activity -- no row exists until there's something to say.
--
-- All four fields are pure preference with zero economic stakes (unlike
-- owned_accessories, which records the actual point-spending
-- transaction), so this is safe as direct client writes under RLS --
-- same upsert-capable-own-row shape as daily_activity.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) <= 24),
  avatar_id text not null default 'dachshund',
  equipped_accessory_id text,
  leaderboard_opt_out boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = user_id);
