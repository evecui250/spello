-- usage_pings is now written exclusively by the record-usage-ping Edge
-- Function (service role, bypasses RLS) rather than a direct client-side
-- insert -- see lib/telemetry.ts. The old "anyone can insert" policy is
-- no longer needed for the app to work, and removing it means a stray
-- direct insert (anyone who discovers the anon key + table name, e.g. via
-- browser devtools) can no longer write arbitrary rows here at all.
drop policy if exists "Anyone can record a usage ping" on public.usage_pings;
