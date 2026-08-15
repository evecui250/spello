-- Removes rows inserted while manually verifying usage_pings/bug_reports
-- RLS right after creating usage_pings — the table is brand new (this
-- migration ships in the same batch that created it), so no real device
-- has had a chance to ping it yet; an unconditional wipe is safe here.
delete from public.usage_pings;

delete from public.bug_reports
where message like 'Real diagnostic test from Playwright%'
   or message like 'test-from-curl-diagnostic%';
