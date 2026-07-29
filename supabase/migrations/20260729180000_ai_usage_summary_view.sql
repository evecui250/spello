-- Developer-facing rollup of ai_usage, viewable straight from the Supabase
-- Table Editor / SQL Editor (Studio queries with elevated privilege, so this
-- isn't blocked by ai_usage's own per-user RLS policies) — no need to write
-- a fresh SQL query every time to check how much a user has used or roughly
-- what it costs.
--
-- Price-per-token constants below are gpt-4o-mini's rate at the time this
-- was written ($0.15/1M input tokens, $0.60/1M output tokens) — check
-- OpenAI's current pricing page and update this view if it changes.
create or replace view public.ai_usage_daily_by_user as
select
  user_id,
  date_trunc('day', created_at) as day,
  count(*) as calls,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  round(
    (sum(input_tokens) * 0.15 + sum(output_tokens) * 0.60) / 1000000.0,
    4
  ) as estimated_cost_usd
from public.ai_usage
group by user_id, date_trunc('day', created_at)
order by day desc, calls desc;

-- Same rollup, all-time per user — the quick "who's used the most, ever"
-- view, and a running total cost estimate per user.
create or replace view public.ai_usage_total_by_user as
select
  user_id,
  count(*) as calls,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  round(
    (sum(input_tokens) * 0.15 + sum(output_tokens) * 0.60) / 1000000.0,
    4
  ) as estimated_cost_usd,
  max(created_at) as last_call_at
from public.ai_usage
group by user_id
order by calls desc;

-- These aggregate across EVERY user — must never be reachable through the
-- public API (PostgREST otherwise exposes any public-schema view/table to
-- anon/authenticated by default, which would leak every user's usage to
-- every other signed-in user). Only reachable via the Supabase Studio
-- SQL/Table Editor's own privileged Postgres connection, never the app.
revoke all on public.ai_usage_daily_by_user from anon, authenticated;
revoke all on public.ai_usage_total_by_user from anon, authenticated;
