import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.spello.app',
  appName: 'Spello',
  // webDir is required by the CLI (used for `cap sync`'s local-asset
  // copy step) but is otherwise unused at runtime here -- server.url
  // below makes the native shell load the live GitHub Pages site
  // directly, the same page every other user already gets, rather than
  // bundling a frozen local snapshot. That's a deliberate choice, not a
  // placeholder: it means a web deploy updates what TestFlight testers
  // see immediately, with no new native build/upload needed, matching
  // how often this app ships changes -- a new TestFlight build is only
  // needed for changes to the native shell itself (icon, permissions,
  // this config), not for ordinary app changes.
  server: {
    url: 'https://evecui250.github.io/spello/',
    cleartext: false,
  },
  ios: {
    // Real bug caught in the first simulator smoke test: Capacitor's own
    // default here is 'never' (not 'automatic' -- easy to assume
    // otherwise, since 'never' sounds like the more permissive/edge-to-
    // edge option), which sets the WebView's UIScrollView
    // contentInsetAdjustmentBehavior to .never. That doesn't just skip
    // native inset adjustment -- it's also what left env(safe-area-inset-
    // top/bottom) resolving to 0 in this app's own CSS (see layout.tsx's
    // viewport-fit=cover + padding, added the same time as this), so the
    // page's header rendered right under the status bar/Dynamic Island
    // with nothing pushing it clear. 'automatic' is the standard UIKit
    // answer for exactly this "let the system reserve safe-area space,
    // and report it correctly to the page" case.
    contentInset: 'automatic',
  },
};

export default config;
