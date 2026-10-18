'use client';

import { useEffect } from 'react';
import { startReminderWatcher } from '../lib/reminders';

// Mounted once in the root layout — keeps this phone's study reminders
// (lib/reminders.ts) up to date. Does nothing on the web or in an iOS
// build without the notifications plugin.
export default function ReminderEffect() {
  useEffect(() => startReminderWatcher(), []);
  return null;
}
