'use client';

import { useEffect, useState } from 'react';
import {
  getReminderSettings, saveReminderSettings, rescheduleReminders, requestReminderPermission,
  remindersSupported, isNativeApp, ReminderSettings, REMINDER_DAY_OPTIONS,
} from '../lib/reminders';

const pad = (n: number) => String(n).padStart(2, '0');

// Profile → Notifications. Reminders are local notifications on the
// phone (see lib/reminders.ts), so this only does anything inside the iOS
// app — the web version, and an older TestFlight build without the
// plugin, get a short explanation instead of controls that can't work.
export default function ReminderSettingsPanel() {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [denied, setDenied] = useState(false);
  const supported = remindersSupported();

  useEffect(() => setSettings(getReminderSettings()), []);

  const update = async (next: ReminderSettings) => {
    if (next.enabled && !settings?.enabled) {
      const granted = await requestReminderPermission();
      setDenied(!granted);
      if (!granted) next = { ...next, enabled: false };
    }
    setSettings(next);
    saveReminderSettings(next);
    await rescheduleReminders();
  };

  if (!supported) {
    return (
      <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-2">
        <span className="font-semibold text-ink">Study reminders</span>
        <p className="text-ink-soft text-sm">
          {isNativeApp()
            ? 'Update Spello to the latest version from TestFlight to turn on study reminders.'
            : 'Study reminders work in the Spello iPhone app.'}
        </p>
      </div>
    );
  }
  if (!settings) return null;

  return (
    <div className="bg-paper/75 backdrop-blur-sm rounded-2xl border border-paper-line/50 shadow-sm p-6 flex flex-col gap-6">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <div>
          <div className="font-semibold text-ink">Daily reminder</div>
          <p className="text-ink-soft text-sm">A nudge if you haven&apos;t started learning or reviewing yet that day.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          onClick={() => update({ ...settings, enabled: !settings.enabled })}
          className={`relative inline-block w-11 h-6 rounded-full transition-colors shrink-0 ${settings.enabled ? 'bg-accent' : 'bg-paper-dim'}`}
        >
          <span
            className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
            style={{ transform: settings.enabled ? 'translateX(1.25rem)' : 'translateX(0)' }}
          />
        </button>
      </label>

      {denied && (
        <p className="text-clay text-sm -mt-3">
          Notifications are turned off for Spello. Turn them on in your iPhone&apos;s Settings → Notifications → Spello, then try again.
        </p>
      )}

      <div className={`flex flex-col gap-6 transition-opacity ${settings.enabled ? '' : 'opacity-40 pointer-events-none'}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-ink">Remind me at</span>
          <input
            type="time"
            value={`${pad(settings.hour)}:${pad(settings.minute)}`}
            onChange={e => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (Number.isFinite(h) && Number.isFinite(m)) update({ ...settings, hour: h, minute: m });
            }}
            className="border-2 border-accent/70 rounded-lg px-3 py-1.5 text-ink bg-paper focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <span className="block font-semibold text-ink mb-1">Stop after</span>
          <div className="flex bg-paper-dim/60 rounded-full p-0.5">
            {REMINDER_DAY_OPTIONS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => update({ ...settings, days: d })}
                className={`flex-1 py-1.5 rounded-full text-sm font-semibold transition-colors ${settings.days === d ? 'bg-paper text-ink shadow-sm' : 'text-ink-soft'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-ink-soft text-sm mt-1">
            days without studying. Reminders start again as soon as you study.
          </p>
        </div>
      </div>
    </div>
  );
}
