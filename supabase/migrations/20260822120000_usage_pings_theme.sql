-- Adds theme to usage_pings, captured the same snapshot-once-per-day way
-- `level` already is (see recordUsagePing) -- not live-updated if the
-- learner changes theme again later the same day, just whatever was
-- active at that day's first ping. Backs the admin dashboard's "what
-- theme are people actually using" breakdown; NULL for any row recorded
-- before this shipped (an older row simply doesn't count toward that
-- chart, same as `level` reads NULL for a ping recorded before onboarding
-- finished).
alter table public.usage_pings add column if not exists theme text;
