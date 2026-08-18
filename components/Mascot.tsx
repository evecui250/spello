'use client';

import { MascotStageId } from '../lib/storage';

// Puppy, short, and long-crowned (the user's own clean vector re-creations,
// transparent background, no cutout artifacts) use SVG — path-optimized
// via svgo, not resized/rasterized, since they're genuine vector art and
// stay sharp at any size. medium is still the background-removed raster
// crop until a vector version exists, so it's a WebP instead, resized
// down to the ~240px this ever actually needs (was a 720px PNG before —
// nothing on screen shows it anywhere near that large).
const IMG: Record<MascotStageId, string> = {
  puppy: 'mascot_puppy.svg',
  short: 'mascot_short.svg',
  medium: 'mascot_medium.webp',
  'long-crowned': 'mascot_long-crowned.svg',
};

interface Props {
  stage: MascotStageId;
  className?: string;
}

export default function DachshundMascot({ stage, className }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${IMG[stage]}`}
      alt={`${stage.replace('-', ' ')} dachshund`}
      className={`object-contain ${className ?? ''}`}
    />
  );
}
