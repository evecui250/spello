'use client';

import { useEffect } from 'react';
import { watchAuthAndSync, watchForUnloadFlush } from '../lib/sync';

// Mounted once in the root layout so a signed-in user's remote progress
// gets pulled in on every page load, not just when they happen to visit
// Settings (the only place that used to trigger it). Also flushes any
// still-pending debounced push the moment the page is hidden/closed, so
// closing the app right after finishing a session doesn't silently drop it.
export default function SyncGate() {
  useEffect(() => watchAuthAndSync(), []);
  useEffect(() => watchForUnloadFlush(), []);
  return null;
}
