-- Distinguishes the new "Why?" grammar-explanation calls from the regular
-- sentence-correction ones already logged here, so admin-stats can answer
-- "how many people actually use the Why? button" as its own count instead
-- of it being invisibly folded into overall AI usage. Existing rows (all
-- corrections, predating this column) default to 'correction' rather than
-- needing a backfill.
alter table public.ai_usage add column if not exists kind text not null default 'correction';
