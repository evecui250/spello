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
  // from.
  level?: string;
}

// Every congrats-card background shares this exact layout (verified by
// rendering each at IMG_SIZE and overlaying these same box coordinates —
// they all land correctly, since every image was produced against the
// same reference composition): a rounded panel with two icon+label
// columns, the same relative position/size in every variant, and open
// sky top-right for the date stamp. That's what lets one shared set of
// box coordinates work across the whole rotation instead of needing
// per-image tuning.
const IMG_SIZE = 1254;
const NEW_WORDS_BOX = { x0: 410, x1: 467, y0: 487, y1: 533 };
const REVIEWED_BOX = { x0: 780, x1: 838, y0: 487, y1: 533 };

interface CardVariant {
  src: string;
  // Only the original dog card has a baked-in "N"/"M" placeholder glyph
  // to hide before drawing the real count (see drawCount) — every newer
  // variant already ships with that slot left blank, so the count draws
  // straight onto the real background with nothing to cover, which is
  // also what sidesteps the cream-color-mismatch a hardcoded single cover
  // color used to risk once there was more than one background.
  coverColor?: string;
  // Date/level stamp color, matched to what's actually behind it in each
  // image's top-right corner (a pale cream sky reads fine with a soft
  // warm brown; several of the newer scenes have a saturated blue-sky or
  // green-bamboo corner instead, which needs a darker, more opaque tone
  // to stay legible — see the card-preview check this was tuned against).
  dateColor: string;
}

// Dark, high-opacity warm brown — reads clearly against every corner in
// the current set, from the original's pale cream through the blue-sky
// and bamboo-green variants, rather than needing a bespoke color per
// image. Kept as each variant's default; only overridden where a real
// render check shows it still isn't enough.
const DEFAULT_DATE_COLOR = 'rgba(45, 28, 12, 0.85)';

// One entry per background in the daily rotation — see pickVariant for
// how "today's" card is chosen. Adding a new congrats_*.png later is
// just adding a row here, since the shared box coordinates above already
// fit the common layout.
const CARD_VARIANTS: CardVariant[] = [
  { src: 'congrats.png', coverColor: '#fbf7ee', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_cat_new.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_fox.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_fox_stand.png', dateColor: DEFAULT_DATE_COLOR },
  // panda_wrist replaces the original panda card outright (same bamboo
  // scene, the mascot just wears the watch on its wrist instead).
  { src: 'congrats_panda_wrist.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_rabbit.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_elephant.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_hedgehog.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_koala.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_otter.png', dateColor: DEFAULT_DATE_COLOR },
  // Night scene (dark navy sky) — still DEFAULT_DATE_COLOR, not a bespoke
  // light color: the shadowColor glow drawn behind the date text below
  // (a soft white halo) is exactly what already handles a dark/busy
  // corner like this one, same as it does for the bamboo-leaf panda scene.
  { src: 'congrats_owl.png', dateColor: DEFAULT_DATE_COLOR },
  { src: 'congrats_penguin.png', dateColor: DEFAULT_DATE_COLOR },
];

// Deterministic, not Math.random() — keyed off the calendar date so
// reopening the SAME day's card (see Progress's daily history) always
// shows the same background instead of reshuffling on every open, while
// different days land on different (effectively random-looking) cards.
function pickVariant(dateStr: string): CardVariant {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  return CARD_VARIANTS[hash % CARD_VARIANTS.length];
}

function drawCount(ctx: CanvasRenderingContext2D, box: typeof NEW_WORDS_BOX, value: number, color: string, coverColor: string | undefined) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.y1 - box.y0;

  // Blank out the placeholder glyph first, only if this variant has one
  // to hide at all (see CardVariant.coverColor) — a real count can be a
  // different width (e.g. "12" vs the single placeholder letter), so the
  // old glyph can't be allowed to show through around the edges of the
  // new one.
  if (coverColor) {
    ctx.fillStyle = coverColor;
    ctx.fillRect(box.x0 - 40, box.y0 - 10, boxWidth + 80, boxHeight + 20);
  }

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
  const dateKey = date ?? new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = IMG_SIZE;
    canvas.height = IMG_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    const variant = pickVariant(dateKey);

    const draw = (bg: HTMLImageElement) => {
      if (cancelled) return;

      ctx.drawImage(bg, 0, 0, IMG_SIZE, IMG_SIZE);
      drawCount(ctx, NEW_WORDS_BOX, studiedCount, '#603096', variant.coverColor);
      drawCount(ctx, REVIEWED_BOX, reviewedCount, '#066354', variant.coverColor);

      // Small date stamp in the open sky space top-right, so a saved/
      // shared image is still self-explanatory (and a reopened past day
      // doesn't look like it's claiming to be today).
      const dateStr = new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      });
      // A soft light shadow (rather than tuning the fill color per
      // background) is what actually keeps this legible across every
      // variant — the corner behind it ranges from plain pale sky to a
      // busy, dark bamboo-leaf texture (see the panda card), and no single
      // flat text color reads equally well against all of them. A blurred
      // light halo lifts dark text off anything busy/dark underneath it
      // while staying invisible against the already-light corners.
      ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = variant.dateColor;
      ctx.font = '600 26px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(dateStr, IMG_SIZE - 70, 90);

      // Which vocabulary book this session was on, e.g. "German B1" — a
      // second, slightly smaller line right under the date.
      if (level) {
        ctx.font = '600 20px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${language} ${level}`, IMG_SIZE - 70, 118);
      }
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      canvas.toBlob(blob => {
        if (blob && !cancelled) setImgUrl(URL.createObjectURL(blob));
      });
    };

    const bg = new window.Image();
    bg.onload = () => draw(bg);
    bg.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${variant.src}`;

    return () => { cancelled = true; };
  }, [studiedCount, reviewedCount, language, dateKey, level]);

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
