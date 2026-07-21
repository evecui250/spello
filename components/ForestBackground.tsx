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

// Fixed (not random) so server and client render identically — hand-placed
// for a loosely natural, non-uniform tree line rather than a repeating tile.
const BACK_TREES = [
  { x: 8, scale: 0.5 }, { x: 50, scale: 0.6 }, { x: 95, scale: 0.48 }, { x: 138, scale: 0.58 },
  { x: 182, scale: 0.5 }, { x: 225, scale: 0.56 }, { x: 270, scale: 0.48 }, { x: 315, scale: 0.58 },
  { x: 360, scale: 0.52 },
];
const FRONT_TREES = [
  { x: -8, scale: 0.82 }, { x: 32, scale: 0.95 }, { x: 74, scale: 0.78 }, { x: 118, scale: 1.0 },
  { x: 162, scale: 0.8 }, { x: 205, scale: 0.9 }, { x: 250, scale: 0.84 }, { x: 294, scale: 0.98 },
  { x: 338, scale: 0.78 }, { x: 382, scale: 0.88 },
];

// One tree, origin (0,0) at the base of the trunk so scaling grows it
// symmetrically from the ground up. A trunk, a few thin branch strokes
// poking out to the sides, and overlapping leaf-cluster blobs for an
// organic (not triangular) canopy.
function TreeSymbol({ id, canopy, branch }: { id: string; canopy: string; branch: string }) {
  return (
    <g id={id}>
      <rect x="-1.4" y="-11" width="2.8" height="11" fill={branch} />
      <path
        d="M0 -9 L-7 -13 M0 -13 L7 -17 M0 -17 L-6 -21 M0 -20 L5 -24"
        stroke={branch} strokeWidth="1.1" fill="none" strokeLinecap="round"
      />
      <ellipse cx="0" cy="-17" rx="12" ry="9.5" fill={canopy} />
      <ellipse cx="-7" cy="-24" rx="8.5" ry="7.5" fill={canopy} />
      <ellipse cx="7" cy="-25" rx="7.5" ry="6.5" fill={canopy} />
      <ellipse cx="0" cy="-32" rx="9.5" ry="8.5" fill={canopy} />
      <ellipse cx="-4" cy="-38" rx="6" ry="5.5" fill={canopy} />
      <ellipse cx="5" cy="-36" rx="5.5" ry="5" fill={canopy} />
    </g>
  );
}

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
      <svg
        className="absolute bottom-0 left-0 w-full h-36 sm:h-44"
        viewBox="0 0 400 100"
        preserveAspectRatio="xMidYMax slice"
      >
        <defs>
          <TreeSymbol id="treeBack" canopy="#0d3327" branch="#0a2a20" />
          <TreeSymbol id="treeFront" canopy="#082018" branch="#051510" />
        </defs>
        {BACK_TREES.map((t, i) => (
          <use key={`back-${i}`} href="#treeBack" transform={`translate(${t.x}, 96) scale(${t.scale})`} opacity={0.7} />
        ))}
        {FRONT_TREES.map((t, i) => (
          <use key={`front-${i}`} href="#treeFront" transform={`translate(${t.x}, 99) scale(${t.scale})`} />
        ))}
      </svg>
    </div>
  );
}
