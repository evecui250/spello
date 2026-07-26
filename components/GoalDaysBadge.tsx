'use client';

// public/days_counter_v2.svg (1024x1024) is a flame-ring badge with a
// genuinely transparent circular hole left for the count — unlike the old
// PNG version, there's no baked-in placeholder digit to erase, so the real
// count can just be overlaid as plain HTML text on top of the image. Hole
// center/diameter measured directly off the rendered SVG (transparent-pixel
// scan, not a guess): center ≈ (511, 673) of 1024, usable diameter ≈ 300.
// Reused for both the lifetime goal-days count and the day streak — same
// badge art, different number/label passed in by the caller.
const HOLE_CENTER_X_PCT = 49.9;
const HOLE_CENTER_Y_PCT = 65.7;
const HOLE_DIAMETER_PCT = 29.3;
// Warm deep red-orange sampled directly from the flame ring's own darker
// rim tone, so the number reads as part of the badge instead of clashing
// with it the way the earlier cool purple did.
const TEXT_COLOR = '#8a0f0d';

interface Props {
  count: number;
  size?: number;
  className?: string;
  label?: string;
}

export default function GoalDaysBadge({ count, size = 96, className, label }: Props) {
  const digits = String(count).length;
  // Shrink for multi-digit counts so a big total still fits the circle.
  const fontSize = (digits <= 2 ? size * 0.3 : size * 0.3 * (2.4 / (digits + 0.4)));

  return (
    <div className={`relative shrink-0 ${className ?? ''}`} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/days_counter_v2.svg`}
        alt={label ? `${count} ${label}` : `${count}`}
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
        {count}
      </div>
    </div>
  );
}
