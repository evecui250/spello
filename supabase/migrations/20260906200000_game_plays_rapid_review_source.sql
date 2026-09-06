-- Progress page now has one top-of-page "Rapid Review" button mixing
-- mastered + still-learning words (WordMatchGame with no `focus`, see
-- app/game/page.tsx's REVIEW_CONFIG) instead of only the four per-stage
-- reviews -- adds this new source value alongside the existing ones.
alter table public.game_plays drop constraint game_plays_source_check;
alter table public.game_plays add constraint game_plays_source_check
  check (source in ('settings_preview', 'daily_flow', 'rapid_review', 'puppy_review', 'short_review', 'medium_review', 'mastered_review'));
