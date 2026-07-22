'use client';

import { useEffect } from 'react';
import { watchAuthAndSync } from '../lib/sync';

// Mounted once in the root layout so a signed-in user's remote progress
// gets pulled in on every page load, not just when they happen to visit
// Settings (the only place that used to trigger it).
export default function SyncGate() {
  useEffect(() => watchAuthAndSync(), []);
  return null;
}
