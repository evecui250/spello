'use client';

// The app's persistent backdrop — a soft, mysterious forest rendered purely
// in CSS/SVG (no image assets), fixed behind all page content so it reads
// as the app's actual background rather than a boxed-in decoration.

const FIREFLIES = [
  { top: '9%', left: '8%', delay: 0 },
  { top: '18%', left: '85%', delay: 0.6 },
  { top: '42%', left: '14%', delay: 1.2 },
  { top: '12%', left: '48%', delay: 1.8 },
  { top: '58%', left: '90%', delay: 0.3 },
  { top: '33%', left: '4%', delay: 2.1 },
  { top: '7%', left: '68%', delay: 1.5 },
  { top: '70%', left: '28%', delay: 0.9 },
  { top: '50%', left: '58%', delay: 1.7 },
  { top: '25%', left: '35%', delay: 2.4 },
];

export default function ForestBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b from-[#0f3d3a] via-[#155c4a] to-[#0c2e25]">
      <div className="absolute -top-10 left-[10%] w-1/2 h-2/3 bg-[radial-gradient(ellipse_at_top,rgba(255,244,200,0.16),transparent_65%)]" />
      <div className="absolute -top-4 right-[5%] w-2/5 h-1/2 bg-[radial-gradient(ellipse_at_top,rgba(190,255,230,0.11),transparent_65%)]" />
      <div className="animate-mist absolute top-1/3 left-0 w-[130%] h-32 bg-white/5 blur-2xl rounded-full" />
      {FIREFLIES.map((f, i) => (
        <span
          key={i}
          className="animate-firefly absolute w-1.5 h-1.5 rounded-full bg-amber-200 shadow-[0_0_8px_3px_rgba(252,211,77,0.7)]"
          style={{ top: f.top, left: f.left, animationDelay: `${f.delay}s` }}
        />
      ))}
      <svg className="absolute bottom-0 left-0 w-full h-28" viewBox="0 0 100 20" preserveAspectRatio="none">
        <defs>
          <pattern id="treesBackGlobal" width="11" height="20" patternUnits="userSpaceOnUse">
            <polygon points="5.5,3 0,20 11,20" fill="#0a3327" opacity="0.55" />
          </pattern>
          <pattern id="treesFrontGlobal" width="8" height="20" patternUnits="userSpaceOnUse" patternTransform="translate(3,0)">
            <polygon points="4,7 0,20 8,20" fill="#062018" opacity="0.9" />
          </pattern>
        </defs>
        <rect width="100" height="20" fill="url(#treesBackGlobal)" />
        <rect width="100" height="20" fill="url(#treesFrontGlobal)" />
      </svg>
    </div>
  );
}
