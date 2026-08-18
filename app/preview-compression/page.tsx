'use client';

// Temporary dev-only preview page for comparing the original vs.
// compressed logo/mascot images at their real in-app display sizes —
// same "just visit a URL to check it" spirit as the ?previewSignInNudge=1
// / ?previewAiUnlock=1 query-param previews, but for a whole-page
// comparison rather than a single component, so it gets its own route
// instead. Not linked from NavBar; reachable by URL only, same as /admin.
// public/preview/* holds both the untouched originals and the compressed
// candidates side by side — delete this whole page + that directory once
// a decision's made and it's no longer needed.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function fmtKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
function pct(before: number, after: number): string {
  return `${Math.round((1 - after / before) * 100)}%`;
}

// Sizes captured directly from the real files at build time (see the
// compression session that produced public/preview/*) — shown next to
// each image rather than fetched, since these never change once shipped.
const SIZES = {
  logoBefore: 208482, logoAfter: 68354,
  logoIconBefore: 84294, logoIconAfter: 5384,
  medBefore: 351677, medAfter: 18696,
  puppyBefore: 66576, puppyVector: 50542, puppyRaster: 8548,
  shortBefore: 54726, shortVector: 42172, shortRaster: 9148,
  longBefore: 65110, longVector: 49944, longRaster: 8212,
};

