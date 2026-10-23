import type { CSSProperties } from 'react';
import type { MatchMeta, Overlay, OverlayOf } from '@matchlight/schema';
import { livePositions, pitchToStage } from './Pitch';
import { Sparkline } from './Charts';

const SAFE = 0.05;
const ICONS: Record<string, string> = {
  goal: '⚽',
  card: '▮',
  chance: '◎',
  tactic: '⇄',
  momentum: '↗',
  speed: '⚡',
  pass: '➶',
  sub: '⇅',
  save: '✋',
  info: '●',
};

export function OverlayLayer({ overlays, now, meta }: { overlays: Overlay[]; now: number; meta: MatchMeta }) {
  const visible = overlays.filter((o) => o.start_ts <= now + 0.5 && now < o.start_ts + o.duration);
  return (
    <div className="safe-area" aria-hidden="false">
      {visible.map((o) => {
        const style: CSSProperties =
          o.kind === 'player_tag'
            ? tagPosition(o)
            : {
                left: `${o.position.x * 100}%`,
                top: `${o.position.y * 100}%`,
                width: `${o.position.w * 100}%`,
              };
        return (
          <div
            key={o.id}
            className={`ov ov-${o.kind} ov-${o.region} theme-${o.theme}`}
            style={style}
            dir={o.dir}
            lang={o.language}
            role={o.kind === 'key_moment_card' ? 'status' : undefined}
            aria-label={o.aria_label}
            data-priority={o.priority}
          >
            <OverlayBody o={o} meta={meta} />
          </div>
        );
      })}
    </div>
  );
}

function tagPosition(o: OverlayOf<'player_tag'>): CSSProperties {
  const live = livePositions.get(o.content.player_id);
  if (live) {
    const p = pitchToStage(live.x, live.y);
    return {
      left: `${((p.left - SAFE) / (1 - 2 * SAFE)) * 100}%`,
      top: `${((p.top - SAFE) / (1 - 2 * SAFE)) * 100}%`,
    };
  }
  return { left: `${o.position.x * 100}%`, top: `${o.position.y * 100}%` };
}

function OverlayBody({ o, meta }: { o: Overlay; meta: MatchMeta }) {
  const color = (side?: 'home' | 'away') =>
    side ? (side === 'home' ? meta.home : meta.away).colors.primary : 'var(--accent)';
  switch (o.kind) {
    case 'lower_third':
      return (
        <div className="lt" style={{ ['--team' as string]: o.content.accent ?? color(o.content.team) }}>
          <div className="lt-bar" />
          <div className="lt-text">
            <div className="lt-title">{o.content.title}</div>
            {o.content.subtitle && <div className="lt-sub">{o.content.subtitle}</div>}
          </div>
        </div>
      );
    case 'player_tag':
      return (
        <div className="tag" style={{ ['--team' as string]: color(o.content.team) }}>
          <span className="tag-num">{o.content.number}</span>
          <span className="tag-name">{o.content.name}</span>
          {o.content.value && (
            <span className="tag-val">
              {o.content.label ? `${o.content.label} ` : ''}
              <b>{o.content.value}</b>
            </span>
          )}
        </div>
      );
    case 'stat_badge':
      return (
        <div className="badge">
          <div className="badge-label">{o.content.label}</div>
          <div className="badge-row">
            <span className="badge-val">{o.content.display}</span>
            {o.content.trend && (
              <span className={`trend trend-${o.content.trend}`}>
                {o.content.trend === 'up' ? '▲' : o.content.trend === 'down' ? '▼' : '■'}
              </span>
            )}
          </div>
          {o.content.series && o.content.series.length > 2 && (
            <Sparkline values={o.content.series} height={26} />
          )}
        </div>
      );
    case 'momentum_bar': {
      const v = o.content.value;
      return (
        <div className="mbar">
          <span className="mbar-l" style={{ color: o.content.home_color }}>
            {o.content.home_label}
          </span>
          <div className="mbar-track">
            <div className="mbar-mid" />
            <div
              className="mbar-fill"
              style={{
                left: v >= 0 ? '50%' : `${50 + v / 2}%`,
                width: `${Math.abs(v) / 2}%`,
                background: v >= 0 ? o.content.home_color : o.content.away_color,
              }}
            />
          </div>
          <span className="mbar-r" style={{ color: o.content.away_color }}>
            {o.content.away_label}
          </span>
        </div>
      );
    }
    case 'pass_map':
      return (
        <div className="pmap">
          <div className="pmap-title">{o.content.title}</div>
          <svg viewBox="-2 -2 109 72" className="pmap-svg">
            <rect x="0" y="0" width="105" height="68" className="pmap-pitch" />
            <line x1="52.5" y1="0" x2="52.5" y2="68" className="pmap-line" />
            <rect x="0" y="13.84" width="16.5" height="40.32" className="pmap-line" />
            <rect x="88.5" y="13.84" width="16.5" height="40.32" className="pmap-line" />
            <defs>
              <marker id={`arr-${o.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
              </marker>
            </defs>
            {o.content.passes.map((p, i) => (
              <line
                key={i}
                x1={p.x}
                y1={68 - p.y}
                x2={p.end_x}
                y2={68 - p.end_y}
                className={p.complete ? 'pm-ok' : 'pm-bad'}
                style={{
                  color: p.complete
                    ? `hsl(${80 - p.difficulty * 60}, 100%, ${55 + p.difficulty * 10}%)`
                    : '#ff5a5a',
                  opacity: 0.4 + 0.6 * ((i + 1) / o.content.passes.length),
                }}
                markerEnd={`url(#arr-${o.id})`}
              />
            ))}
          </svg>
        </div>
      );
    case 'key_moment_card':
      return (
        <div
          className={`card ${o.region === 'center' ? 'card-hero' : ''}`}
          style={{ ['--team' as string]: color(o.content.team) }}
        >
          <div className="card-head">
            <span className="card-icon">{ICONS[o.content.icon] ?? '●'}</span>
            <span className="card-title">{o.content.title}</span>
          </div>
          <p className="card-body">{o.content.body}</p>
          {o.content.evidence.length > 0 && (
            <ul className="card-ev">
              {o.content.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {o.content.confidence !== undefined && (
            <div className="card-conf" title="Explainer confidence (Critic-verified)">
              <span style={{ width: `${o.content.confidence * 100}%` }} />
              <em>{Math.round(o.content.confidence * 100)}% · grounded</em>
            </div>
          )}
        </div>
      );
  }
}
