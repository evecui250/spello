-- TEMPORARY, see 20260822140000_temp_debug_rls_views.sql.
create or replace view public.__debug_table_privileges as
  select grantee, table_name, privilege_type
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('bug_reports', 'usage_pings', 'game_plays', 'ai_usage')
  order by table_name, grantee, privilege_type;
