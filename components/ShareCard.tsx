'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';

// A small button (styled to match Settings' "View welcome guide" link,
// meant to sit right next to it) that opens a modal with everything
// needed to invite a friend, rather than a permanently-visible card —
// this is an occasional action, not something that needs its own real
// estate on every visit to Settings:
//   - A native Share button (Web Share API) on any browser that supports
//     it — opens the OS share sheet (Messages, WhatsApp, etc.) with the
//     app's own URL pre-filled. Falls back to copying the link to the
//     clipboard where Web Share isn't available (most desktop browsers).
//   - A QR code, generated entirely on-device (the `qrcode` package, no
//     network call — matters here specifically since this is a PWA meant
//     to work offline, and because a third-party QR-generation API would
//     mean sending this app's own URL to an outside service for no real
//     reason) for someone to scan in person.
//   - A real one-tap Install button on Android/Chrome, captured from the
//     browser's own beforeinstallprompt event — only ever appears when
//     the browser is actually offering to install.
//   - Static instructions for iOS Safari, which Apple deliberately does
//     not allow triggering programmatically (no install-prompt API
//     exists there) — shown only when actually on iOS and not already
//     running standalone.
export default function ShareCard() {
  const [open, setOpen] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<{ prompt: () => void; userChoice: Promise<{ outcome: string }> } | null>(null);
  const [isIosSafariNotStandalone, setIsIosSafariNotStandalone] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setShareSupported(typeof navigator !== 'undefined' && !!navigator.share);

    const url = window.location.origin + (process.env.NEXT_PUBLIC_BASE_PATH ?? '') + '/';
    QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#1e1b4b', light: '#00000000' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));

    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIosSafariNotStandalone(isIos && !standalone);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as unknown as { prompt: () => void; userChoice: Promise<{ outcome: string }> });
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    const onInstalled = () => setDeferredPrompt(null);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const shareUrl = typeof window !== 'undefined' ? window.location.origin + (process.env.NEXT_PUBLIC_BASE_PATH ?? '') + '/' : '';

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Spello', text: 'Learn German vocabulary with Spello', url: shareUrl });
      } catch {
        // User cancelled the share sheet — not an error worth surfacing.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — nothing more this
      // button can do; silently no-op rather than throw.
    }
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-center bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-4 font-semibold text-stone-700 hover:bg-amber-50 transition-colors"
      >
        Share Spello
      </button>

      {/* Portaled to body — same reasoning as BugReportButton's modal: an
          ancestor with backdrop-filter/transform/etc. would otherwise
          become this fixed overlay's containing block and clip it. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-amber-50 rounded-2xl shadow-xl p-5 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-stone-800">Share Spello</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-stone-400 hover:text-stone-600 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <p className="text-stone-500 text-sm">Studying together helps it stick — send a friend the link.</p>

            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleShare}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-indigo-700 active:scale-95 transition-all"
              >
                {shareSupported ? 'Share' : copied ? '✓ Link copied' : 'Copy link'}
              </button>
              {deferredPrompt && (
                <button
                  type="button"
                  onClick={handleInstall}
                  className="bg-amber-100 text-amber-800 px-4 py-2 rounded-xl font-semibold text-sm hover:bg-amber-200 active:scale-95 transition-all"
                >
                  Install app
                </button>
              )}
            </div>

            {isIosSafariNotStandalone && (
              <p className="text-stone-500 text-sm bg-indigo-50 rounded-lg px-3 py-2">
                On iPhone/iPad: tap the Share icon (□↑) in Safari, then &quot;Add to Home Screen&quot; — it&apos;ll open full-screen like an app from then on.
              </p>
            )}

            {qrDataUrl && (
              <div className="flex flex-col items-center gap-1.5 pt-1">
                <p className="text-stone-400 text-xs">Or have a friend scan this</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- on-device generated data: URI, no remote source to optimize */}
                <img src={qrDataUrl} alt="QR code linking to Spello" className="w-40 h-40 rounded-lg" />
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
