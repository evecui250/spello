-- These aggregate across EVERY user — must never be reachable through the
-- public API (PostgREST otherwise exposes any public-schema view/table to
-- anon/authenticated by default, which would leak every user's usage to
-- every other signed-in user). Only reachable via the Supabase Studio
-- SQL/Table Editor's own privileged Postgres connection, never the app.
--
-- Split into its own migration (rather than appended to
-- 20260729180000_ai_usage_summary_view.sql after that one had already been
-- pushed) since the CLI tracks applied migrations by filename, not content —
-- editing an already-applied file's contents wouldn't re-run it.
revoke all on public.ai_usage_daily_by_user from anon, authenticated;
revoke all on public.ai_usage_total_by_user from anon, authenticated;
