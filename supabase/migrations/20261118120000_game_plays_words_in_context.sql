-- Words in Context is a bonus game now (components/WordsInContextGame.tsx):
-- each finished text is one game_plays row, +1 coin like the other games.
alter table public.game_plays drop constraint if exists game_plays_game_check;
alter table public.game_plays add constraint game_plays_game_check
  check (game in ('wortpaare', 'artikel_blitz', 'sentence', 'words_in_context'));
