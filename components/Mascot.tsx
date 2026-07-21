'use client';

import { MascotStageId } from '../lib/storage';

// Body length grows with mastery stage — same drawing, just stretched,
// anchored at a fixed head position so the head/ear/snout never move.
const BODY_LENGTH: Record<MascotStageId, number> = {
  puppy: 20,
  short: 34,
  medium: 50,
  'long-crowned': 68,
};

const STAGE_COLOR: Record<MascotStageId, string> = {
  puppy: '#a8a29e',
  short: '#c2703d',
  medium: '#9a4e23',
  'long-crowned': '#7c3f1d',
};

interface Props {
  stage: MascotStageId;
  className?: string;
}

export default function DachshundMascot({ stage, className }: Props) {
  const bodyLength = BODY_LENGTH[stage];
  const color = STAGE_COLOR[stage];

  const headX = 98;
  const headY = 26;
  const headR = 11;
  const bodyY = 30;
  const bodyH = 15;
  const bodyEndX = headX - 3; // body tucks slightly under the head
  const bodyStartX = bodyEndX - bodyLength;
  const legY = bodyY + bodyH / 2 - 1;

  return (
    <svg viewBox="0 0 130 54" className={className} role="img" aria-label={`${stage.replace('-', ' ')} dachshund`}>
      {/* tail */}
      <path
        d={`M ${bodyStartX + 3} ${bodyY - 1} q -8 -9 -4 -18`}
        stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"
      />
      {/* back legs */}
      <rect x={bodyStartX + 5} y={legY} width="4" height="12" rx="2" fill={color} />
      <rect x={bodyStartX + 13} y={legY} width="4" height="12" rx="2" fill={color} />
      {/* front legs */}
      <rect x={headX - 24} y={legY} width="4" height="12" rx="2" fill={color} />
      <rect x={headX - 16} y={legY} width="4" height="12" rx="2" fill={color} />
      {/* body */}
      <rect x={bodyStartX} y={bodyY - bodyH / 2} width={bodyEndX - bodyStartX} height={bodyH} rx={bodyH / 2} fill={color} />
      {/* ear (drawn before head so it tucks behind) */}
      <path
        d={`M ${headX - 7} ${headY - 3} q -9 3 -7 16 q 8 -2 10 -11 Z`}
        fill={color} opacity="0.8"
      />
      {/* head */}
      <circle cx={headX} cy={headY} r={headR} fill={color} />
      {/* snout */}
      <ellipse cx={headX + 10} cy={headY + 4} rx="4.5" ry="3.5" fill={color} />
      <circle cx={headX + 13} cy={headY + 3.5} r="1.2" fill="#1c1917" />
      {/* eye */}
      <circle cx={headX + 3} cy={headY - 2} r="1.3" fill="#1c1917" />
      {/* crown — mastered only */}
      {stage === 'long-crowned' && (
        <path
          d={`M ${headX - 9} ${headY - 12}
              l 2.3 -6 l 2.3 4 l 2.4 -6.5 l 2.4 6.5 l 2.3 -4 l 2.3 6 Z`}
          fill="#facc15" stroke="#b45309" strokeWidth="0.6"
        />
      )}
    </svg>
  );
}
