'use client';

import { useEffect, useState } from 'react';

interface Props {
  studiedCount: number;
  reviewedCount: number;
  language: string;
  onClose: () => void;
  // Which day this card is for — defaults to today. Reopening a past day's
  // card (see Progress's daily history) passes that day's date instead, so
  // the stamp in the corner matches the counts being shown.
  date?: string;
  // Which vocabulary book this session was on, e.g. "B1" — shown under the
  // date stamp as "German B1" so a saved/shared card says which book it's
  // from. 'B2_old' displays as plain "B2" — that suffix is internal only.
  level?: string;
}

// public/congrats.png is the shareable card's background art (1254x1254,
// "v2" as of 2026-07 — a different illustration than the original) —
// hand-designed with placeholder "N"/"M" glyphs marking where the actual
// new-words/reviewed counts get overlaid at render time. These are that
// glyph's exact pixel bounds (measured directly off the PNG, zoomed in
// pixel-by-pixel — a same-color tolerance match alone isn't reliable here,
// since both the icon above and the "new words"/"words" label below sit
// close enough in color and position to bleed into a looser match). The
// cover rectangle's padding must land in the gap on each side: below the
// icon circle (bottom edge ≈460) and above the label text (top edge ≈558)
// — eating into either one leaves a stray fragment of it behind.
const IMG_SIZE = 1254;
const NEW_WORDS_BOX = { x0: 410, x1: 467, y0: 487, y1: 533 };
const REVIEWED_BOX = { x0: 780, x1: 838, y0: 487, y1: 533 };
const CARD_BG = '#fbf7ee';

function drawCount(ctx: CanvasRenderingContext2D, box: typeof NEW_WORDS_BOX, value: number, color: string) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.y1 - box.y0;

  // Blank out the placeholder glyph first — a real count can be a different
  // width (e.g. "12" vs the single placeholder letter), so the old glyph
  // can't be allowed to show through around the edges of the new one.
  ctx.fillStyle = CARD_BG;
  ctx.fillRect(box.x0 - 40, box.y0 - 10, boxWidth + 80, boxHeight + 20);

  // Shrink the font for multi-digit counts so they still fit the same box
  // the single placeholder glyph was drawn in.
  const digits = String(value).length;
  const fontSize = digits <= 2 ? boxHeight * 1.5 : boxHeight * 1.5 * (2.4 / (digits + 0.4));
  ctx.fillStyle = color;
  ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Nudge down slightly — cap-height fonts optically sit a bit high of true
  // vertical center.
  ctx.fillText(String(value), cx, cy + fontSize * 0.06);
}

export default function CongratsModal({ studiedCount, reviewedCount, language, onClose, date, level }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = IMG_SIZE;
    canvas.height = IMG_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const draw = (bg: HTMLImageElement) => {
      if (cancelled) return;

      ctx.drawImage(bg, 0, 0, IMG_SIZE, IMG_SIZE);
      drawCount(ctx, NEW_WORDS_BOX, studiedCount, '#603096');
      drawCount(ctx, REVIEWED_BOX, reviewedCount, '#066354');

      // Small date stamp in the open cream space top-right, so a saved/
      // shared image is still self-explanatory (and a reopened past day
      // doesn't look like it's claiming to be today).
      const dateStr = new Date(`${date ?? new Date().toISOString().slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      });
      ctx.fillStyle = 'rgba(120, 90, 40, 0.55)';
      ctx.font = '600 26px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(dateStr, IMG_SIZE - 70, 90);

      // Which vocabulary book this session was on, e.g. "German B1" — a
      // second, slightly smaller line right under the date. 'B2_old' shows
      // as plain "B2"; that suffix is an internal detail only.
      if (level) {
        const levelLabel = level === 'B2_old' ? 'B2' : level;
        ctx.font = '600 20px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${language} ${levelLabel}`, IMG_SIZE - 70, 118);
      }

      canvas.toBlob(blob => {
        if (blob && !cancelled) setImgUrl(URL.createObjectURL(blob));
      });
    };

    const bg = new window.Image();
    bg.onload = () => draw(bg);
    bg.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/congrats.png`;

    return () => { cancelled = true; };
  }, [studiedCount, reviewedCount, language, date, level]);

  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);

  // A plain <a download> just drops a .png into Files/Downloads — on
  // mobile there's no web API to place an image directly into the Photos
  // album, so the only way to reach that is the OS's own share sheet
  // (which offers "Save Image"/"Save to Photos" as one of its options
  // once a file is attached). Both buttons below route through this same
  // share-first attempt; the raw download is only a fallback for browsers
  // without Web Share (mainly desktop, where "download the file" already
  // is the right, expected behavior — no Photos app to save into there).
  const shareOrDownload = async (opts?: { title: string; text: string }) => {
    if (!imgUrl) return;
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      const file = new File([blob], `spello-${date ?? new Date().toISOString().slice(0, 10)}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], ...opts });
        return;
      }
    } catch {
      // User cancelled the share sheet, or Web Share isn't usable here —
      // either way, fall through to a plain download.
    }
    const a = document.createElement('a');
    a.href = imgUrl;
    a.download = `spello-${date ?? new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  };

  // "Save image" omits title/text — a bare file share surfaces "Save
  // Image"/"Save to Photos" as a prominent option without also implying
  // this is meant to be sent to someone.
  const handleSave = () => shareOrDownload();
  const handleShare = () => shareOrDownload({ title: 'Spello', text: `I learned ${studiedCount} ${language} words today!` });

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
