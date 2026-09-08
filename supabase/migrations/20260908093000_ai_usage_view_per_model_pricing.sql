-- ai_usage_daily_by_user/ai_usage_total_by_user (see their own creating
-- migration) hardcoded a single flat gpt-4o-mini rate for EVERY row
-- regardless of which model actually served it -- accurate only when
-- gpt-4o-mini was the only model in play. Every row since (gpt-5.6-terra,
-- gpt-5.6-luna, tts-1-hd) has been mispriced by this view ever since,
-- even though admin-stats' own MODEL_PRICING table (supabase/functions/
-- admin-stats/index.ts) has tracked per-model rates correctly the whole
-- time -- this was a second, silently-drifted copy of that pricing.
--
-- Rates below are kept in sync BY HAND with admin-stats' own MODEL_PRICING
-- (no shared module between a SQL view and an Edge Function) -- check that
-- file's own rates first if this ever needs updating again. Unknown/future
-- models fall back to the gpt-4o-mini rate via ELSE, same "approximate
-- rather than silently $0" reasoning admin-stats' own DEFAULT_PRICING
-- documents.
create or replace view public.ai_usage_daily_by_user as
select
  user_id,
  date_trunc('day', created_at) as day,
  count(*) as calls,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  round(
    sum(
      case model
        when 'gpt-4o-mini'   then input_tokens * 0.15  + output_tokens * 0.60
        when 'gpt-4o'        then input_tokens * 2.50  + output_tokens * 10.00
        when 'gpt-5.6-luna'  then input_tokens * 0.20  + output_tokens * 1.20
        when 'gpt-5.6-terra' then input_tokens * 2.00  + output_tokens * 12.00
        when 'tts-1-hd'      then input_tokens * 30.00
        else input_tokens * 0.15 + output_tokens * 0.60
      end
    ) / 1000000.0,
    4
  ) as estimated_cost_usd
from public.ai_usage
group by user_id, date_trunc('day', created_at)
order by day desc, calls desc;

create or replace view public.ai_usage_total_by_user as
select
  user_id,
  count(*) as calls,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  round(
    sum(
      case model
        when 'gpt-4o-mini'   then input_tokens * 0.15  + output_tokens * 0.60
        when 'gpt-4o'        then input_tokens * 2.50  + output_tokens * 10.00
        when 'gpt-5.6-luna'  then input_tokens * 0.20  + output_tokens * 1.20
        when 'gpt-5.6-terra' then input_tokens * 2.00  + output_tokens * 12.00
        when 'tts-1-hd'      then input_tokens * 30.00
        else input_tokens * 0.15 + output_tokens * 0.60
      end
    ) / 1000000.0,
    4
  ) as estimated_cost_usd,
  max(created_at) as last_call_at
from public.ai_usage
group by user_id
order by calls desc;

-- Same lockdown as the original creating migration -- views must stay
-- unreachable through the public API (PostgREST otherwise exposes any
-- public-schema view to anon/authenticated by default).
revoke all on public.ai_usage_daily_by_user from anon, authenticated;
revoke all on public.ai_usage_total_by_user from anon, authenticated;
