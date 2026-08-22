-- TEMPORARY diagnostic views, to be dropped immediately after use (see
-- session notes) -- investigating why an anon-role insert into
-- bug_reports/game_plays returns a 42501 RLS violation despite an
-- apparently-permissive "with check (true)" policy for anon/authenticated.
create or replace view public.__debug_policies as
  select schemaname, tablename, policyname, roles, cmd, qual, with_check
  from pg_policies
  where tablename in ('bug_reports', 'usage_pings', 'game_plays');

create or replace view public.__debug_grants as
  select grantee, table_name, privilege_type
  from information_schema.role_table_grants
  where table_name in ('bug_reports', 'usage_pings', 'game_plays')
    and grantee in ('anon', 'authenticated', 'public');
