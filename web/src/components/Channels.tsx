import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  FeedItem,
  Language,
  LiveState,
  MatchMeta,
  SeriesPoint,
  ViewerProfile,
} from '@matchlight/schema';
import { normaliseProfile, profileKey } from '@matchlight/schema';
import { kit } from '../lib/kits';
import { t } from '../lib/i18n';
import { store, useFrame } from '../lib/store';
import { OverlayLayer } from './Overlays';
import { Pitch, createView } from './Pitch';
import { Feed } from './Feed';

/** Register a profile with the server for the current session; returns its key once live. */
export function useViewer(profile: ViewerProfile): string | null {
  const sid = store.sessionId;
  const key = profileKey(normaliseProfile(profile));
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!sid) return;
    let alive = true;
    store
      .addViewer(profile)
      .then((k) => alive && setReady(k))
      .catch(() => alive && setReady(null));
    return () => {
      alive = false;
      store.removeViewer(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, key]);
  return ready === key ? key : null;
}

/** The pitch inside its board frame, with the profile's broadcast graphics on top. */
function Board({
  profile,
  viewerKey,
  compact,
}: {
  profile: ViewerProfile;
  viewerKey: string | null;
  compact?: boolean;
}) {
  useFrame();
  const view = useMemo(() => createView(), []);
  const meta = store.meta;
  const v = viewerKey ? store.viewers.get(viewerKey) : undefined;
  const lang = profile.language;
  const status = store.status;
  return (
    <div className={compact ? 'board board-compact' : 'board'}>
      <div className="board-surface">
        <Pitch
          mode={profile.mode}
          focusPlayerId={profile.focus_player_id}
          favorite={profile.favorite_team}
          metric={profile.metric}
          highContrast={profile.high_contrast}
          view={view}
          label={
            meta
              ? `${meta.home.name} ${store.state?.score.home ?? 0}, ${meta.away.name} ${store.state?.score.away ?? 0}`
              : t(lang, 'loading_match')
          }
        />
        {meta && v && (
          <OverlayLayer overlays={[...v.overlays.values()]} now={store.now()} meta={meta} view={view} />
        )}
        {store.sessionId && status !== 'open' && (
          <p className="board-status">{t(lang, status === 'connecting' ? 'connecting' : 'reconnecting')}</p>
        )}
      </div>
    </div>
  );
}

/** Newest lines first; system lines ("joined at 21′") only count when nothing else has happened yet. */
const latestLines = (feed: FeedItem[], n: number) => {
  const real = feed.filter((f) => f.kind !== 'system');
  return (real.length ? real : feed).slice(-n).reverse();
};

// ───────────────────────────── Analyst ─────────────────────────────

function AnalystChannel({ profile, compact }: { profile: ViewerProfile; compact?: boolean }) {
  const key = useViewer(profile);
  const meta = store.meta;
  const state = store.state;
  const lang = profile.language;
  const feed = key ? (store.viewers.get(key)?.feed ?? []) : [];
  return (
    <section
      className={compact ? 'ch ch-analyst ch-compact' : 'ch ch-analyst'}
      aria-label={t(lang, 'ch_analyst')}
    >
      <Board profile={profile} viewerKey={key} compact={compact} />
      <div className="an-side">
        {meta && state && !compact && <StatTable meta={meta} state={state} lang={lang} />}
        {meta && state && !compact && <Multiples meta={meta} state={state} lang={lang} />}
        <Feed items={feed} lang={lang} density="dense" label={t(lang, 'commentary')} />
      </div>
    </section>
  );
}

