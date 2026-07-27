-- Logs every AI sentence-correction call so spend can be tracked from the
-- Supabase table editor (or a SQL query) instead of guessing at usage.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id text not null,
  level text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.ai_usage enable row level security;

create policy "Users can insert their own ai_usage"
  on public.ai_usage for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own ai_usage"
  on public.ai_usage for select
  using (auth.uid() = user_id);
