'use client';

import { useEffect, useState } from 'react';

// public/days_counter.png (1254x1254) is a mascot badge with a placeholder
// "7" carved into the stone plaque. These are that glyph's pixel bounds
// (measured directly off the PNG via a zoomed grid overlay, not color
// matching — see CongratsModal's NEW_WORDS_BOX comment for why that's the
// reliable way to do this). BG_FILL/TEXT_COLOR are sampled from the plaque's
// cream background and the flatter "DAYS" text below it, so the swapped-in
// real count blends into the same plaque instead of the "7"'s own carved-
// stone bevel shading (which isn't something a flat fillText can replicate).
const IMG_SIZE = 1254;
const DIGIT_BOX = { x0: 560, x1: 790, y0: 550, y1: 852 };
const BG_FILL = '#e6ccbb';
const TEXT_COLOR = '#44305a';

interface Props {
  days: number;
  size?: number;
  className?: string;
}

export default function GoalDaysBadge({ days, size = 96, className }: Props) {
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

      ctx.fillStyle = BG_FILL;
      ctx.fillRect(DIGIT_BOX.x0, DIGIT_BOX.y0, DIGIT_BOX.x1 - DIGIT_BOX.x0, DIGIT_BOX.y1 - DIGIT_BOX.y0);

      const cx = (DIGIT_BOX.x0 + DIGIT_BOX.x1) / 2;
      const cy = (DIGIT_BOX.y0 + DIGIT_BOX.y1) / 2;
      const boxHeight = DIGIT_BOX.y1 - DIGIT_BOX.y0;
      const digits = String(days).length;
      // Shrink for multi-digit counts so a big total still fits the box the
      // single placeholder digit was carved into.
      const fontSize = digits <= 1 ? boxHeight * 0.85 : boxHeight * 0.85 * (1.7 / (digits + 0.7));
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(days), cx, cy + fontSize * 0.05);

      canvas.toBlob(blob => {
        if (blob && !cancelled) setImgUrl(URL.createObjectURL(blob));
      });
    };

    const bg = new window.Image();
    bg.onload = () => draw(bg);
    bg.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/days_counter.png`;

    return () => { cancelled = true; };
  }, [days]);

  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);

  if (!imgUrl) return <div style={{ width: size, height: size }} className={className} />;

  return (
    // Locally generated (canvas → blob URL) — no remote source to optimize.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imgUrl}
      alt={`${days} total day${days === 1 ? '' : 's'} goal completed`}
      width={size}
      height={size}
      className={className}
    />
  );
}
