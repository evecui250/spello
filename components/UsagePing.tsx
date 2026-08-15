'use client';

import { useEffect } from 'react';
import { recordUsagePing } from '../lib/telemetry';

// Mounted once in the root layout — records today's usage_pings row (see
// lib/telemetry.ts) the first time the app loads each day, regardless of
// sign-in state. Purely a side effect; renders nothing.
export default function UsagePing() {
  useEffect(() => {
    recordUsagePing();
  }, []);
  return null;
}
