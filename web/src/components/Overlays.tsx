import type { CSSProperties } from 'react';
import type { MatchMeta, Overlay, OverlayOf, Side } from '@matchlight/schema';
import { kit } from '../lib/kits';
import { store } from '../lib/store';
import type { PitchView } from './Pitch';

const SAFE = 0.05;

/** Split "Goal · 64'" style server titles into separate fields so the layout, not punctuation, separates them. */
const parts = (s: string) => s.split(' · ').map((x) => x.trim());

export function OverlayLayer({
  overlays,
  now,
  meta,
  view,
}: {
  overlays: Overlay[];
  now: number;
  meta: MatchMeta;
  view: PitchView;
}) {
  const visible = overlays.filter((o) => o.start_ts <= now + 0.5 && now < o.start_ts + o.duration);
  return (
    <div className="safe-area">
      {visible.map((o) => {
        let style: CSSProperties = {
          left: `${o.position.x * 100}%`,
          top: `${o.position.y * 100}%`,
          width: `${o.position.w * 100}%`,
        };
        if (o.kind === 'player_tag') {
          const at = livePosition(o.content.player_id);
          if (!at) return null;
          const s = view.toStage(at.x, at.y);
          if (!s.visible) return null;
          style = {
            left: `${((s.left - SAFE) / (1 - 2 * SAFE)) * 100}%`,
            top: `${((s.top - SAFE) / (1 - 2 * SAFE)) * 100}%`,
          };
        }
        return (
          <div
            key={o.id}
            className={`gfx gfx-${o.kind} at-${o.region} ${o.theme === 'high_contrast' ? 'gfx-hc' : ''}`}
            style={style}
            dir={o.dir}
            lang={o.language}
            aria-label={o.aria_label}
            role={o.kind === 'key_moment_card' ? 'status' : undefined}
          >
            <Body o={o} meta={meta} />
          </div>
        );
      })}
    </div>
  );
}

// Player tags anchor to the latest tracking position.
function livePosition(id: string) {
  const p = store.frame?.players.find((x) => x.id === id);
  return p ? { x: p.x, y: p.y } : null;
}

function teamVars(meta: MatchMeta, side?: Side): CSSProperties {
  if (!side) return {};
  const k = kit(meta, side);
  return { ['--kit' as string]: k.base, ['--kit-trim' as string]: k.trim, ['--kit-ink' as string]: k.ink };
}

function Body({ o, meta }: { o: Overlay; meta: MatchMeta }) {
  switch (o.kind) {
    case 'lower_third': {
      const sub = o.content.subtitle ? parts(o.content.subtitle) : [];
      return (
        <div className="lt" style={teamVars(meta, o.content.team)}>
          <p className="lt-title">{parts(o.content.title).join(' ')}</p>
          {sub.length > 0 && (
            <p className="lt-sub">
              <span>{sub[0]}</span>
              {sub[1] && <span className="lt-min">{sub[1]}</span>}
            </p>
          )}
        </div>
      );
    }
    case 'player_tag':
      return (
        <div className="tag" style={teamVars(meta, o.content.team)}>
          <span className="tag-name">{o.content.name}</span>
          {o.content.value && <span className="tag-val">{o.content.value}</span>}
        </div>
      );
    case 'stat_badge':
      return (
        <div className="badge" style={teamVars(meta, o.content.team)}>
          <p className="badge-label">{o.content.label}</p>
          <p className="badge-val num" key={o.content.display}>
            {o.content.display}
          </p>
        </div>
      );
    case 'momentum_bar': {
      const v = o.content.value;
      const hk = kit(meta, 'home');
      const ak = kit(meta, 'away');
      return (
        <div className="mbar" dir="ltr">
          <span>{o.content.home_label}</span>
          <span className="mbar-track" aria-hidden>
            <span
              className="mbar-fill"
              style={{
                insetInlineStart: v >= 0 ? '50%' : `${50 + v / 2}%`,
                width: `${Math.abs(v) / 2}%`,
                background: v >= 0 ? hk.base : ak.base,
              }}
            />
          </span>
          <span>{o.content.away_label}</span>
        </div>
      );
    }
    case 'pass_map':
      return (
        <div className="pmap">
          <p className="pmap-title">{parts(o.content.title).join(', ')}</p>
          <svg viewBox="-2 -2 109 72" className="pmap-svg" aria-hidden>
            <rect x="0" y="0" width="105" height="68" className="pmap-pitch" />
            <line x1="52.5" y1="0" x2="52.5" y2="68" className="pmap-line" />
            {o.content.passes.map((p, i) => (
              <line
                key={i}
                x1={p.x}
                y1={68 - p.y}
                x2={p.end_x}
                y2={68 - p.end_y}
                className={p.complete ? 'pm-ok' : 'pm-bad'}
              />
            ))}
          </svg>
        </div>
      );
    case 'key_moment_card': {
      const [label, minute] = parts(o.content.title);
      const hero = o.region === 'center';
      return (
        <div className={hero ? 'card card-hero' : 'card'} style={teamVars(meta, o.content.team)}>
          <p className="card-head">
            <span className="card-min num">{minute}</span>
            <span className="card-label">{label}</span>
          </p>
          <p className="card-body">{o.content.body}</p>
          {o.content.evidence.length > 0 && (
            <ul className="card-ev">
              {o.content.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }
  }
}

export type { OverlayOf };
