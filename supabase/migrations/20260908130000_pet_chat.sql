-- Backs the new "Text to Pet" free-form German conversation feature
-- (components/PetChatFlow.tsx, supabase/functions/pet-chat-turn|
-- pet-chat-summary|pet-memory-decide). Every table here follows
-- owned_accessories'/daily_activity_anon's service-role-only tier (RLS
-- enabled, NO policies for anon/authenticated at all) rather than
-- game_plays' direct-client-insert tier: unlike a game score, every write
-- here is gated behind real AI-call logic (correction, event
-- classification, daily-cap checks) that must run server-side regardless,
-- so there is no legitimate direct-client-insert path to leave open, and a
-- writable-by-anyone table would let a caller forge conversation history/
-- events/memories with no correction ever having actually happened.
--
-- device_id + optional user_id (references auth.users on delete set null)
-- is the same anon-or-signed-in shape as game_plays -- this feature is
-- available to signed-out visitors too, same as every other AI feature in
-- this app (rate-limited by IP/device via ai_usage, not gated on sign-in).
create table public.pet_chat_sessions (
  id bigint generated always as identity primary key,
  device_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  topic text not null,
  level text not null,
  native_language text not null default 'en' check (native_language in ('en', 'zh')),
  -- Count of USER messages so far (not pet messages) -- this is exactly
  -- the "turn number" the pet-chat-turn prompt paces its question
  -- progression against, and what the server ORs against the model's own
  -- shouldConclude judgment to guarantee turn 7 always offers a summary.
  turn_count int not null default 0,
  status text not null default 'active' check (status in ('active', 'concluded', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pet_chat_sessions enable row level security;
-- No policies -- only pet-chat-turn/pet-chat-summary's service-role client
-- ever reads or writes this table (see this file's own header comment).

create table public.pet_chat_messages (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.pet_chat_sessions(id) on delete cascade,
  turn_number int not null,
  role text not null check (role in ('user', 'pet')),
  text text not null,
  -- User messages only: the grammar/spelling-only correction. Deliberately
  -- leaves any vocabulary-gap foreign-language fragment (e.g. a dropped-in
  -- English/Chinese word) untouched -- vocabulary gaps are tracked
  -- separately in pet_chat_events as 'unknownVocabulary', never folded
  -- into this correction, so the diff shown to the learner never lumps a
  -- vocab substitution in with a real grammar fix. Null when the message
  -- needed no correction at all (pet-chat-turn's own contract: '' from the
  -- model becomes null here, not an empty-string row).
  corrected_text text,
  -- Pet messages only: the whole-sentence translation shown when the
  -- learner taps the bubble (V1 is whole-sentence only, no per-word
  -- dictionary lookup -- see pet-chat-turn's own comment).
  translation text,
  created_at timestamptz not null default now()
);

alter table public.pet_chat_messages enable row level security;
-- No policies -- same reasoning as pet_chat_sessions above.

create table public.pet_chat_events (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.pet_chat_sessions(id) on delete cascade,
  turn_number int not null,
  -- Kept deliberately distinct (never lumped into a generic "mistake") so
  -- the end-of-session summary can build separate, itemized sections for
  -- each -- see pet-chat-summary, which assembles its grammar/spelling/
  -- vocab-gap/recent-word sections directly from these rows, not from a
  -- second AI call re-discovering them from the transcript.
  event_type text not null check (event_type in
    ('grammarMistake', 'spellingMistake', 'unknownVocabulary', 'hintUsed', 'successfulRecentWordUse')),
  wrong text not null default '',
  correct text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

alter table public.pet_chat_events enable row level security;
-- No policies -- same reasoning as pet_chat_sessions above.

create table public.pet_memories (
  id bigint generated always as identity primary key,
  device_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  session_id bigint references public.pet_chat_sessions(id) on delete set null,
  fact text not null,
  -- Never silently promoted to "permanent" -- pending until the learner
  -- explicitly confirms or dismisses it on the summary screen (see
  -- pet-memory-decide), per the product requirement that a pet-memory
  -- candidate must always be user-visible/editable/confirmable first.
  -- Only 'confirmed' rows are ever read back into a future conversation's
  -- prompt (see pet-chat-turn).
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.pet_memories enable row level security;
-- No policies -- only pet-chat-summary (insert) and pet-memory-decide
-- (update) ever touch this table, both via their service-role client;
-- pet-chat-turn's own service-role client separately SELECTs confirmed
-- rows to inject as background context. No anon/authenticated client
-- should ever be able to write an unconfirmed "memory" about itself
-- directly, or flip another device's memory to confirmed.
