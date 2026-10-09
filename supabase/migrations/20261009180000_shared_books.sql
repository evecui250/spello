-- Book codes: one learner imports a book from a PDF (see
-- components/ImportBookModal.tsx) and shares it with their class via a
-- short code; anyone who enters the code gets a copy of the same word list
-- as their own imported book, with their own separate progress. Only the
-- word list is shared — never anyone's progress.
--
-- Read and written only by the share-book Edge Function (service role),
-- same lockdown as usage_pings/daily_activity_anon: RLS on, no client
-- policies, so the table can't be listed or enumerated from the browser —
-- a book is only reachable by someone who has its exact code.
create table if not exists public.shared_books (
  code text primary key,
  name text not null,
  source_pages text not null default '',
  words jsonb not null,
  word_count int not null,
  created_by uuid references auth.users(id) on delete set null,
  created_ip text,
  created_at timestamptz not null default now(),
  join_count int not null default 0
);

alter table public.shared_books enable row level security;

create index if not exists shared_books_created_at_idx on public.shared_books (created_at);
