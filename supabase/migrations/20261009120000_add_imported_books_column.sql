-- Registry of a learner's imported vocabulary books (see lib/storage.ts's
-- imported-books section). Each book is its own profile keyed by a
-- `book-<uuid>` id; its words/progress/settings live under that id inside
-- the existing per-level custom_words/progress/settings columns. This
-- column only records which book ids exist (plus name/provenance), so a
-- second device knows to merge those profiles at all.
-- Shape: [{"id": "book-<uuid>", "name": "...", "createdAt": "...", "wordCount": 123, "sourcePages": "5-8"}]
alter table public.user_progress
  add column if not exists imported_books jsonb not null default '[]'::jsonb;
