-- A learner's own added vocabulary (see lib/storage.ts's custom-words
-- section and app/words/page.tsx's "look up & add" flow) — nested by
-- level, same shape/reasoning as the existing `progress`/`settings`
-- columns (see lib/sync.ts's ProgressByLevel): each level is its own
-- profile locally, so the cloud backup mirrors that rather than letting
-- one level's custom words bleed into another's.
-- Shape: {"A1": {"custom-<uuid>": {...Word}}, "B2": {...}}
alter table public.user_progress
  add column if not exists custom_words jsonb not null default '{}'::jsonb;
