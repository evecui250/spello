'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The notebook moved into the Words page's "Mistakes" tab (see
// components/MistakesView.tsx) — old links and bookmarks land there.
export default function MistakesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/words/?view=mistakes'); }, [router]);
  return null;
}
