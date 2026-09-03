-- Records an actual points purchase -- unlike profiles (pure preference),
-- this table IS the economic transaction, so it follows
-- daily_activity_anon's service-role-only lockdown instead of a
-- client-writable pattern: RLS enabled, but no insert/update policy for
-- anon/authenticated at all. Only buy-accessory's service-role client
-- may insert, since the balance check that must precede every insert
-- here can't be trusted to a client.
create table if not exists public.owned_accessories (
  user_id uuid not null references auth.users(id) on delete cascade,
  accessory_id text not null,
  cost_paid int not null,
  purchased_at timestamptz not null default now(),
  primary key (user_id, accessory_id)
);

alter table public.owned_accessories enable row level security;

create policy "Users can view their own owned_accessories"
  on public.owned_accessories for select
  using (auth.uid() = user_id);
