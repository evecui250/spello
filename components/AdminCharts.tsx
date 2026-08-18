'use client';

// Three small, dependency-free chart primitives for /admin — hand-rolled
// SVG rather than pulling in a charting library, since this is a single
// owner-only page and the app currently has no chart dependency at all
// (qrcode is the only non-framework dependency in package.json). Keeps
// this page's bundle weight near zero rather than shipping a charting lib
// nobody else in the app needs.

// A fixed, repeatable color per slice regardless of how many countries
// are present or what order they sort in — assigned by iterating this
// list, not randomized, so the same country reads as the same color if
// the dashboard is reopened later with slightly different totals.
const DONUT_PALETTE = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#65a30d', '#a8a29e'];

export interface DonutSlice {
  label: string;
  count: number;
}

// A donut (not a full pie) specifically so a title/total can sit in the
// empty center — reads at a glance without a separate label. Slices under
// 1% of the total are still drawn (never fully invisible), just thin.
export function DonutChart({ title, slices, emptyNote }: {
  title: string;
  slices: DonutSlice[];
  emptyNote?: string;
}) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  const size = 120, r = 50, cx = size / 2, cy = size / 2, strokeWidth = 18;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = slices.map((s, i) => {
    const fraction = total > 0 ? s.count / total : 0;
    const dash = fraction * circumference;
    const arc = { ...s, color: DONUT_PALETTE[i % DONUT_PALETTE.length], dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
      {total === 0 ? (
        <p className="text-stone-400 text-xs italic">{emptyNote ?? 'No data yet.'}</p>
      ) : (
        <div className="flex items-center gap-4">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e7e0d4" strokeWidth={strokeWidth} />
            {arcs.map(a => (
              <circle
                key={a.label}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={a.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${a.dash} ${circumference - a.dash}`}
                strokeDashoffset={-a.offset}
              />
            ))}
          </svg>
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            {arcs.slice(0, 8).map(a => (
              <div key={a.label} className="flex items-center gap-1.5 text-xs min-w-0">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
                <span className="text-stone-600 truncate flex-1">{a.label}</span>
                <span className="text-stone-500 font-mono shrink-0">{a.count}</span>
              </div>
            ))}
            {arcs.length > 8 && (
              <p className="text-stone-400 text-[11px]">+{arcs.length - 8} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
