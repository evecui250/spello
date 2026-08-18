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
    // logo.webp (v3, recompressed from the original PNG at the resolution
    // this is actually ever displayed at) is the background-removed
    // artwork only — it no longer bakes in the "spello" wordmark, so it's
    // added here as real text
    // (in the same warm amber the rest of the UI uses on this dark green
    // background) instead of being part of the image.
    return (
      <div className={`flex flex-col items-center ${className ?? ''}`}>
        <Image
          src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/logo.webp`}
          alt=""
          width={size}
          height={Math.round(size * 1.14)}
          unoptimized
          priority
          style={{ width: size, height: 'auto' }}
        />
        <span
          className="font-extrabold text-amber-100 tracking-tight -mt-1"
          style={{ fontSize: Math.round(size * 0.19), textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
        >
          spello
        </span>
      </div>
    );
  }

  return (
    <div
      className={`relative inline-block overflow-hidden rounded-full shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      {/* A dedicated square crop (public/logo_icon.webp) — framed by hand
          around the mascot so ears, paws, and pencil all stay fully in
          frame, instead of a runtime object-fit crop that cut off the
          bottom of the artwork. */}
      <Image
        src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/logo_icon.webp`}
        alt="Spello"
        fill
        sizes={`${size}px`}
        unoptimized
        style={{ objectFit: 'cover' }}
      />
    </div>
  );
}