function Option({ tag, src, size, width, label, savedVs }: {
  tag: 'Before' | 'After';
  src: string;
  size: number;
  width: number;
  label?: string;
  savedVs?: number;
}) {
  const isAfter = tag === 'After';
  return (
    <div className={`flex flex-col items-center gap-2 rounded-xl px-3 py-3 text-center ${isAfter ? 'bg-emerald-50' : 'bg-amber-100/60'}`}>
      <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white ${isAfter ? 'bg-emerald-700' : 'bg-amber-700'}`}>
        {tag}
      </span>
      <div
        className="w-full h-24 rounded-lg flex items-center justify-center"
        style={{
          backgroundImage: 'linear-gradient(45deg, #e2dccb 25%, transparent 25%), linear-gradient(-45deg, #e2dccb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2dccb 75%), linear-gradient(-45deg, transparent 75%, #e2dccb 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          backgroundColor: '#efe9db',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={width} style={{ width, objectFit: 'contain' }} />
      </div>
      <div className="font-mono text-sm font-semibold text-stone-700">{fmtKB(size)}</div>
      {savedVs !== undefined && <div className="text-xs text-stone-500">{pct(savedVs, size)} smaller</div>}
      {label && <div className="text-xs text-stone-500">{label}</div>}
    </div>
  );
}

function Card({ title, usedAt, children }: { title: string; usedAt: string; children: React.ReactNode }) {
  return (
    <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-5">
      <h2 className="font-semibold text-stone-800">{title}</h2>
      <p className="text-stone-500 text-sm mb-4">{usedAt}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>
    </div>
  );
}

export default function CompressionPreviewPage() {
  const totalBefore = SIZES.logoBefore + SIZES.logoIconBefore + SIZES.medBefore + SIZES.puppyBefore + SIZES.shortBefore + SIZES.longBefore;
  const totalAfterBest = SIZES.logoAfter + SIZES.logoIconAfter + SIZES.medAfter + SIZES.puppyRaster + SIZES.shortRaster + SIZES.longRaster;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-amber-50" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>Compression preview</h1>
        <p className="text-emerald-100/70 text-sm mt-1">Nothing's been changed in the app yet — every "after" image below is shown at its real in-app display size.</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-4 text-center">
          <div className="text-xl font-bold text-stone-800">{fmtKB(totalBefore)}</div>
          <div className="text-stone-500 text-xs mt-0.5">Before, total</div>
        </div>
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-4 text-center">
          <div className="text-xl font-bold text-emerald-700">{fmtKB(totalAfterBest)}</div>
          <div className="text-stone-500 text-xs mt-0.5">After (raster), total</div>
        </div>
        <div className="bg-amber-50/75 backdrop-blur-sm rounded-2xl border border-amber-100/50 shadow-sm p-4 text-center">
          <div className="text-xl font-bold text-emerald-700">{pct(totalBefore, totalAfterBest)}</div>
          <div className="text-stone-500 text-xs mt-0.5">Smaller</div>
        </div>
      </div>

      <Card title="Home screen logo" usedAt="Shown once, at the top of Home — displayed at 140px wide.">
        <Option tag="Before" src={`${BASE}/preview/logo_before.png`} size={SIZES.logoBefore} width={70} />
        <Option tag="After" src={`${BASE}/preview/logo_after.webp`} size={SIZES.logoAfter} width={70} savedVs={SIZES.logoBefore} />
      </Card>

      <Card title="Nav-bar / Terms & Privacy icon" usedAt="Shown on Terms and Privacy pages — displayed at 56px wide.">
        <Option tag="Before" src={`${BASE}/preview/logo_icon_before.png`} size={SIZES.logoIconBefore} width={56} />
        <Option tag="After" src={`${BASE}/preview/logo_icon_after.webp`} size={SIZES.logoIconAfter} width={56} savedVs={SIZES.logoIconBefore} />
      </Card>

      <Card title='"Strong" mascot stage (medium)' usedAt="Word List, Progress breakdown, milestone cards — largest use is 80px.">
        <Option tag="Before" src={`${BASE}/preview/mascot_medium_before.png`} size={SIZES.medBefore} width={80} />
        <Option tag="After" src={`${BASE}/preview/mascot_medium_after.webp`} size={SIZES.medAfter} width={80} savedVs={SIZES.medBefore} />
      </Card>

      <Card title='"Introduced" mascot stage (puppy)' usedAt="Currently hand-drawn vector art (SVG), not a photo — two after-options: optimized vector, or converted to the same raster format as the others.">
        <Option tag="Before" src={`${BASE}/preview/mascot_puppy_before.svg`} size={SIZES.puppyBefore} width={80} label="original vector" />
        <Option tag="After" src={`${BASE}/preview/mascot_puppy_vector.svg`} size={SIZES.puppyVector} width={80} savedVs={SIZES.puppyBefore} label="optimized vector" />
        <Option tag="After" src={`${BASE}/preview/mascot_puppy_raster.webp`} size={SIZES.puppyRaster} width={80} savedVs={SIZES.puppyBefore} label="raster (like the others)" />
      </Card>

      <Card title='"Familiar" mascot stage (short)' usedAt="Same three options as above.">
        <Option tag="Before" src={`${BASE}/preview/mascot_short_before.svg`} size={SIZES.shortBefore} width={80} label="original vector" />
        <Option tag="After" src={`${BASE}/preview/mascot_short_vector.svg`} size={SIZES.shortVector} width={80} savedVs={SIZES.shortBefore} label="optimized vector" />
        <Option tag="After" src={`${BASE}/preview/mascot_short_raster.webp`} size={SIZES.shortRaster} width={80} savedVs={SIZES.shortBefore} label="raster (like the others)" />
      </Card>

      <Card title='"Mastered" mascot stage (long-crowned)' usedAt="Same three options as above.">
        <Option tag="Before" src={`${BASE}/preview/mascot_long_before.svg`} size={SIZES.longBefore} width={80} label="original vector" />
        <Option tag="After" src={`${BASE}/preview/mascot_long_vector.svg`} size={SIZES.longVector} width={80} savedVs={SIZES.longBefore} label="optimized vector" />
        <Option tag="After" src={`${BASE}/preview/mascot_long_raster.webp`} size={SIZES.longRaster} width={80} savedVs={SIZES.longBefore} label="raster (like the others)" />
      </Card>

      <p className="text-emerald-100/70 text-xs">
        Audio is untouched — none of this affects sound files. My recommendation: the raster (WebP) option for all four
        mascot stages, for consistency and the biggest size win — the vector versions only really pay off if a future
        screen shows them much larger than 80px, which nothing currently does.
      </p>
    </div>
  );
}
