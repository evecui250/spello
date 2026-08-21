-- Mirrors goal_days (see 20260729190000_add_goal_days_column.sql) for the
-- Progress page's activity calendar: a jsonb array of ISO date strings on
-- which only ONE of study/review got done that day, not both — a fainter
-- mark on the calendar, distinct from a full goal_days day. Same
-- level-independent, union-on-merge treatment as goal_days (see
-- lib/sync.ts's mergePartialDaysFromSync).
alter table public.user_progress
  add column if not exists partial_days jsonb not null default '[]'::jsonb;
