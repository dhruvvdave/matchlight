import type { Moment } from '@matchlight/schema';
import { store } from '../lib/store';

const GLYPH: Partial<Record<Moment['kind'], string>> = {
  goal: '⚽',
  red_card: '■',
  card: '▮',
  tactical_shift: '⇄',
  momentum_swing: '↗',
  pressing_shift: '⤧',
  big_chance: '◎',
  save: '✋',
  substitution: '⇅',
  period_summary: '⏱',
};

/** Bottom timeline: momentum ribbon + key-moment markers. Click a marker to rewind to it. */
export function Timeline() {
  const meta = store.meta;
  const state = store.state;
  if (!meta) return <footer className="timeline empty" />;
  const minute = (state?.game_s ?? 0) / 60;
  const key = store.moments.filter((m) => m.significance >= 0.6 || m.kind === 'card');
  const x = (m: Moment) => {
    const mm =
      parseInt(m.minute_label, 10) +
      (m.minute_label.includes('+') ? Number(m.minute_label.split('+')[1].replace("'", '')) * 0.3 : 0);
    return Math.min(99, (mm / 96) * 100);
  };
  const series = state?.series.momentum ?? [];
  const path = series
    .map((p, i) => `${i ? 'L' : 'M'}${(p.minute / 96) * 1000},${30 - (p.v / 100) * 26}`)
    .join(' ');
  return (
    <footer className="timeline" aria-label="Match timeline">
      <div className="tl-track">
        <svg className="tl-mom" viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden>
          <defs>
            <clipPath id="tl-top">
              <rect x="0" y="0" width="1000" height="30" />
            </clipPath>
            <clipPath id="tl-bot">
              <rect x="0" y="30" width="1000" height="30" />
            </clipPath>
          </defs>
          {path && (
            <>
              <path
                d={`${path} L${(series.at(-1)!.minute / 96) * 1000},30 L${(series[0].minute / 96) * 1000},30 Z`}
                fill={meta.home.colors.primary}
                opacity="0.55"
                clipPath="url(#tl-top)"
              />
              <path
                d={`${path} L${(series.at(-1)!.minute / 96) * 1000},30 L${(series[0].minute / 96) * 1000},30 Z`}
                fill={meta.away.colors.primary}
                opacity="0.55"
                clipPath="url(#tl-bot)"
              />
            </>
          )}
          <line x1="0" y1="30" x2="1000" y2="30" stroke="rgba(255,255,255,.2)" />
        </svg>
        {[0, 15, 30, 45, 60, 75, 90].map((t) => (
          <span key={t} className="tl-tick" style={{ left: `${(t / 96) * 100}%` }}>
            {t}′
          </span>
        ))}
        <div className="tl-head" style={{ left: `${Math.min(100, (minute / 96) * 100)}%` }} />
        {key.map((m) => (
          <button
            key={m.id}
            className={`tl-mark k-${m.kind}`}
            style={{
              left: `${x(m)}%`,
              ['--team' as string]: m.team ? meta[m.team].colors.primary : 'var(--accent)',
            }}
            title={`${m.minute_label} ${m.headline} — click to rewind`}
            onClick={() => store.control('seek', Math.max(0, m.ts - 8))}
          >
            {GLYPH[m.kind] ?? '•'}
          </button>
        ))}
      </div>
    </footer>
  );
}
