-- Lets anyone report a bug/problem from a small floating button visible on
-- every page (see components/BugReportButton.tsx), without navigating away
-- or losing whatever they were doing. Works whether signed in or not —
-- sign-in is entirely optional throughout the app (see AuthGate's
-- removal) — so this can't be scoped to auth.uid() the way ai_usage is.
-- Insert-only from the client; reports are only ever read via the
-- Supabase dashboard/SQL editor (service role bypasses RLS), never read
-- back by the reporting user themselves.
create table if not exists public.bug_reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  message text not null,
  page_path text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.bug_reports enable row level security;

create policy "Anyone can file a bug report"
  on public.bug_reports for insert
  to anon, authenticated
  with check (true);
