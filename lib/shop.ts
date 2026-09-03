'use client';

import { supabase } from './supabase';

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
  image: string; // path under /public
  comingSoon?: boolean;
}

export const AVATAR_CATALOG: AvatarOption[] = [
  { id: 'dachshund', name: 'Dachshund', image: 'avatar_dachshund.png' },
  { id: 'cat', name: 'Cat', image: 'avatar_cat.png' },
  { id: 'labrador', name: 'Labrador', image: 'avatar_labrador.png' },
  { id: 'cat-white', name: 'White Cat', image: 'avatar_cat_white.png' },
];

export interface AccessoryOption {
  id: string;
  name: string;
  cost: number;
}

export const ACCESSORY_CATALOG: AccessoryOption[] = [
  { id: 'bandana', name: 'Bandana', cost: 50 },
  { id: 'bowtie', name: 'Bow tie', cost: 90 },
  { id: 'sunglasses', name: 'Sunglasses', cost: 150 },
  { id: 'party-hat', name: 'Party hat', cost: 220 },
  { id: 'gold-collar', name: 'Gold collar', cost: 500 },
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

// Signed-out callers get null, same convention as getAiUsageStats.
export async function getMyProfile(): Promise<MyProfile | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.functions.invoke<MyProfile>('get-my-profile');
  if (error || !data) return null;
  return data;
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
