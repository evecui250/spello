'use client';

import { MascotStageId } from '../lib/storage';

// The user's own hand-picked artwork: a single 1024x1536 sprite sheet (2x2
// grid) at public/four_stages_dog.png. Each stage is a uniform 460x460
// crop, positioned via CSS background-position/size percentages — the
// standard responsive-sprite formula — so this renders correctly at any
// size the caller gives it without a build step or extra image files.
const IMG_W = 1024;
const IMG_H = 1536;
const CROP = 460;

const CROP_ORIGIN: Record<MascotStageId, { x: number; y: number }> = {
  puppy: { x: 25, y: 240 },
  short: { x: 542, y: 200 },
  medium: { x: 40, y: 785 },
  'long-crowned': { x: 542, y: 745 },
};

const BG_SIZE = `${(IMG_W / CROP) * 100}% ${(IMG_H / CROP) * 100}%`;

interface Props {
  stage: MascotStageId;
  className?: string;
}

export default function DachshundMascot({ stage, className }: Props) {
  const { x, y } = CROP_ORIGIN[stage];
  const posX = (x / (IMG_W - CROP)) * 100;
  const posY = (y / (IMG_H - CROP)) * 100;

  return (
    <span
      role="img"
      aria-label={`${stage.replace('-', ' ')} dachshund`}
      className={`inline-block rounded-full overflow-hidden bg-amber-900/10 ${className ?? ''}`}
      style={{
        backgroundImage: `url(${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/four_stages_dog.png)`,
        backgroundSize: BG_SIZE,
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}
