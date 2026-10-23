import type { LiveState, MatchMeta, ViewerProfile } from '@matchlight/schema';
import { DualLine, Gauge, MomentumChart, Sparkline } from './Charts';

/** Mode-specific data strip under the pitch: the experience changes, not just the wording. */
export function Insights({
  profile,
  state,
  meta,
}: {
  profile: ViewerProfile;
  state: LiveState | null;
  meta: MatchMeta;
}) {
  if (!state) return <div className="insights loading">Waiting for the first events…</div>;
  const H = state.teams.home;
  const A = state.teams.away;
  const hc = meta.home.colors.primary;
  const ac = meta.away.colors.primary;
  switch (profile.mode) {
    case 'analyst':
      return (
        <div className="insights analyst">
          <div className="ins-card wide">
            <h4>Momentum index</h4>
            <MomentumChart series={state.series.momentum} home={hc} away={ac} />
          </div>
          <div className="ins-card">
            <h4>
              xG race <b style={{ color: hc }}>{H.xg.toFixed(2)}</b> ·{' '}
              <b style={{ color: ac }}>{A.xg.toFixed(2)}</b>
            </h4>
            <DualLine
              a={state.series.xg_home}
              b={state.series.xg_away}
              colorA={hc}
              colorB={ac}
              label="Cumulative xG"
            />
          </div>
          <div className="ins-card">
            <h4>
              PPDA (10′) <b style={{ color: hc }}>{H.ppda_10?.toFixed(1) ?? '–'}</b> ·{' '}
              <b style={{ color: ac }}>{A.ppda_10?.toFixed(1) ?? '–'}</b>
              <small> lower = harder press</small>
            </h4>
            <DualLine
              a={state.series.ppda_home}
              b={state.series.ppda_away}
              colorA={hc}
              colorB={ac}
              label="Rolling PPDA"
            />
          </div>
          <div className="ins-card table">
            <StatRow
              label="Possession"
              h={`${Math.round(H.possession_pct)}%`}
              a={`${Math.round(A.possession_pct)}%`}
            />
            <StatRow
              label="Shots (on tgt)"
              h={`${H.shots} (${H.shots_on_target})`}
              a={`${A.shots} (${A.shots_on_target})`}
            />
            <StatRow
              label="Pass acc."
              h={`${Math.round(H.pass_accuracy)}%`}
              a={`${Math.round(A.pass_accuracy)}%`}
            />
            <StatRow
              label="Pass difficulty"
              h={(H.avg_pass_difficulty * 10).toFixed(1)}
              a={(A.avg_pass_difficulty * 10).toFixed(1)}
            />
            <StatRow label="xT" h={H.xt.toFixed(2)} a={A.xt.toFixed(2)} />
            <StatRow label="High turnovers" h={H.high_turnovers} a={A.high_turnovers} />
            <StatRow
              label="Field tilt"
              h={`${Math.round(H.field_tilt)}%`}
              a={`${Math.round(A.field_tilt)}%`}
            />
            <div className="dual">
              <span>
                Tempo <b>{state.tempo.toFixed(1)}</b>/min
              </span>
              <span>
                Control <b>{Math.round(state.control)}</b>/100
              </span>
            </div>
          </div>
        </div>
      );
    case 'casual':
    case 'club': {
      const fav = profile.mode === 'club' ? (profile.favorite_team ?? 'home') : null;
      const mom = state.momentum;
      const leader = Math.abs(mom) < 15 ? null : mom > 0 ? 'home' : 'away';
      const leaderName = leader ? (fav === leader ? 'Your team' : meta[leader].name) : null;
      return (
        <div className="insights casual">
          <div className="ins-card big">
            <h4>Who’s on top right now?</h4>
            <div className="tug">
              <span style={{ color: hc }}>{fav === 'home' ? 'You' : meta.home.short}</span>
              <div className="tug-track">
                <div className="tug-knot" style={{ left: `${50 + mom / 2.2}%` }} />
              </div>
              <span style={{ color: ac }}>{fav === 'away' ? 'You' : meta.away.short}</span>
            </div>
            <p className="tug-words">
              {leaderName
                ? `${leaderName} ${Math.abs(mom) > 50 ? 'are dominating' : 'have the edge'}`
                : 'Evenly poised'}
            </p>
          </div>
          <div className="ins-card">
            <h4>Chances</h4>
            <BarPair h={H.shots} a={A.shots} hc={hc} ac={ac} />
          </div>
          <div className="ins-card">
            <h4>Ball</h4>
            <BarPair
              h={Math.round(H.possession_pct)}
              a={Math.round(A.possession_pct)}
              hc={hc}
              ac={ac}
              suffix="%"
            />
          </div>
        </div>
      );
    }
    case 'player': {
      const id = profile.focus_player_id;
      const p = id ? state.players[id] : undefined;
      const pl = id ? [...meta.home.players, ...meta.away.players].find((x) => x.id === id) : undefined;
      if (!pl) return <div className="insights loading">Pick a player to follow in the profile panel.</div>;
      const team = meta[pl.side];
      return (
        <div className="insights player" style={{ ['--team' as string]: team.colors.primary }}>
          <div className="ins-card pcard">
            <div className="pc-num">{pl.number}</div>
            <div>
              <div className="pc-name">{pl.name}</div>
              <div className="pc-sub">
                {team.name} · {pl.position} {p && !p.on_pitch ? '· off the pitch' : ''}
              </div>
            </div>
            <div className="pc-rating" title="Live rating">
              {p?.rating.toFixed(1) ?? '6.0'}
            </div>
          </div>
          <div className="ins-card stats-grid">
            <Stat k="Touches" v={p?.touches ?? 0} />
            <Stat k="Passes" v={p ? `${p.passes_completed}/${p.passes}` : '0/0'} />
            <Stat k="Distance" v={`${((p?.distance_m ?? 0) / 1000).toFixed(1)} km`} />
            <Stat k="Top speed" v={`${(p?.top_speed_kmh ?? 0).toFixed(1)} km/h`} />
            <Stat k="Sprints" v={p?.sprints ?? 0} />
            <Stat k="xG · xT" v={`${(p?.xg ?? 0).toFixed(2)} · ${(p?.xt ?? 0).toFixed(2)}`} />
            <Stat k="Goals / Ast" v={`${p?.goals ?? 0} / ${p?.assists ?? 0}`} />
            <Stat k="Hardest pass" v={`${((p?.hardest_pass ?? 0) * 10).toFixed(1)}/10`} />
          </div>
          <p className="muted small">Heatmap of touches is drawn on the pitch.</p>
        </div>
      );
    }
    case 'metric': {
      const m = profile.metric ?? 'ball_speed';
      const lastPass = state.flags.at(-1);
      void lastPass;
      const cfg: Record<
        string,
        { label: string; value: number; max: number; display: string; series: number[] }
      > = {
        ball_speed: {
          label: 'Fastest ball',
          value: Math.max(H.top_ball_speed_kmh, A.top_ball_speed_kmh),
          max: 130,
          display: `${Math.round(Math.max(H.top_ball_speed_kmh, A.top_ball_speed_kmh))}`,
          series: [],
        },
        pass_difficulty: {
          label: 'Avg pass difficulty /10',
          value: ((H.avg_pass_difficulty + A.avg_pass_difficulty) / 2) * 10,
          max: 10,
          display: (((H.avg_pass_difficulty + A.avg_pass_difficulty) / 2) * 10).toFixed(1),
          series: [],
        },
        player_speed: {
          label: 'Top speed km/h',
          value: Math.max(H.top_player_speed_kmh, A.top_player_speed_kmh),
          max: 36,
          display: Math.max(H.top_player_speed_kmh, A.top_player_speed_kmh).toFixed(1),
          series: [],
        },
        xg: {
          label: `xG ${meta.home.short}–${meta.away.short}`,
          value: H.xg + A.xg,
          max: 5,
          display: `${H.xg.toFixed(1)}–${A.xg.toFixed(1)}`,
          series: state.series.xg_home.map((p) => p.v),
        },
        ppda: {
          label: `PPDA ${meta.home.short} (10′)`,
          value: H.ppda_10 ?? 0,
          max: 25,
          display: (H.ppda_10 ?? 0).toFixed(1),
          series: state.series.ppda_home.map((p) => p.v),
        },
        momentum: {
          label: 'Momentum',
          value: Math.abs(state.momentum),
          max: 100,
          display: `${state.momentum > 0 ? meta.home.short : meta.away.short} ${Math.abs(Math.round(state.momentum))}`,
          series: state.series.momentum.map((p) => p.v),
        },
        tempo: {
          label: 'Tempo /min',
          value: state.tempo,
          max: 25,
          display: state.tempo.toFixed(1),
          series: state.series.tempo.map((p) => p.v),
        },
      };
      const c = cfg[m];
      return (
        <div className="insights metric">
          <div className="ins-card gauge-card">
            <Gauge value={c.value} max={c.max} label={c.label} display={c.display} />
          </div>
          <div className="ins-card wide">
            <h4>{c.label} · history</h4>
            {c.series.length > 2 ? (
              <Sparkline values={c.series} height={60} />
            ) : (
              <p className="muted">
                Live value updates on every relevant event; record-breaking moments appear in the feed.
              </p>
            )}
          </div>
        </div>
      );
    }
  }
}

const StatRow = ({ label, h, a }: { label: string; h: string | number; a: string | number }) => (
  <div className="srow">
    <b>{h}</b>
    <span>{label}</span>
    <b>{a}</b>
  </div>
);

const Stat = ({ k, v }: { k: string; v: string | number }) => (
  <div className="stat">
    <span>{k}</span>
    <b>{v}</b>
  </div>
);

const BarPair = ({
  h,
  a,
  hc,
  ac,
  suffix = '',
}: {
  h: number;
  a: number;
  hc: string;
  ac: string;
  suffix?: string;
}) => {
  const t = Math.max(1, h + a);
  return (
    <div className="barpair">
      <b>
        {h}
        {suffix}
      </b>
      <div className="bp-track">
        <span style={{ width: `${(h / t) * 100}%`, background: hc }} />
        <span style={{ width: `${(a / t) * 100}%`, background: ac }} />
      </div>
      <b>
        {a}
        {suffix}
      </b>
    </div>
  );
};
