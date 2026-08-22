-- TEMPORARY, see 20260822140000_temp_debug_rls_views.sql -- dropped by
-- 20260822150000_drop_temp_debug_views.sql.
create or replace view public.__debug_all_grants as
  select grantee, table_name, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated')
  order by table_name, grantee, privilege_type;
