import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yingyingcui.spello',
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
    // Edge to edge: the WebView fills the whole screen, under the status
    // bar and home indicator, and the page itself keeps content clear of
    // them with env(safe-area-inset-*) padding (layout.tsx's main/NavBar,
    // with viewport-fit=cover). This replaced 'automatic', which kept the
    // status-bar strip OUTSIDE the page — a separate black (or white, once
    // scrolled) band instead of the app's own background. Verified in the
    // iOS simulator that env(safe-area-inset-top) is reported correctly
    // with 'never' (it was 'automatic' that zeroed it, by already
    // insetting the content itself).
    contentInset: 'never',
    // Shown for the instant before the page paints (Forest's top color).
    backgroundColor: '#0f3d3a',
  },
  plugins: {
    // The page sets light/dark status-bar text per theme (AppBackground).
    StatusBar: { overlaysWebView: true, style: 'DARK' },
  },
};

export default config;
