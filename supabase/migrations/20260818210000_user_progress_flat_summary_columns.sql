-- lib/sync.ts's pushToRemote has tried to write these flat summary
-- columns (level, streak_count, learning_count, mastered_count,
-- language) on every upsert since they were introduced, on the
-- assumption a migration like this one would follow — it never did, so
-- every push has silently failed and fallen back to a retry that (as of
-- 612bd19d, "Fix A1 word ordering, sync's unknown-level bug...") ALSO
-- includes `level` in its own payload, meaning BOTH attempts have been
-- failing outright since that commit landed today — no signed-in user's
-- progress has actually reached Supabase since then. Confirmed live via
-- a direct schema probe (none of these columns exist on the table today)
-- after admin-stats started surfacing "column user_progress.level does
-- not exist" in its debugErrors. Backfills nothing for existing rows —
-- the next successful sync push from each account fills these in
-- naturally, same as goal_days did when it was added.
alter table public.user_progress
  add column if not exists level text,
  add column if not exists streak_count integer,
  add column if not exists learning_count integer,
  add column if not exists mastered_count integer,
  add column if not exists language text;
