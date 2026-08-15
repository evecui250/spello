'use client';

import { supabase } from './supabase';
import { getSettings } from './storage';

// A random per-browser-profile id, minted once and reused forever — NOT
// tied to a Spello account or CEFR level (deliberately un-namespaced,
// unlike everything in storage.ts), since its whole point is to identify
// "this device" even for a learner who never signs in. See the
// usage_pings migration for why this is the only way to see those
// learners at all.
const DEVICE_ID_KEY = 'wb2_device_id';
const LAST_PING_KEY = 'wb2_last_ping_date';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// The app's Supabase URL/anon key are hardcoded (lib/supabase.ts), so a
// local dev/test build talks to the exact same live project production
// does — there's no separate "test" backend. Skipping real pings from
// localhost specifically (never true for real visitors, always true for
// `next dev`/local test builds) keeps development/testing activity from
// quietly polluting real usage counts, which happened once already.
function isLocalDev(): boolean {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

// Records at most one row per device per calendar day (checked locally
// first to avoid a network round-trip on every single page load — the
// unique (device_id, ping_date) constraint plus ON CONFLICT DO NOTHING is
// the real source of truth if two tabs race). Best-effort and silent:
// this is a usage counter, never something a learner should notice fail.
export async function recordUsagePing(): Promise<void> {
  if (typeof window === 'undefined' || isLocalDev()) return;
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(LAST_PING_KEY) === today) return;

  try {
    const deviceId = getOrCreateDeviceId();
    const { data: { session } } = await supabase.auth.getSession();
    // Plain insert, not upsert — under RLS, an upsert's ON CONFLICT clause
    // (even DO NOTHING) additionally requires SELECT privilege to check
    // for a conflict, which this table deliberately doesn't grant (see the
    // migration). A same-day duplicate (another tab on this device racing
    // this one) just trips the unique constraint (23505), which is exactly
    // as harmless as the row it would have no-op'd into — silently ignored
    // either way.
    const { error } = await supabase.from('usage_pings').insert({
      device_id: deviceId,
      user_id: session?.user.id ?? null,
      signed_in: !!session,
      level: getSettings().level,
      user_agent: navigator.userAgent,
      ping_date: today,
    });
    if (error && error.code !== '23505') throw error;
    localStorage.setItem(LAST_PING_KEY, today);
  } catch {
    // Best-effort — network hiccups, RLS surprises, etc. never surface.
  }
}
