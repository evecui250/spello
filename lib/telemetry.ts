'use client';

import { supabase } from './supabase';
import { getSettings, isOnboardingDone } from './storage';

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
// unique (device_id, ping_date) constraint is the real source of truth if
// two tabs race). Routed through the record-usage-ping Edge Function
// rather than a direct table insert — that's the only way to honestly
// capture ip_address, since client JS has no reliable way to read its own
// public IP and only the server actually observes the true request IP
// (see privacy/page.tsx for the user-facing disclosure of this). Best-
// effort and silent either way: this is a usage counter, never something
// a learner should notice fail.
export async function recordUsagePing(): Promise<void> {
  if (typeof window === 'undefined' || isLocalDev()) return;
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(LAST_PING_KEY) === today) return;

  try {
    const deviceId = getOrCreateDeviceId();
    const { data: { session } } = await supabase.auth.getSession();
    // Only report a level once onboarding has actually saved one --
    // getSettings().level otherwise silently falls back to
    // DEFAULT_SETTINGS.level ('A1'), which used to make every brand-new
    // visitor's very first ping (fired on first mount, before they've
    // picked anything) show up as an A1 learner regardless of which level
    // they went on to choose seconds later -- and since a ping only fires
    // once per calendar day, that mislabeled first ping was never
    // corrected same-day. `null` here means "hasn't chosen a level yet",
    // not "chose A1".
    const { error } = await supabase.functions.invoke('record-usage-ping', {
      body: {
        deviceId,
        level: isOnboardingDone() ? getSettings().level : null,
        userAgent: navigator.userAgent,
        pingDate: today,
      },
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    });
    if (error) throw error;
    localStorage.setItem(LAST_PING_KEY, today);
  } catch {
    // Best-effort — network hiccups, function cold-start errors, etc.
    // never surface.
  }
}
