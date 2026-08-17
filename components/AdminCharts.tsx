'use client';

// Two small, dependency-free chart primitives for /admin — hand-rolled SVG
// rather than pulling in a charting library, since this is a single
// owner-only page and the app currently has no chart dependency at all
// (qrcode is the only non-framework dependency in package.json). Keeps
// this page's bundle weight near zero rather than shipping a charting lib
// nobody else in the app needs.

export interface ChartSeries {
  label: string;
  color: string;
  values: number[]; // must be the same length as `dates`
}

// A multi-line trend chart over a fixed set of dates — every date in the
// window gets a point even if the value is 0, so a quiet day reads as a
// real zero rather than a gap (see admin-stats's lastNDays, which is what
// guarantees the arrays passed in here have no missing days).
export function TrendChart({ title, dates, series, emptyNote }: {
  title: string;
  dates: string[];
  series: ChartSeries[];
  emptyNote?: string;
}) {
  const width = 600, height = 160, padTop = 10, padBottom = 24, padX = 8;
  const maxVal = Math.max(1, ...series.flatMap(s => s.values));
  const n = dates.length;
  const xStep = n > 1 ? (width - padX * 2) / (n - 1) : 0;
  const xFor = (i: number) => padX + i * xStep;
  const yFor = (v: number) => height - padBottom - (v / maxVal) * (height - padTop - padBottom);
  const hasAnyData = series.some(s => s.values.some(v => v > 0));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
        <div className="flex gap-2.5 flex-wrap justify-end">
          {series.map(s => (
            <span key={s.label} className="text-[11px] flex items-center gap-1 text-stone-500">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" preserveAspectRatio="none">
        {/* Baseline */}
        <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} stroke="#e7e0d4" strokeWidth={1} />
        {series.map(s => (
          <polyline
            key={s.label}
            points={s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        <text x={padX} y={height - 6} fontSize={9} fill="#a8a29e">{dates[0]}</text>
        <text x={width - padX} y={height - 6} fontSize={9} fill="#a8a29e" textAnchor="end">{dates[n - 1]}</text>
      </svg>
      {!hasAnyData && emptyNote && (
        <p className="text-stone-400 text-xs italic">{emptyNote}</p>
      )}
    </div>
  );
}

export interface BarRow {
  label: string;
  segments: { value: number; color: string }[];
}

// Horizontal stacked bars, sized relative to the largest row's total —
// used for the level breakdown (signed-in vs anonymous per level).
export function LevelBars({ rows }: { rows: BarRow[] }) {
  const maxTotal = Math.max(1, ...rows.map(r => r.segments.reduce((s, seg) => s + seg.value, 0)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map(row => {
        const total = row.segments.reduce((s, seg) => s + seg.value, 0);
        return (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-10 text-xs font-medium text-stone-600 shrink-0">{row.label}</span>
            <div className="flex-1 h-4 rounded-full bg-stone-100 overflow-hidden flex">
              {row.segments.map((seg, i) => (
                seg.value > 0 && (
                  <div
                    key={i}
                    style={{ width: `${(seg.value / maxTotal) * 100}%`, background: seg.color }}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                  />
                )
              ))}
            </div>
            <span className="w-6 text-xs text-stone-500 text-right shrink-0">{total}</span>
          </div>
        );
      })}
    </div>
  );
}
