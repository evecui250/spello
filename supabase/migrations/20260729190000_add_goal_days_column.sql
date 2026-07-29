-- Lifetime "goal days" (see lib/storage.ts) was never synced at all before
-- this — purely a local counter, which is exactly why two devices signed
-- into the same account could show different totals. Stored as the actual
-- set of dates (jsonb array of ISO date strings), not just a count, so
-- merging two devices' histories on pull is an exact union rather than an
-- approximation (see lib/sync.ts). Level-independent, so it's its own
-- top-level column rather than nested inside progress/streak/settings.
alter table public.user_progress
  add column if not exists goal_days jsonb not null default '[]'::jsonb;
