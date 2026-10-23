import type { SeriesPoint } from '@matchlight/schema';

export function Sparkline({
  values,
  height = 28,
  color = 'var(--accent)',
}: {
  values: number[];
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${height - 2 - ((v - min) / span) * (height - 4)}`)
    .join(' ');
  return (
    <svg className="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Diverging momentum area (positive = home). */
export function MomentumChart({
  series,
  home,
  away,
  height = 70,
  markers = [],
}: {
  series: SeriesPoint[];
  home: string;
  away: string;
  height?: number;
  markers?: { minute: number; color: string; label: string }[];
}) {
  const W = 300;
  const mid = height / 2;
  const x = (min: number) => (min / 96) * W;
  const y = (v: number) => mid - (v / 100) * (mid - 3);
  const d = series.length
    ? `M${x(series[0].minute)},${mid} ` +
      series.map((p) => `L${x(p.minute)},${y(p.v)}`).join(' ') +
      ` L${x(series[series.length - 1].minute)},${mid} Z`
    : '';
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Momentum over time"
    >
      <defs>
        <clipPath id="mc-top">
          <rect x="0" y="0" width={W} height={mid} />
        </clipPath>
        <clipPath id="mc-bot">
          <rect x="0" y={mid} width={W} height={mid} />
        </clipPath>
      </defs>
      <line x1="0" y1={mid} x2={W} y2={mid} className="chart-axis" />
      <line x1={x(45)} y1="0" x2={x(45)} y2={height} className="chart-grid" />
      <path d={d} fill={home} opacity="0.75" clipPath="url(#mc-top)" />
      <path d={d} fill={away} opacity="0.75" clipPath="url(#mc-bot)" />
      {markers.map((m, i) => (
        <g key={i}>
          <line
            x1={x(m.minute)}
            y1="0"
            x2={x(m.minute)}
            y2={height}
            stroke={m.color}
            strokeWidth="1.2"
            strokeDasharray="2 2"
          />
          <title>{m.label}</title>
        </g>
      ))}
    </svg>
  );
}

/** Step chart for cumulative xG (both teams) or any two-series comparison. */
export function DualLine({
  a,
  b,
  colorA,
  colorB,
  height = 70,
  maxMinute = 96,
  label,
}: {
  a: SeriesPoint[];
  b: SeriesPoint[];
  colorA: string;
  colorB: string;
  height?: number;
  maxMinute?: number;
  label: string;
}) {
  const W = 300;
  const max = Math.max(0.5, ...a.map((p) => p.v), ...b.map((p) => p.v)) * 1.1;
  const path = (s: SeriesPoint[]) =>
    s
      .map(
        (p, i) => `${i ? 'L' : 'M'}${(p.minute / maxMinute) * W},${height - 3 - (p.v / max) * (height - 6)}`,
      )
      .join(' ');
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <line x1={(45 / maxMinute) * W} y1="0" x2={(45 / maxMinute) * W} y2={height} className="chart-grid" />
      <path d={path(a)} fill="none" stroke={colorA} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <path d={path(b)} fill="none" stroke={colorB} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Gauge({
  value,
  max,
  label,
  display,
}: {
  value: number;
  max: number;
  label: string;
  display: string;
}) {
  const f = Math.max(0, Math.min(1, value / max));
  const a = Math.PI * (1 - f);
  const r = 44;
  const cx = 50;
  const cy = 52;
  return (
    <svg className="gauge" viewBox="0 0 100 62" role="img" aria-label={`${label}: ${display}`}>
      <path d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} className="gauge-bg" />
      <path
        d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r * Math.cos(a)},${cy - r * Math.sin(a)}`}
        className="gauge-fg"
      />
      <text x="50" y="47" className="gauge-val">
        {display}
      </text>
      <text x="50" y="60" className="gauge-label">
        {label}
      </text>
    </svg>
  );
}
