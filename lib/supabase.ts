'use client';

import { createClient } from '@supabase/supabase-js';

// This is the publishable (anon) key — Supabase's client-side key, safe to
// ship in the browser bundle. Access is enforced entirely by Row Level
// Security policies on the database, not by keeping this key secret.
const SUPABASE_URL = 'https://whjiebzglefivvczvpfb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Ebu1ILGhZKQ6XMiNcHsuwA_ny_A7z5s';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
