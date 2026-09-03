-- daily_activity's primary key leads with user_id, which doesn't help an
-- across-all-users date-range scan -- admin-stats already runs exactly
-- that query shape (see its windowStartDate-filtered reads), but only the
-- app owner ever triggers it, so this was never worth indexing before.
-- get-leaderboard makes the same query shape public, so add the index now.
create index if not exists daily_activity_activity_date_idx
  on public.daily_activity (activity_date);
