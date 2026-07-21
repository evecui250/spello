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

// Each stage gets a light/dark pair — the gradient runs top-lit to
// bottom-shaded so the body reads as round rather than a flat bar.
const STAGE_COLORS: Record<MascotStageId, { light: string; dark: string; belly: string }> = {
  puppy: { light: '#c7bfb8', dark: '#93897d', belly: '#e8e1d8' },
  short: { light: '#e0995a', dark: '#a85f2e', belly: '#f3d3ae' },
  medium: { light: '#c4763a', dark: '#7a3f18', belly: '#e8b985' },
  'long-crowned': { light: '#a85a2c', dark: '#5e2c10', belly: '#d99a5f' },
};

interface Props {
  stage: MascotStageId;
  className?: string;
}

export default function DachshundMascot({ stage, className }: Props) {
  const bodyLength = BODY_LENGTH[stage];
  const { light, dark, belly } = STAGE_COLORS[stage];
  const gradId = `dach-grad-${stage}`;

  const headX = 100;
  const headY = 27;
  const headR = 10.5;
  const bodyY = 31;
  const bodyH = 14;
  const bodyEndX = headX - 4; // body tucks slightly under the head
  const bodyStartX = bodyEndX - bodyLength;
  const legTopY = bodyY + bodyH / 2 - 2;
  const legH = 11;
  const pawY = legTopY + legH;

  return (
    <svg viewBox="0 0 132 56" className={className} role="img" aria-label={`${stage.replace('-', ' ')} dachshund`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={light} />
          <stop offset="100%" stopColor={dark} />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx={(bodyStartX + headX) / 2 + 2} cy={pawY + 2.5} rx={bodyLength / 2 + 16} ry="2.2" fill="#1c1917" opacity="0.15" />

      {/* tail — a gentle upward curl */}
      <path
        d={`M ${bodyStartX + 4} ${bodyY} q -7 -2 -8 -10 q -1 -6 4 -8`}
        stroke={`url(#${gradId})`} strokeWidth="4" strokeLinecap="round" fill="none"
      />

      {/* back legs with little paw flares */}
      {[bodyStartX + 6, bodyStartX + 15].map((x, i) => (
        <g key={`back-${i}`}>
          <rect x={x} y={legTopY} width="4" height={legH} rx="2" fill={dark} />
          <ellipse cx={x + 2} cy={pawY} rx="3" ry="1.6" fill="#3f2a1a" />
        </g>
      ))}
      {/* front legs */}
      {[headX - 26, headX - 17].map((x, i) => (
        <g key={`front-${i}`}>
          <rect x={x} y={legTopY} width="4" height={legH} rx="2" fill={dark} />
          <ellipse cx={x + 2} cy={pawY} rx="3" ry="1.6" fill="#3f2a1a" />
        </g>
      ))}

      {/* body — rounded pill with a lighter belly crescent for volume */}
      <rect x={bodyStartX} y={bodyY - bodyH / 2} width={bodyEndX - bodyStartX} height={bodyH} rx={bodyH / 2} fill={`url(#${gradId})`} />
      <path
        d={`M ${bodyStartX + 4} ${bodyY + bodyH / 2 - 1.5}
            Q ${(bodyStartX + bodyEndX) / 2} ${bodyY + bodyH / 2 + 2.5} ${bodyEndX - 3} ${bodyY + bodyH / 2 - 1.5}
            Q ${(bodyStartX + bodyEndX) / 2} ${bodyY + bodyH / 2 - 3.5} ${bodyStartX + 4} ${bodyY + bodyH / 2 - 1.5} Z`}
        fill={belly} opacity="0.55"
      />

      {/* ear — floppy, drawn before the head so it tucks behind */}
      <path
        d={`M ${headX - 6} ${headY - 4}
            q -11 1 -11 13
            q 0 7 6 9
            q -2 -8 2 -14
            q 2 -4 5 -5 Z`}
        fill={dark} opacity="0.9"
      />
      <path
        d={`M ${headX - 9} ${headY + 3} q -2 5 1 9 q 3 -1 4 -6 Z`}
        fill={belly} opacity="0.5"
      />

      {/* head */}
      <circle cx={headX} cy={headY} r={headR} fill={`url(#${gradId})`} />

      {/* snout + nose */}
      <path
        d={`M ${headX + 6} ${headY - 2} q 9 0 10 6 q 0.5 3.5 -3 4.5 q -6 1 -9 -3 Z`}
        fill={`url(#${gradId})`}
      />
      <ellipse cx={headX + 14} cy={headY + 3.2} rx="2.6" ry="2.1" fill="#2b1c11" />
      <path d={`M ${headX + 12} ${headY + 5.5} q 2 2 4 0`} stroke="#2b1c11" strokeWidth="0.7" fill="none" strokeLinecap="round" />

      {/* eye with a small highlight for warmth */}
      <circle cx={headX + 2} cy={headY - 3} r="1.6" fill="#211407" />
      <circle cx={headX + 2.5} cy={headY - 3.6} r="0.5" fill="#fff" opacity="0.85" />

      {/* crown — mastered only */}
      {stage === 'long-crowned' && (
        <g>
          <path
            d={`M ${headX - 10} ${headY - 13}
                l 2.4 -6.2 l 2.3 4.2 l 2.5 -6.8 l 2.5 6.8 l 2.3 -4.2 l 2.4 6.2 Z`}
            fill="#facc15" stroke="#b45309" strokeWidth="0.6"
          />
          <circle cx={headX - 5.3} cy={headY - 14.5} r="0.9" fill="#f87171" />
          <circle cx={headX - 0.3} cy={headY - 16} r="0.9" fill="#60a5fa" />
          <circle cx={headX + 4.7} cy={headY - 14.5} r="0.9" fill="#f87171" />
        </g>
      )}
    </svg>
  );
}
