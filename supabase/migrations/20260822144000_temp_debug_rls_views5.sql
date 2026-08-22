-- TEMPORARY, see 20260822140000_temp_debug_rls_views.sql. Using
-- pg_class.relacl directly rather than information_schema.table_privileges
-- -- the latter only shows grants "applicable to the current user" per SQL
-- spec, which hides grants to anon/authenticated when queried as
-- service_role (not a member of either), giving a false "no grants" read.
create or replace view public.__debug_relacl as
  select relname, relacl::text
  from pg_class
  where relname in ('bug_reports', 'usage_pings', 'game_plays', 'daily_activity', 'user_progress', 'ai_usage');
