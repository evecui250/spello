'use client';

import { useEffect } from 'react';
import { getFontScale, FontScale, FONT_SCALE_CHANGED_EVENT } from '../lib/storage';

// Small/Large read as -10%/+15% off the browser default (16px) — modest
// enough that fixed-ish layouts (letter tiles, matching-quiz rows) still
// hold together, per real-device Playwright checks against those two
// screens specifically, but a real, noticeable difference for anyone who
// asked for bigger text.
const FONT_SCALE_PERCENT: Record<FontScale, string> = {
  small: '90%',
  default: '100%',
  large: '115%',
};

// Mounted once in the root layout, same pattern as SpeechCleanup/
// AppBackground's own THEME_CHANGED_EVENT listener — sets the root
// <html> font-size directly (not React state/props) since nearly every
// bit of text in the app already renders through Tailwind's rem-based
// text-* utilities, so this one line scales the whole app at once.
export default function FontScaleEffect() {
  useEffect(() => {
    const apply = () => {
      document.documentElement.style.fontSize = FONT_SCALE_PERCENT[getFontScale()];
    };
    apply();
    window.addEventListener(FONT_SCALE_CHANGED_EVENT, apply);
    return () => window.removeEventListener(FONT_SCALE_CHANGED_EVENT, apply);
  }, []);
  return null;
}
