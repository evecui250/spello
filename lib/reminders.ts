'use client';

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { today, PROGRESS_CHANGED_EVENT } from './storage';

// Daily study reminders — iOS app only, scheduled on the phone itself as
// local notifications (no server, no push setup, works offline). Every
// time the app opens or the learner does anything, the next few days'
// reminders are rebuilt from scratch:
//   - one reminder per day at the chosen time,
//   - none for a day the learner has already started (any word progress or
//     daily-session write counts — see PROGRESS_CHANGED_EVENT),
//   - only for the first `days` days after the last day they studied, so a
//     learner who has drifted away isn't nagged forever.
// Settings are per-device (a reminder belongs to this phone), not synced
// and not level-namespaced, same as Theme/FontScale.

export interface ReminderSettings {
  enabled: boolean;
  hour: number;   // 0-23, local time
  minute: number; // 0-59
  days: number;   // stop after this many days without studying
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { enabled: false, hour: 19, minute: 0, days: 3 };
export const REMINDER_DAY_OPTIONS = [1, 2, 3, 5, 7];

const SETTINGS_KEY = 'wb2_reminder_settings';
// Local date (YYYY-MM-DD) of the last day the learner started studying.
const LAST_ACTIVE_KEY = 'wb2_reminder_last_active';
// Reminder notification ids live in this block so a reschedule can cancel
// exactly its own (and never anything else's).
const ID_BASE = 7100;
const MAX_DAYS = 7;

const MESSAGES = [
  'Your pet is waiting for today\'s German words 🐾',
  'A few minutes of German today? Your streak will thank you.',
  'Time for today\'s words — it only takes a few minutes.',
];

// True only inside an iOS build that actually contains the plugin. The web
// app is live for everyone the moment it deploys, including people still
// on an older TestFlight build without it — calling the plugin there would
// just throw, so callers check this first (and Settings says "update the
// app" instead of showing a switch that can't work).
export function remindersSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications');
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

export function getReminderSettings(): ReminderSettings {
  if (typeof window === 'undefined') return DEFAULT_REMINDER_SETTINGS;
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return raw && typeof raw === 'object' ? { ...DEFAULT_REMINDER_SETTINGS, ...raw } : DEFAULT_REMINDER_SETTINGS;
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export function saveReminderSettings(s: ReminderSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* best effort */ }
}

function getLastActive(): string | null {
  try { return localStorage.getItem(LAST_ACTIVE_KEY); } catch { return null; }
}

function markActiveToday(): void {
  try { localStorage.setItem(LAST_ACTIVE_KEY, today()); } catch { /* best effort */ }
}

// Asks iOS for permission if it hasn't been decided yet. Returns whether
// notifications are allowed.
export async function requestReminderPermission(): Promise<boolean> {
  if (!remindersSupported()) return false;
  try {
    let { display } = await LocalNotifications.checkPermissions();
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      ({ display } = await LocalNotifications.requestPermissions());
    }
    return display === 'granted';
  } catch {
    return false;
  }
}

function localDate(dateStr: string, hour: number, minute: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

// Cancels every reminder this app scheduled, then schedules the ones the
// current settings and activity call for. Safe to call as often as needed.
export async function rescheduleReminders(): Promise<void> {
  if (!remindersSupported()) return;
  try {
    const ids = Array.from({ length: MAX_DAYS + 1 }, (_, i) => ({ id: ID_BASE + i }));
    await LocalNotifications.cancel({ notifications: ids });

    const s = getReminderSettings();
    if (!s.enabled) return;
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== 'granted') return;

    const t = today();
    // Never studied on this device yet: count from today, so a new
    // learner still gets `days` reminders.
    const lastActive = getLastActive() ?? addDays(t, -1);
    const now = Date.now();
    const days = Math.min(Math.max(1, s.days), MAX_DAYS);
    const notifications = [];
    for (let i = 1; i <= days; i++) {
      const day = addDays(lastActive, i);
      if (day < t) continue;               // window already partly passed
      if (day === lastActive) continue;    // studied that day
      const at = localDate(day, s.hour, s.minute);
      if (at.getTime() <= now + 60_000) continue; // time already passed today
      notifications.push({
        id: ID_BASE + i,
        title: 'Spello',
        body: MESSAGES[(i - 1) % MESSAGES.length],
        schedule: { at, allowWhileIdle: true },
      });
    }
    if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
  } catch {
    // Best effort — a reminder failing must never affect the app itself.
  }
}

// Mounted once for the whole app (see ReminderEffect): reschedules on
// launch, whenever the app comes back to the foreground, and the moment
// the learner starts studying (which also cancels today's reminder).
export function startReminderWatcher(): () => void {
  if (!remindersSupported()) return () => {};
  const onProgress = () => {
    if (getLastActive() === today()) return;
    markActiveToday();
    void rescheduleReminders();
  };
  const onVisible = () => { if (document.visibilityState === 'visible') void rescheduleReminders(); };
  window.addEventListener(PROGRESS_CHANGED_EVENT, onProgress);
  document.addEventListener('visibilitychange', onVisible);
  void rescheduleReminders();
  return () => {
    window.removeEventListener(PROGRESS_CHANGED_EVENT, onProgress);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
