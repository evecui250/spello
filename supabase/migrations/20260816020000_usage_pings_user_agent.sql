-- Adds user_agent to usage_pings (same field bug_reports already
-- captures) -- the closest thing to "what device/browser is this" the
-- client can honestly report without adding IP logging, which is a
-- bigger step (real personal data under most privacy frameworks, and
-- this app's privacy policy doesn't currently disclose collecting it).
alter table public.usage_pings add column if not exists user_agent text;
