-- Splits the single equipped_accessory_id into three independent slots
-- (collar, headwear, sidewear) so a learner can wear items from each at
-- once, rather than only ever one accessory total -- see lib/shop.ts's
-- avatarImageFor for how the three combine into one image lookup key.
--
-- Every accessory that has ever existed (just 'leather-collar' so far) is
-- a collar, so any already-equipped value is backfilled straight into
-- equipped_collar_id. The old column is deliberately left in place
-- (unused, not dropped) rather than removed in the same migration that
-- introduces its replacement -- safer for a live table with real user
-- data, and costs nothing to leave inert.
alter table public.profiles
  add column if not exists equipped_collar_id text,
  add column if not exists equipped_headwear_id text,
  add column if not exists equipped_sidewear_id text;

update public.profiles
  set equipped_collar_id = equipped_accessory_id
  where equipped_accessory_id is not null
    and equipped_collar_id is null;
