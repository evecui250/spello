'use client';

import { supabase } from './supabase';
import { getLocalAvatarId, saveLocalAvatarId, getLocalNickname, saveLocalNickname } from './storage';

// Avatar and accessory catalogs are small, curated, rarely-changing
// static content -- kept as code, not database tables, matching this
// codebase's existing convention for shared static config (e.g.
// generate-sentence's WORD_RANGE). The accessory catalog here is
// duplicated (not imported) into buy-accessory's own Edge Function copy,
// since no other Edge Function in this codebase shares code via a
// _shared/ module -- see that function's own header comment.

// A learner can wear one item per slot, all three at once -- collar,
// headwear, and sidewear (a loose "everything else" slot: a held item, an
// alternate background, etc). Fixed order matters here: it's exactly how
// multiple equipped accessories combine into one combo key (see
// accessoryComboKey below), which has to match how the underlying combo
// art was actually named/generated -- changing this order would silently
// break every existing multi-accessory image lookup.
export type AccessorySlot = 'collar' | 'headwear' | 'sidewear';
const SLOT_ORDER: AccessorySlot[] = ['collar', 'headwear', 'sidewear'];

export interface EquippedAccessories {
  collar: string | null;
  headwear: string | null;
  sidewear: string | null;
}

export const NO_ACCESSORIES: EquippedAccessories = { collar: null, headwear: null, sidewear: null };

// The exact key AvatarOption.variants is looked up by -- every equipped
// slot's accessory id, in SLOT_ORDER, joined by '+', skipping empty slots
// ('' when nothing is equipped at all). Two single-accessory keys already
// existed before multi-slot equipping (e.g. 'leather-collar'); this is
// just the same idea generalized to more than one accessory at once (e.g.
// 'leather-collar+straw-hat').
function accessoryComboKey(equipped: EquippedAccessories): string {
  return SLOT_ORDER.map(slot => equipped[slot]).filter((id): id is string => !!id).join('+');
}

export interface AvatarOption {
  id: string;
  name: string;
  image: string; // path under /public, no accessory equipped -- a circular
  // headshot crop, used wherever the avatar reads as an identity/profile
  // picture (Leaderboard rows, AccountPanel's thumbnail, MascotShopModal).
  // Keyed by accessoryComboKey's output -- a whole separate image per
  // combination, not layered overlays, since that's how the art is
  // actually produced (each combination is its own full redraw per
  // animal). avatarImageFor below is the one place that should ever read
  // this.
  variants?: Record<string, string>;
  comingSoon?: boolean;
  // Full-body portrait, transparent background -- used wherever the pet
  // is shown as a character rather than a profile picture (Home's hero,
  // the pet/nickname picker). Kept as a separate image rather than a crop
  // of `image`, since that's how the art was actually produced. Falls
  // back to `image` in heroImageFor below for any avatar that doesn't
  // have one yet. Accessories have no full-body art at all (a
  // profile-picture-only concept so far) -- see heroImageFor's own
  // comment.
  heroImage?: string;
}

export const AVATAR_CATALOG: AvatarOption[] = [
  {
    id: 'dachshund', name: 'Dachshund', image: 'avatar_dachshund.png',
    variants: {
      'leather-collar': 'avatar_dachshund_gold_collar.png',
      'straw-hat': 'avatar_dachshund_straw_hat.png',
      'leather-collar+straw-hat': 'avatar_dachshund_gold_collar_straw_hat.png',
    },
    heroImage: 'pet_dachshund_full.png',
  },
  {
    id: 'cat', name: 'Cat', image: 'avatar_cat.png',
    variants: {
      'leather-collar': 'avatar_cat_gold_collar.png',
      'straw-hat': 'avatar_cat_straw_hat.png',
      'leather-collar+straw-hat': 'avatar_cat_gold_collar_straw_hat.png',
    },
    heroImage: 'pet_cat_full.png',
  },
  {
    id: 'labrador', name: 'Labrador', image: 'avatar_labrador.png',
    variants: {
      'leather-collar': 'avatar_labrador_gold_collar.png',
      'straw-hat': 'avatar_labrador_straw_hat.png',
      'leather-collar+straw-hat': 'avatar_labrador_gold_collar_straw_hat.png',
    },
    heroImage: 'pet_labrador_full.png',
  },
  {
    id: 'cat-white', name: 'White Cat', image: 'avatar_cat_white.png',
    variants: {
      'leather-collar': 'avatar_cat_white_gold_collar.png',
      'straw-hat': 'avatar_cat_white_straw_hat.png',
      'leather-collar+straw-hat': 'avatar_cat_white_gold_collar_straw_hat.png',
    },
    heroImage: 'pet_cat_white_full.png',
  },
];

