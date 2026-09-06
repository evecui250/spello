-- Today's in-progress study/review session (see lib/storage.ts's
-- DailySession) -- nested by level, same shape/reasoning as the existing
-- `progress`/`settings`/`custom_words` columns (see lib/sync.ts's
-- DailySessionByLevel). Previously never synced at all: starting a review
-- on one device and continuing on another had no way to know the first
-- device's session existed, so it silently started over (a real,
-- confirmed report) -- this closes that gap.
-- Shape: {"A1": {...DailySession}, "B2": {...}}
alter table public.user_progress
  add column if not exists daily_session jsonb not null default '{}'::jsonb;
