-- Fires notify-bug-report (see supabase/functions/notify-bug-report) on
-- every new bug_reports row, via pg_net's async http_post rather than the
-- Dashboard's "Database Webhooks" UI -- that UI depends on a
-- `supabase_functions` bootstrap schema this project doesn't have, and
-- creating it is itself gated behind pg_net being enabled first. Since
-- pg_net alone is sufficient to make the same HTTP call directly, this
-- skips that dependency entirely.
--
-- The shared secret the Edge Function checks (see its own header check)
-- is deliberately NOT embedded here -- this repo is public, so a literal
-- secret in any committed migration file would leak into git history
-- forever. It's stored in Supabase Vault instead (seeded once via an
-- ad-hoc `supabase db query` command, never written to a file) under the
-- name 'bug_report_webhook_secret', and looked up by name below.
create extension if not exists pg_net;

create or replace function public.notify_bug_report()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'bug_report_webhook_secret'
  limit 1;

  if webhook_secret is null then
    -- Not configured yet -- skip rather than error, so a bug report can
    -- still be filed normally even before the secret is seeded.
    return new;
  end if;

  perform net.http_post(
    url := 'https://whjiebzglefivvczvpfb.supabase.co/functions/v1/notify-bug-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists on_bug_report_insert on public.bug_reports;
create trigger on_bug_report_insert
  after insert on public.bug_reports
  for each row
  execute function public.notify_bug_report();
