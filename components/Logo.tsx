'use client';

import Image from 'next/image';

interface Props {
  size?: number;
  /** 'icon' crops tightly to the mascot for small spots (nav bar).
   *  'full' shows the whole illustration, including the baked-in wordmark. */
  variant?: 'icon' | 'full';
  className?: string;
}

export default function Logo({ size = 32, variant = 'icon', className }: Props) {
  if (variant === 'full') {
    return (
      <Image
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/logo.png`}
        alt="Spello"
        width={size}
        height={Math.round(size * 1.5)}
        unoptimized
        priority
        className={className}
        style={{ width: size, height: 'auto' }}
      />
    );
  }

  return (
    <div
      className={`relative inline-block overflow-hidden rounded-full shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      {/* A dedicated square crop (public/logo_icon.png) — framed by hand
          around the mascot so ears, paws, and pencil all stay fully in
          frame, instead of a runtime object-fit crop that cut off the
          bottom of the artwork. */}
      <Image
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/logo_icon.png`}
        alt="Spello"
        fill
        sizes={`${size}px`}
        unoptimized
        style={{ objectFit: 'cover' }}
      />
    </div>
  );
}
