'use client';

import { useEffect, useState } from 'react';

interface Props {
  studiedCount: number;
  reviewedCount: number;
  language: string;
  onClose: () => void;
  // Shown as a caption below the shareable image — this modal covers the
  // session summary underneath it, so the dachshund tally has to live here too.
  earnedText?: string;
}

// Draws a rounded rectangle path (used instead of ctx.roundRect for wider
// browser support, since this runs inside an offscreen canvas).
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function CongratsModal({ studiedCount, reviewedCount, language, onClose, earnedText }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    const size = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const draw = (logo: HTMLImageElement | null) => {
      if (cancelled) return;

      const bg = ctx.createLinearGradient(0, 0, size, size);
      bg.addColorStop(0, '#6366f1');
      bg.addColorStop(1, '#a855f7');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.arc(size * 0.86, size * 0.14, 190, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(size * 0.08, size * 0.92, 150, 0, Math.PI * 2); ctx.fill();

      const pad = 64;
      ctx.fillStyle = 'rgba(255,255,255,0.97)';
      roundRect(ctx, pad, pad, size - pad * 2, size - pad * 2, 48);
      ctx.fill();

      ctx.textAlign = 'center';
      const cx = size / 2;
      let y = pad + 60;

      if (logo && logo.naturalWidth && logo.naturalHeight) {
        // The logo already has the "Spello" wordmark baked in, so it's
        // drawn large on its own — no separate text label needed.
        const logoHeight = 320;
        const logoWidth = logoHeight * (logo.naturalWidth / logo.naturalHeight);
        ctx.drawImage(logo, cx - logoWidth / 2, y, logoWidth, logoHeight);
        y += logoHeight + 40;
      } else {
        y += 40;
      }

      ctx.fillStyle = '#1e1b4b';
      ctx.font = '700 56px system-ui, -apple-system, sans-serif';
      ctx.fillText('🎉 Daily goal complete!', cx, y + 50);
      y += 130;

      // Two stat columns: words studied and words reviewed.
      const colOffset = 230;
      ctx.fillStyle = '#4f46e5';
      ctx.font = '800 120px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${studiedCount}`, cx - colOffset, y + 120);
      ctx.fillText(`${reviewedCount}`, cx + colOffset, y + 120);

      ctx.fillStyle = '#334155';
      ctx.font = '500 34px system-ui, -apple-system, sans-serif';
      ctx.fillText('learned', cx - colOffset, y + 170);
      ctx.fillText('reviewed', cx + colOffset, y + 170);

      ctx.strokeStyle = '#e0e7ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, y + 20);
      ctx.lineTo(cx, y + 150);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.font = '500 36px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${language} words today`, cx, y + 250);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '400 30px system-ui, -apple-system, sans-serif';
      const dateStr = new Date().toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      ctx.fillText(dateStr, cx, size - pad - 50);

      canvas.toBlob(blob => {
        if (blob && !cancelled) setImgUrl(URL.createObjectURL(blob));
      });
    };

    const logo = new window.Image();
    logo.onload = () => draw(logo);
    logo.onerror = () => draw(null);
    logo.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/logo.png`;

    return () => { cancelled = true; };
  }, [studiedCount, reviewedCount, language]);

  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);

  const handleSave = () => {
    if (!imgUrl) return;
    const a = document.createElement('a');
    a.href = imgUrl;
    a.download = `spello-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };

  const handleShare = async () => {
    if (!imgUrl) return;
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      const file = new File([blob], 'spello.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: 'Spello', text: `I learned ${studiedCount} ${language} words today!` });
        return;
      }
    } catch {
      // Fall through to a plain download.
    }
    handleSave();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-amber-50 rounded-2xl p-5 max-w-sm w-full flex flex-col gap-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="rounded-xl overflow-hidden border border-indigo-100 bg-indigo-50 aspect-square flex items-center justify-center">
          {imgUrl ? (
            // The image is generated locally on-device (canvas → blob URL),
            // so a plain <img> is fine here — no remote source to optimize.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt="Daily goal complete" className="w-full h-full object-contain" />
          ) : (
            <span className="text-indigo-300 text-sm">Preparing image…</span>
          )}
        </div>
        {earnedText && (
          <p className="-mt-1 text-center text-sm font-semibold text-amber-700 bg-amber-100 rounded-full px-3 py-1.5">
            {earnedText}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleShare}
            disabled={!imgUrl}
            className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-40"
          >
            Share
          </button>
          <button
            onClick={handleSave}
            disabled={!imgUrl}
            className="flex-1 bg-indigo-50 text-indigo-700 py-3 rounded-xl font-semibold hover:bg-indigo-100 active:scale-95 transition-all disabled:opacity-40"
          >
            Save image
          </button>
        </div>
        <button onClick={onClose} className="text-center text-slate-400 text-sm hover:text-slate-600 transition-colors">
          Close
        </button>
      </div>
    </div>
  );
}
