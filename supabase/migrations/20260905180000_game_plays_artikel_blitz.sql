-- Adds Artikel Blitz alongside Wortpaare (formerly "Word Match") in
-- game_plays -- see ArtikelBlitzGame.tsx. `game` distinguishes which one a
-- row belongs to (existing rows default to 'wortpaare', the only game that
-- existed before this); `pairs_matched` stays Wortpaare-only, Artikel
-- Blitz populates words_answered/correct_count instead. No change needed
-- to get-leaderboard/get-my-profile/buy-accessory's points logic -- it
-- already counts one point per game_plays row per day, capped at
-- GAME_PLAY_DAILY_POINT_CAP, with no game-type awareness, so these rows
-- contribute to that same shared cap automatically.
alter table public.game_plays add column if not exists game text not null default 'wortpaare';
alter table public.game_plays add constraint game_plays_game_check
  check (game in ('wortpaare', 'artikel_blitz'));
alter table public.game_plays add column if not exists words_answered integer;
alter table public.game_plays add column if not exists correct_count integer;