// The one place that should resolve "what full-body portrait do I show
// for this pet" -- accessories have no separate full-body art (they're a
// profile-picture-only concept so far), so this ignores equipped
// accessories entirely, unlike avatarImageFor below.
export function heroImageFor(avatarId: string): string {
  const avatar = AVATAR_CATALOG.find(a => a.id === avatarId) ?? AVATAR_CATALOG[0];
  return avatar.heroImage ?? avatar.image;
}

// The one place that should resolve "what image do I actually show for
// this user" -- the equipped accessories only change the picture if the
// chosen avatar actually has a drawn variant for that exact combination
// (every real combination does today, but this stays safe if that ever
// isn't true, e.g. a future accessory added before its own combo art
// exists for every avatar -- falls back to the plain avatar rather than
// showing nothing).
export function avatarImageFor(avatarId: string, equipped: EquippedAccessories | null | undefined): string {
  const avatar = AVATAR_CATALOG.find(a => a.id === avatarId) ?? AVATAR_CATALOG[0];
  const key = equipped ? accessoryComboKey(equipped) : '';
  if (key && avatar.variants?.[key]) return avatar.variants[key];
  return avatar.image;
}

export interface AccessoryOption {
  id: string;
  name: string;
  cost: number;
  icon: string; // path under /public -- the shop grid's own item image
  slot: AccessorySlot;
}

export const ACCESSORY_CATALOG: AccessoryOption[] = [
  { id: 'leather-collar', name: 'Leather Collar', cost: 200, icon: 'item_leather_collar_icon.png', slot: 'collar' },
  { id: 'straw-hat', name: 'Straw Hat', cost: 1000, icon: 'item_straw_hat_icon.png', slot: 'headwear' },
];

export interface MyProfile {
  nickname: string | null;
  avatarId: string;
  equipped: EquippedAccessories;
  leaderboardOptOut: boolean;
  ownedAccessoryIds: string[];
  balance: number;
}

// Signed-out callers get null, same convention as getAiUsageStats. One
// retry before giving up on a real failure -- real report caught live: a
// learner who'd already set a nickname on one device signed in on a
// second one and was shown the "Set a nickname…" placeholder again, as if
// nothing had ever been saved. This had zero retry, unlike every other AI/
// profile call in the app (see e.g. ParagraphExerciseCard's own gloss
// fetch for the identical fix) -- a single transient failure right at
// sign-in (this is very often called the moment a session first exists,
// racing every other startup fetch, or right after AccountPanel's own
// verifyOtp flow) silently returned null, and the caller (AccountPanel's
// loadProfile) has no way to tell "genuinely no nickname yet" apart from
// "the fetch itself failed" -- it just leaves the field blank either way.
export async function getMyProfile(): Promise<MyProfile | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke<MyProfile>('get-my-profile');
    if (!error && data) return data;
  }
  return null;
}

export interface BuyAccessoryResult {
  ok: boolean;
  error?: string;
  balance?: number;
}