function StatTable({ meta, state, lang }: { meta: MatchMeta; state: LiveState; lang: Language }) {
  const H = state.teams.home;
  const A = state.teams.away;
  const rows: [string, string, string][] = [
    [t(lang, 'possession'), `${Math.round(H.possession_pct)}%`, `${Math.round(A.possession_pct)}%`],
    [t(lang, 'xg'), H.xg.toFixed(2), A.xg.toFixed(2)],
    [t(lang, 'shots'), String(H.shots), String(A.shots)],
    [t(lang, 'on_target'), String(H.shots_on_target), String(A.shots_on_target)],
    [t(lang, 'pass_acc'), `${Math.round(H.pass_accuracy)}%`, `${Math.round(A.pass_accuracy)}%`],
    [t(lang, 'ppda10'), H.ppda_10?.toFixed(1) ?? '–', A.ppda_10?.toFixed(1) ?? '–'],
    [t(lang, 'high_turnovers'), String(H.high_turnovers), String(A.high_turnovers)],
    [t(lang, 'field_tilt'), `${Math.round(H.field_tilt)}%`, `${Math.round(A.field_tilt)}%`],
  ];
  return (
    <table className="stats">
      <thead>
        <tr>
          <th scope="col" className="team" style={{ ['--kit' as string]: kit(meta, 'home').base }}>
            {meta.home.short}
          </th>
          <th scope="col">
            <span className="sr-only">{t(lang, 'possession')}</span>
          </th>
          <th scope="col" className="team" style={{ ['--kit' as string]: kit(meta, 'away').base }}>
            {meta.away.short}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, h, a]) => (
          <tr key={label}>
            <td className="num">
              <Tick value={h} />
            </td>
            <th scope="row">{label}</th>
            <td className="num">
              <Tick value={a} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A value that briefly ticks when it changes (motion answers data, nothing else). */
function Tick({ value }: { value: string }) {
  return (
    <span className="tick" key={value}>
      {value}
    </span>
  );
}

function Multiples({ meta, state, lang }: { meta: MatchMeta; state: LiveState; lang: Language }) {
  const hk = kit(meta, 'home').base;
  const ak = kit(meta, 'away').base;
  const s = state.series;
  const pair = (h: string, a: string) => (
    <>
      <span style={{ color: hk }}>{h}</span> <span style={{ color: ak }}>{a}</span>
    </>
  );
  const items: { label: string; a: SeriesPoint[]; b?: SeriesPoint[]; zero?: boolean; value: ReactNode }[] = [
    {
      label: t(lang, 'xg'),
      a: s.xg_home,
      b: s.xg_away,
      value: pair(state.teams.home.xg.toFixed(2), state.teams.away.xg.toFixed(2)),
    },
    {
      label: t(lang, 'ppda10'),
      a: s.ppda_home,
      b: s.ppda_away,
      value: pair(state.teams.home.ppda_10?.toFixed(1) ?? '–', state.teams.away.ppda_10?.toFixed(1) ?? '–'),
    },
    { label: t(lang, 'momentum'), a: s.momentum, zero: true, value: String(Math.round(state.momentum)) },
    { label: t(lang, 'tempo'), a: s.tempo, value: state.tempo.toFixed(1) },
    { label: t(lang, 'control'), a: s.control, value: String(Math.round(state.control)) },
  ];
  return (
    <div className="multiples">
      {items.map((it) => (
        <figure key={it.label} className="mult">
          <figcaption>
            <span>{it.label}</span>
            <span className="num">{it.value}</span>
          </figcaption>
          <Small a={it.a} b={it.b} ca={hk} cb={ak} zero={it.zero} />
        </figure>
      ))}
    </div>
  );
}

function Small({
  a,
  b,
  ca,
  cb,
  zero,
}: {
  a: SeriesPoint[];
  b?: SeriesPoint[];
  ca: string;
  cb: string;
  zero?: boolean;
}) {
  const W = 120;
  const Hh = 34;
  const all = [...a, ...(b ?? [])].map((p) => p.v);
  const min = zero ? -100 : Math.min(0, ...all);
  const max = zero ? 100 : Math.max(1, ...all);
  const x = (m: number) => (m / 96) * W;
  const y = (v: number) => Hh - 2 - ((v - min) / (max - min || 1)) * (Hh - 4);
  const path = (s: SeriesPoint[]) =>
    s.map((p, i) => `${i ? 'L' : 'M'}${x(p.minute).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="small" preserveAspectRatio="none" aria-hidden>
      <line x1={x(45)} x2={x(45)} y1="0" y2={Hh} className="small-ht" />
      {zero && <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="small-zero" />}
      <path d={path(a)} stroke={zero ? 'var(--chalk)' : ca} />
      {b && <path d={path(b)} stroke={cb} />}
    </svg>
  );
}

// ───────────────────────────── Fan / my club ─────────────────────────────

function FanChannel({ profile, compact }: { profile: ViewerProfile; compact?: boolean }) {
  const key = useViewer(profile);
  const lang = profile.language;
  const feed = key ? (store.viewers.get(key)?.feed ?? []) : [];
  const [lead, ...rest] = latestLines(feed, 4);
  return (
    <section
      className={`ch ch-fan ${profile.mode === 'club' ? 'ch-club' : ''} ${compact ? 'ch-compact' : ''}`}
      aria-label={t(lang, profile.mode === 'club' ? 'ch_club' : 'ch_casual')}
    >
      <div className="fan-words" aria-live="polite">
        {lead ? (
          <article className="fan-lead" key={lead.id} lang={lead.lang} dir={lead.dir}>
            <p className="fan-min num">{lead.minute_label}</p>
            <p className="fan-text">{lead.text}</p>
          </article>
        ) : (
          <p className="fan-empty">{t(lang, 'feed_empty')}</p>
        )}
        {!compact && (
          <ol className="fan-history">
            {rest.map((f) => (
              <li key={f.id} lang={f.lang} dir={f.dir}>
                <span className="num">{f.minute_label}</span> {f.text}
              </li>
            ))}
          </ol>
        )}
      </div>
      <Board profile={profile} viewerKey={key} compact />
    </section>
  );
}

// ───────────────────────────── Player focus ─────────────────────────────

function PlayerChannel({ profile, compact }: { profile: ViewerProfile; compact?: boolean }) {
  const key = useViewer(profile);
  const lang = profile.language;
  const meta = store.meta;
  const id = profile.focus_player_id;
  const pl = id && meta ? [...meta.home.players, ...meta.away.players].find((p) => p.id === id) : undefined;
  const ps = id ? store.state?.players[id] : undefined;
  const feed = key ? (store.viewers.get(key)?.feed ?? []) : [];
  if (!pl) {
    return (
      <section className="ch ch-player">
        <p className="fan-empty">{t(lang, 'no_player')}</p>
      </section>
    );
  }
  const k = kit(meta, pl.side);
  return (
    <section
      className={compact ? 'ch ch-player ch-compact' : 'ch ch-player'}
      aria-label={t(lang, 'ch_player')}
      style={{ ['--kit' as string]: k.base }}
    >
      <header className="pl-head">
        <p className="pl-name">
          <span className="pl-num num">{pl.number}</span>
          <span>{pl.name}</span>
          {ps && !ps.on_pitch && <span className="pl-off">{t(lang, 'off_pitch')}</span>}
        </p>
        <p className="pl-rating">
          <span>{t(lang, 'rating')}</span> <span className="num">{ps?.rating.toFixed(1) ?? '6.0'}</span>
        </p>
      </header>
      <Board profile={profile} viewerKey={key} compact={compact} />
      <p className="pl-line">
        <span>
          <b className="num">
            <Tick value={String(ps?.touches ?? 0)} />
          </b>{' '}
          {t(lang, 'touches')}
        </span>
        <span>
          <b className="num">
            <Tick value={String(ps?.passes_completed ?? 0)} />
          </b>{' '}
          {t(lang, 'passes_of', { n: ps?.passes ?? 0 })}
        </span>
        <span>
          <b className="num">{((ps?.distance_m ?? 0) / 1000).toFixed(1)}</b> {t(lang, 'km')}
        </span>
        <span>
          <b className="num">{(ps?.top_speed_kmh ?? 0).toFixed(1)}</b> {t(lang, 'top_speed')}
        </span>
        <span>
          <b className="num">{(ps?.xg ?? 0).toFixed(2)}</b> {t(lang, 'xg_short')}
        </span>
      </p>
      {!compact && <Feed items={feed} lang={lang} density="relaxed" label={t(lang, 'commentary')} />}
    </section>
  );
}

// ───────────────────────────── One number ─────────────────────────────

function MetricChannel({ profile, compact }: { profile: ViewerProfile; compact?: boolean }) {
  const key = useViewer(profile);
  const lang = profile.language;
  const state = store.state;
  const meta = store.meta;
  const metric = profile.metric ?? 'ball_speed';
  const feed = key ? (store.viewers.get(key)?.feed ?? []) : [];
  let value = '–';
  if (state && meta) {
    const H = state.teams.home;
    const A = state.teams.away;
    const v: Record<string, string> = {
      ball_speed: String(Math.round(Math.max(H.top_ball_speed_kmh, A.top_ball_speed_kmh))),
      pass_difficulty: (((H.avg_pass_difficulty + A.avg_pass_difficulty) / 2) * 10).toFixed(1),
      player_speed: Math.max(H.top_player_speed_kmh, A.top_player_speed_kmh).toFixed(1),
      xg: `${H.xg.toFixed(1)}–${A.xg.toFixed(1)}`,
      ppda: `${H.ppda_10?.toFixed(1) ?? '–'}`,
      momentum: String(Math.abs(Math.round(state.momentum))),
      tempo: state.tempo.toFixed(1),
    };
    value = v[metric];
  }
  const latest = latestLines(feed, 1)[0];
  return (
    <section
      className={compact ? 'ch ch-metric ch-compact' : 'ch ch-metric'}
      aria-label={t(lang, 'ch_metric')}
    >
      <div className="mx-figure">
        <p className="mx-value num" key={value}>
          {value}
        </p>
        <p className="mx-label">{t(lang, `metric_${metric}` as 'metric_xg')}</p>
        {latest && (
          <p className="mx-note" lang={latest.lang} dir={latest.dir}>
            <span className="num">{latest.minute_label}</span> {latest.text}
          </p>
        )}
      </div>
      <Board profile={profile} viewerKey={key} compact />
    </section>
  );
}

export function Channel({ profile, compact }: { profile: ViewerProfile; compact?: boolean }) {
  switch (profile.mode) {
    case 'analyst':
      return <AnalystChannel profile={profile} compact={compact} />;
    case 'casual':
    case 'club':
      return <FanChannel profile={profile} compact={compact} />;
    case 'player':
      return <PlayerChannel profile={profile} compact={compact} />;
    case 'metric':
      return <MetricChannel profile={profile} compact={compact} />;
  }
}
