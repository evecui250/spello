'use client';

import { MascotStageId } from '../lib/storage';

// Puppy and short (the user's own clean vector re-creations, transparent
// background, no cutout artifacts) use SVG; medium and long-crowned are
// still the background-removed raster crops until vector versions of those
// two exist.
const IMG: Record<MascotStageId, string> = {
  puppy: 'mascot_puppy.svg',
  short: 'mascot_short.svg',
  medium: 'mascot_medium.png',
  'long-crowned': 'mascot_long-crowned.png',
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