export async function buyAccessory(accessoryId: string): Promise<BuyAccessoryResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const { data, error } = await supabase.functions.invoke<BuyAccessoryResult>('buy-accessory', {
    body: { accessoryId },
  });
  if (error || !data) return { ok: false, error: 'Could not reach the shop' };
  return data;
}

// Nickname/avatar/equip/opt-out are pure preference with no economic
// stakes, so these write directly to the client-writable `profiles`
// table under RLS (auth.uid() = user_id) rather than going through an
// Edge Function -- same trust level as daily_activity's own direct
// client upserts.
async function upsertProfile(fields: Record<string, unknown>): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: session.user.id, updated_at: new Date().toISOString(), ...fields }, { onConflict: 'user_id' });
  return !error;
}

export function setNickname(nickname: string): Promise<boolean> {
  return upsertProfile({ nickname: nickname.trim().slice(0, 24) || null });
}

export function setAvatarId(avatarId: string): Promise<boolean> {
  return upsertProfile({ avatar_id: avatarId });
}

const SLOT_COLUMN: Record<AccessorySlot, string> = {
  collar: 'equipped_collar_id',
  headwear: 'equipped_headwear_id',
  sidewear: 'equipped_sidewear_id',
};

// Equips (or, with accessoryId=null, unequips) one slot at a time --
// setting one slot never touches the other two, so a learner can mix an
// owned collar with an owned hat independently.
export function setEquippedAccessory(slot: AccessorySlot, accessoryId: string | null): Promise<boolean> {
  return upsertProfile({ [SLOT_COLUMN[slot]]: accessoryId });
}

export function setLeaderboardOptOut(optOut: boolean): Promise<boolean> {
  return upsertProfile({ leaderboard_opt_out: optOut });
}

export interface DisplayProfile {
  avatarId: string;
  equipped: EquippedAccessories;
  nickname: string | null;
  signedIn: boolean;
}

// The one place Home and the pet/nickname picker both read from, so
// neither has to re-implement "am I signed in, and if not what do I show
// instead" on its own. Signed-out visitors get the local fallback (see
// lib/storage.ts) with no equipped accessories — accessories are bought
// with points, which only exist for a signed-in account.
export async function getDisplayProfile(): Promise<DisplayProfile> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const profile = await getMyProfile();
    if (profile) {
      return { avatarId: profile.avatarId, equipped: profile.equipped, nickname: profile.nickname, signedIn: true };
    }
    // getMyProfile already retries once; a still-failed fetch falls back
    // to the same untouched defaults a brand new profile would have,
    // rather than leaving the caller with nothing to render.
    return { avatarId: 'dachshund', equipped: NO_ACCESSORIES, nickname: null, signedIn: true };
  }
  return { avatarId: getLocalAvatarId(), equipped: NO_ACCESSORIES, nickname: getLocalNickname(), signedIn: false };
}

// Called once, right after a fresh sign-in (see lib/sync.ts's
// watchAuthAndSync — specifically its 'SIGNED_IN' branch, not
// 'INITIAL_SESSION', which fires on every reload and would run this far
// more than once). If this device had picked a pet/nickname while signed
// out, and the account it just signed into has never been customized
// (still the untouched defaults), push the local choice up — otherwise a
// learner who picked a pet before ever signing in would see it silently
// reset to the default dachshund the moment they sign in. Never
// overwrites a real, already-customized profile (e.g. signing into an
// existing account from a fresh device that happens to have its own
// stale local pick).
export async function migrateLocalProfileIfNeeded(): Promise<void> {
  const localAvatarId = getLocalAvatarId();
  const localNickname = getLocalNickname();
  if (localAvatarId === 'dachshund' && !localNickname) return;
  const profile = await getMyProfile();
  if (!profile || profile.avatarId !== 'dachshund' || profile.nickname !== null) return;
  if (localAvatarId !== 'dachshund') await setAvatarId(localAvatarId);
  if (localNickname) await setNickname(localNickname);
}
