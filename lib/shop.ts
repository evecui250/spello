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

export interface AvatarOption {
  id: string;
  name: string;
  image: string; // path under /public, no accessory equipped
  // Per-accessory-id alternate portrait for THIS animal -- a whole
  // separate image, not an overlay, since that's how the art was actually
  // produced (each accessory is a full redraw per animal, not a sticker
  // composited on top). avatarImageFor below is the one place that
  // should ever read this.
  variants?: Record<string, string>;
  comingSoon?: boolean;
}

export const AVATAR_CATALOG: AvatarOption[] = [
  { id: 'dachshund', name: 'Dachshund', image: 'avatar_dachshund.png', variants: { 'leather-collar': 'avatar_dachshund_gold_collar.png' } },
  { id: 'cat', name: 'Cat', image: 'avatar_cat.png', variants: { 'leather-collar': 'avatar_cat_gold_collar.png' } },
  { id: 'labrador', name: 'Labrador', image: 'avatar_labrador.png', variants: { 'leather-collar': 'avatar_labrador_gold_collar.png' } },
  { id: 'cat-white', name: 'White Cat', image: 'avatar_cat_white.png', variants: { 'leather-collar': 'avatar_cat_white_gold_collar.png' } },
];

// The one place that should resolve "what image do I actually show for
// this user" -- the equipped accessory only changes the picture if the
// chosen avatar actually has a drawn variant for it (every avatar does,
// for every accessory that exists today, but this stays safe if that
// ever isn't true, e.g. a future avatar added before its own variant
// art exists).
export function avatarImageFor(avatarId: string, equippedAccessoryId: string | null | undefined): string {
  const avatar = AVATAR_CATALOG.find(a => a.id === avatarId) ?? AVATAR_CATALOG[0];
  if (equippedAccessoryId && avatar.variants?.[equippedAccessoryId]) return avatar.variants[equippedAccessoryId];
  return avatar.image;
}

export interface AccessoryOption {
  id: string;
  name: string;
  cost: number;
  icon: string; // path under /public -- the shop grid's own item image
}

export const ACCESSORY_CATALOG: AccessoryOption[] = [
  { id: 'leather-collar', name: 'Leather Collar', cost: 200, icon: 'item_leather_collar_icon.png' },
];

// How many of a user's game_plays rows count toward points PER CALENDAR
// DAY -- game_plays has zero insert rate-limiting and a nullable,
// self-reported user_id (see components/WordMatchGame.tsx's insert), so
// this bounds the abuse surface to a fixed small amount per day
// regardless of how many rows someone spams. Applied at aggregation time
// in get-leaderboard/get-my-profile/buy-accessory -- kept in sync as a
// literal duplicate of the same constant in each of those three Edge
// Functions (no shared module exists in this codebase to import it from).
export const GAME_PLAY_DAILY_POINT_CAP = 5;

export interface MyProfile {
  nickname: string | null;
  avatarId: string;
  equippedAccessoryId: string | null;
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

export function setEquippedAccessory(accessoryId: string | null): Promise<boolean> {
  return upsertProfile({ equipped_accessory_id: accessoryId });
}

export function setLeaderboardOptOut(optOut: boolean): Promise<boolean> {
  return upsertProfile({ leaderboard_opt_out: optOut });
}

export interface DisplayProfile {
  avatarId: string;
  equippedAccessoryId: string | null;
  nickname: string | null;
  signedIn: boolean;
}

// The one place Home and the pet/nickname picker both read from, so
// neither has to re-implement "am I signed in, and if not what do I show
// instead" on its own. Signed-out visitors get the local fallback (see
// lib/storage.ts) with no equipped accessory — accessories are bought
// with points, which only exist for a signed-in account.
export async function getDisplayProfile(): Promise<DisplayProfile> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const profile = await getMyProfile();
    if (profile) {
      return { avatarId: profile.avatarId, equippedAccessoryId: profile.equippedAccessoryId, nickname: profile.nickname, signedIn: true };
    }
    // getMyProfile already retries once; a still-failed fetch falls back
    // to the same untouched defaults a brand new profile would have,
    // rather than leaving the caller with nothing to render.
    return { avatarId: 'dachshund', equippedAccessoryId: null, nickname: null, signedIn: true };
  }
  return { avatarId: getLocalAvatarId(), equippedAccessoryId: null, nickname: getLocalNickname(), signedIn: false };
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
