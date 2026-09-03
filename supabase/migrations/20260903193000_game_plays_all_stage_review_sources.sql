-- Every mascot stage now gets its own rapid-review entry point from the
-- Progress page (previously mastered-only) -- adds the other three
-- source values alongside the 'mastered_review' one just added. See
-- WordMatchGame.tsx's own Props.source comment.
alter table public.game_plays drop constraint game_plays_source_check;
alter table public.game_plays add constraint game_plays_source_check
  check (source in ('settings_preview', 'daily_flow', 'puppy_review', 'short_review', 'medium_review', 'mastered_review'));
