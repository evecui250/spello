-- Adds 'mastered_review' as a valid game_plays.source value -- the new
-- Progress page entry point (tap the Mastered mascot -> "Rapid review"),
-- alongside the existing 'settings_preview'/'daily_flow' sources. See
-- WordMatchGame.tsx's own Props.source comment.
alter table public.game_plays drop constraint game_plays_source_check;
alter table public.game_plays add constraint game_plays_source_check
  check (source in ('settings_preview', 'daily_flow', 'mastered_review'));
