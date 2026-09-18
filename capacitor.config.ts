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
  // Deliberately NOT setting ios.contentInset here -- checked first: the
  // site's own CSS only reserves safe-area space at the BOTTOM (NavBar's
  // env(safe-area-inset-bottom)), nothing at the top, and the page's
  // <meta viewport> has no viewport-fit=cover, so those env() values
  // actually resolve to 0 in a plain browser today (Safari's own chrome
  // covers the notch/home-indicator instead). Forcing contentInset:
  // 'never' here would make the WebView draw truly edge-to-edge with
  // nothing compensating for it, likely drawing under the status bar and
  // butting the bottom nav against the home indicator. Leaving this
  // unset keeps Capacitor's default (the native container reserves safe-
  // area space itself), which is the safe choice until the web app is
  // deliberately given full viewport-fit=cover + top-and-bottom inset
  // CSS to match.
};

export default config;
