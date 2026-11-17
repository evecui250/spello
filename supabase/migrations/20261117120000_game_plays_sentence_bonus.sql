-- The optional "build a sentence" step after a new word's first round
-- earns 1 coin, recorded as a game_plays row with game = 'sentence' (see
-- lib/shop.ts's recordSentenceBonus) so the existing balance/leaderboard
-- counting picks it up unchanged. Only the allowed `game` values change.
alter table public.game_plays drop constraint if exists game_plays_game_check;
alter table public.game_plays add constraint game_plays_game_check
  check (game in ('wortpaare', 'artikel_blitz', 'sentence'));
