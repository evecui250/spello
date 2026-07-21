'use client';

import { MascotStageId } from '../lib/storage';

// The user's own artwork (public/four_stages_dog.png), background removed
// and cropped tight to each dog so the full pose always shows — no square
// crop, no frame, just the dog itself sized by the caller's className.
const IMG: Record<MascotStageId, string> = {
  puppy: 'mascot_puppy.png',
  short: 'mascot_short.png',
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
