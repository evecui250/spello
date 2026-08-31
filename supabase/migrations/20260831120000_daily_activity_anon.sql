-- Anonymous-visitor counterpart to daily_activity (see that migration's own
-- comment) -- an anonymous learner has no account, so there's no user_id
-- to key daily_activity's own rows off. usage_pings already identifies
-- anonymous visitors by device_id, but only fires once per calendar day
-- (at app-open, before any real study that day), so it can't carry a
-- same-day word count. This table is written instead, on the same
-- "after every real progress mutation" trigger daily_activity itself
-- already uses (see lib/sync.ts's scheduleSync), just for anonymous
-- callers and keyed by device_id -- so it stays fresh across a whole
-- session's real activity, not just a snapshot from page-load.
--
-- Written exclusively by the record-anon-activity Edge Function (service
-- role, bypasses RLS) -- same reasoning as usage_pings' own "no direct
-- client insert policy" migration: a device_id is client-supplied and
-- unauthenticated by nature, so nothing about this table should be
-- writable directly by an anon-key client.
create table if not exists public.daily_activity_anon (
  device_id text not null,
  activity_date date not null,
  words_studied int not null default 0,
  words_mastered int not null default 0,
  level text,
  updated_at timestamptz not null default now(),
  primary key (device_id, activity_date)
);

alter table public.daily_activity_anon enable row level security;
-- No policies at all -- only the service role (admin-stats, record-anon-
-- activity) can read or write this table.
