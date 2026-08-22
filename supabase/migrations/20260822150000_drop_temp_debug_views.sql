-- Drops the TEMPORARY diagnostic views from the RLS/grants investigation
-- in 20260822140000-20260822144000 -- that investigation turned out to be
-- a red herring (a flawed raw-fetch reproduction, not a real bug; the
-- actual app's supabase-js client inserts into these tables fine, since
-- anon/authenticated already hold full grants per pg_class.relacl). None
-- of these were ever meant to stick around.
drop view if exists public.__debug_policies;
drop view if exists public.__debug_grants;
drop view if exists public.__debug_all_grants;
drop view if exists public.__debug_table_privileges;
drop view if exists public.__debug_table_privileges2;
drop view if exists public.__debug_relacl;
