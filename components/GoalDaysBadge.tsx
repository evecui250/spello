'use client';

// public/days_counter_v2.svg (1024x1024) is a flame-ring badge with a
// genuinely transparent circular hole left for the count — unlike the old
// PNG version, there's no baked-in placeholder digit to erase, so the real
// count can just be overlaid as plain HTML text on top of the image. Hole
// center/diameter measured directly off the rendered SVG (transparent-pixel
// scan, not a guess): center ≈ (511, 673) of 1024, usable diameter ≈ 300.
const HOLE_CENTER_X_PCT = 49.9;
const HOLE_CENTER_Y_PCT = 65.7;
const HOLE_DIAMETER_PCT = 29.3;
const TEXT_COLOR = '#5a3a86';

interface Props {
  days: number;
  size?: number;
  className?: string;
}

export default function GoalDaysBadge({ days, size = 96, className }: Props) {
  const digits = String(days).length;
  // Shrink for multi-digit counts so a big total still fits the circle.
  const fontSize = (digits <= 2 ? size * 0.3 : size * 0.3 * (2.4 / (digits + 0.4)));

  return (
    <div className={`relative shrink-0 ${className ?? ''}`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/days_counter_v2.svg`}
        alt={`${days} total day${days === 1 ? '' : 's'} goal completed`}
        width={size}
        height={size}
        className="absolute inset-0 w-full h-full"
      />
      <div
        className="absolute flex items-center justify-center font-extrabold"
        style={{
          left: `${HOLE_CENTER_X_PCT}%`,
          top: `${HOLE_CENTER_Y_PCT}%`,
          width: `${HOLE_DIAMETER_PCT}%`,
          height: `${HOLE_DIAMETER_PCT}%`,
          transform: 'translate(-50%, -50%)',
          color: TEXT_COLOR,
          fontSize,
        }}
      >
        {days}
      </div>
    </div>
  );
}
