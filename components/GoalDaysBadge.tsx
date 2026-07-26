'use client';

// public/goal_days_badge.png and public/streak_days_badge.png (cropped from
// a single days_counter_v3.png sprite, with its baked-in checkerboard
// "transparent" placeholder pattern removed via flood-fill — see git history
// for the extraction script) have a real transparent background, but — same
// gotcha as the earlier PNG badge — the cream circle isn't blank: it already
// has its own placeholder digits ("28"/"14") drawn in. numberBox positions
// the real count; coverBox is a same-cream-color patch drawn first, sized
// generously around numberBox, to fully hide the original placeholder digit
// before the real one is drawn on top — without reaching the leaf-divider/
// label text sitting just below it in the same circle. All measured
// directly off the art (grid-overlay pixel measurement, not a guess).
const VARIANTS = {
  goal: {
    image: 'goal_days_badge.png',
    aspectRatio: 766 / 722,
    numberBox: { x0: 33.9, x1: 72.7, y0: 39.2, y1: 63.2 },
    coverBox: { x0: 30.5, x1: 76.2, y0: 33.9, y1: 64.75 },
  },
  streak: {
    image: 'streak_days_badge.png',
    aspectRatio: 769 / 727,
    numberBox: { x0: 35.1, x1: 69.5, y0: 41, y1: 62.4 },
    coverBox: { x0: 31.6, x1: 72.9, y0: 37.7, y1: 64.4 },
  },
} as const;

const TEXT_COLOR = '#2f4a2c';
const CREAM = '#f7eed9';

interface Props {
  variant: keyof typeof VARIANTS;
  count: number;
  size?: number;
  className?: string;
  label?: string;
}

export default function GoalDaysBadge({ variant, count, size = 96, className, label }: Props) {
  const { image, aspectRatio, numberBox, coverBox } = VARIANTS[variant];
  const width = size;
  const height = size * aspectRatio;
  const digits = String(count).length;
  const boxHeightPx = ((numberBox.y1 - numberBox.y0) / 100) * height;
  const fontSize = (digits <= 2 ? boxHeightPx * 0.85 : boxHeightPx * 0.85 * (1.7 / (digits + 0.7)));

  return (
    <div className={`relative shrink-0 ${className ?? ''}`} style={{ width, height }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/${image}`}
        alt={label ? `${count} ${label}` : `${count}`}
        width={width}
        height={height}
        className="absolute inset-0 w-full h-full"
      />
      <div
        className="absolute"
        style={{
          left: `${coverBox.x0}%`,
          top: `${coverBox.y0}%`,
          width: `${coverBox.x1 - coverBox.x0}%`,
          height: `${coverBox.y1 - coverBox.y0}%`,
          backgroundColor: CREAM,
        }}
      />
      <div
        className="absolute flex items-center justify-center font-extrabold"
        style={{
          left: `${(numberBox.x0 + numberBox.x1) / 2}%`,
          top: `${(numberBox.y0 + numberBox.y1) / 2}%`,
          width: `${numberBox.x1 - numberBox.x0}%`,
          height: `${numberBox.y1 - numberBox.y0}%`,
          transform: 'translate(-50%, -50%)',
          color: TEXT_COLOR,
          fontSize,
        }}
      >
        {count}
      </div>
    </div>
  );
}
