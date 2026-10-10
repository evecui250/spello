'use client';

import { useEffect } from 'react';

// While a text field has focus (the on-screen keyboard is up), the fixed
// bottom bars — the study progress strip and the tab bar — are hidden
// (see globals.css's html.keyboard-open rule). On a phone they otherwise
// sit right above the keyboard and cover the card being typed into (a
// real report). They come back as soon as the field loses focus.
const TYPING_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]), textarea, [contenteditable="true"]';

export default function KeyboardBarsEffect() {
  useEffect(() => {
    const root = document.documentElement;
    // A field can have focus with no keyboard showing (iOS ignores the
    // automatic focus a study card gives its spelling field until the
    // learner taps), so also require the visible area to have actually
    // shrunk for a keyboard.
    const vv = window.visualViewport;
    const update = () => {
      const el = document.activeElement;
      const typing = !!el && el instanceof HTMLElement && el.matches(TYPING_FIELD);
      const keyboardUp = !!vv && window.innerHeight - vv.height > 120;
      root.classList.toggle('keyboard-open', typing && keyboardUp);
    };
    vv?.addEventListener('resize', update);
    // focusout fires before the next field's focusin — re-check a tick
    // later so moving between fields doesn't flash the bars back in.
    const onFocusOut = () => setTimeout(update, 50);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
      vv?.removeEventListener('resize', update);
      root.classList.remove('keyboard-open');
    };
  }, []);
  return null;
}
