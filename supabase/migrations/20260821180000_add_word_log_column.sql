-- Per-day word-activity log for the Progress page calendar's tap-a-date
-- popup (see lib/storage.ts's DAILY_WORD_LOG_KEY comment for the full
-- reasoning: WordProgress's own lastPracticed/lastReviewedAt/mascotStage
-- fields only hold each word's single latest date, so an earlier "which
-- words did I touch on this specific day" view silently loses words once
-- they're touched again later — this is a real, append-only log instead).
-- Shape: {"2026-08-21": {"learned": ["w001"], "reviewed": ["w024"]}, ...}
alter table public.user_progress
  add column if not exists word_log jsonb not null default '{}'::jsonb;
