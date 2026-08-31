// Small line icons in a consistent outline style, used in place of emoji
// throughout the Home page for a calmer, more deliberate look.

interface IconProps {
  className?: string;
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

export function FlameIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2.5c.8 2.3-.6 3.7-1.8 5-1.3 1.4-2.4 2.9-2.4 5a4.2 4.2 0 0 0 8.4 0c0-1.3-.5-2.2-1.1-3.1.9.4 1.9 1.6 1.9 3.4a5.2 5.2 0 0 1-10.4 0c0-4.5 3.4-6 5.4-10.3Z" />
    </svg>
  );
}

export function SproutIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 21V10" />
      <path d="M12 10c0-3.5-2.5-6-6-6 0 3.5 2.5 6 6 6Z" />
      <path d="M12 13c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6Z" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.2 6-.9Z" />
    </svg>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m12 3 8.5 4.5L12 12 3.5 7.5Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 0 4 23Z" />
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 1 2.5 2" />
    </svg>
  );
}

export function StackedBooksIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="14.5" width="16" height="3.2" rx="0.8" />
      <rect x="5.5" y="10.5" width="13" height="3.2" rx="0.8" />
      <path d="M7 10.3V4.8c0-.5.5-.9 1-.7l2.8 1c.3.1.7.1 1 0l1.3-.5c.3-.1.7-.1 1 0l1.3.5c.3.1.7.1 1 0l2.6-1c.5-.2 1 .2 1 .7v5.5" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 11a8 8 0 0 0-14.9-3.5M4 5v4.5h4.5" />
      <path d="M4 13a8 8 0 0 0 14.9 3.5M20 19v-4.5h-4.5" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.3 2.3 4.7-5.1" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 12h15" />
      <path d="m13 5.5 6.5 6.5-6.5 6.5" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 9v6h3.5l4.5 4V5l-4.5 4H4z" fill="currentColor" stroke="none" />
      <path d="M15.3 8.7a4.8 4.8 0 0 1 0 6.6" />
      <path d="M17.6 6.2a8.2 8.2 0 0 1 0 11.6" />
    </svg>
  );
}
