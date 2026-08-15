-- Adds ip_address to usage_pings. A plain client-side insert can't
-- populate this honestly (client JS has no reliable way to read its own
-- public IP, and even if it could, only the server actually observes the
-- true request IP) -- so this column is written by the new
-- record-usage-ping Edge Function instead of the direct PostgREST insert
-- lib/telemetry.ts used before. See that function for where the IP is
-- read from (the request's forwarding headers).
alter table public.usage_pings add column if not exists ip_address inet;
