import type {
  Flag,
  FlagKind,
  LiveState,
  MatchEvent,
  MatchMeta,
  Player,
  PlayerStats,
  SeriesPoint,
  Side,
  TeamStats,
  TrackingFrame,
} from '@matchlight/schema';
import { formatMinute, otherSide } from '@matchlight/schema';
import { att, inBox, passDifficulty, round1, round2, round3, xgModel, xtDelta } from './models.js';

export interface Derived {
  xg?: number;
  xt?: number;
  difficulty?: number;
}

interface PassLog {
  ts: number;
  id: string;
  side: Side;
  /** Start x in the passer's attacking coords. */
  ax: number;
  complete: boolean;
  len: number;
  difficulty: number;
  xt: number;
  long: boolean;
}
interface DefLog {
  ts: number;
  id: string;
  side: Side;
  /** Location in the defending side's attacking coords. */
  ax: number;
}
interface TurnoverLog {
  ts: number;
  id: string;
  wonBy: Side;
  /** Location in the winner's attacking coords. */
  ax: number;
}
interface ShotLog {
  ts: number;
  id: string;
  side: Side;
  xg: number;
  onTarget: boolean;
  goal: boolean;
}

/** Aggregates over an arbitrary stream-time window, used by the Stats agent's tools. */
export interface WindowStats {
  from_ts: number;
  to_ts: number;
  passes: number;
  passes_completed: number;
  pass_accuracy: number | null;
  avg_pass_difficulty: number | null;
  shots: number;
  shots_on_target: number;
  xg: number;
  xt: number;
  ppda: number | null;
  def_actions: number;
  high_turnovers: number;
  turnovers_lost: number;
  final_third_entries: number;
  possession_pct: number | null;
  event_ids: { shots: string[]; high_turnovers: string[]; def_actions: string[]; key_passes: string[] };
}

const ON_BALL = new Set(['pass', 'carry', 'dribble', 'shot']);
const POSSESSION_TYPES = new Set(['pass', 'carry', 'dribble', 'shot', 'set_piece', 'possession_change']);

function emptyTeam(): TeamStats {
  return {
    goals: 0,
    shots: 0,
    shots_on_target: 0,
    xg: 0,
    xt: 0,
    passes: 0,
    passes_completed: 0,
    pass_accuracy: 0,
    avg_pass_length: 0,
    avg_pass_difficulty: 0,
    progressive_passes: 0,
    final_third_entries: 0,
    possession_pct: 50,
    ppda: null,
    ppda_10: null,
    pressures: 0,
    tackles: 0,
    interceptions: 0,
    turnovers: 0,
    high_turnovers: 0,
    fouls: 0,
    yellow: 0,
    red: 0,
    corners: 0,
    offsides: 0,
    top_ball_speed_kmh: 0,
    top_shot_speed_kmh: 0,
    top_player_speed_kmh: 0,
    distance_km: 0,
    field_tilt: 50,
    players_on_pitch: 11,
  };
}

/**
 * Stage 2 (INTERPRET): streaming aggregator. O(1) per event for match totals; windowed metrics
 * scan compact time-indexed logs. Raises threshold flags as they occur.
 */
export class StatsEngine {
  readonly events: MatchEvent[] = [];
  readonly byId = new Map<string, MatchEvent>();
  readonly derived = new Map<string, Derived>();
  readonly flags: Flag[] = [];
  private readonly playerIndex = new Map<string, Player>();
  private teams: Record<Side, TeamStats> = { home: emptyTeam(), away: emptyTeam() };
  private sums = {
    home: { passLen: 0, diff: 0, possS: 0, finalThirdPasses: 0 },
    away: { passLen: 0, diff: 0, possS: 0, finalThirdPasses: 0 },
  };
  private players = new Map<
    string,
    PlayerStats & {
      _diffSum: number;
      _enter: number;
      _exit: number | null;
      _saves: number;
      _sprinting: boolean;
    }
  >();
  private passes: PassLog[] = [];
  private defs: DefLog[] = [];
  private turnovers: TurnoverLog[] = [];
  private shots: ShotLog[] = [];
  private onBall: number[] = [];
  private possChanges: number[] = [];
  private duels: number[] = [];
  private possLog: { ts: number; side: Side; dur: number }[] = [];
  private momentumAcc = { home: 0, away: 0, ts: 0 };
  private cooldowns = new Map<string, number>();
  private series: LiveState['series'] = {
    momentum: [],
    xg_home: [],
    xg_away: [],
    ppda_home: [],
    ppda_away: [],
    tempo: [],
    control: [],
  };
  private nextSample = 0;
  private lastPos = new Map<string, { x: number; y: number; ts: number }>();
  private flagSeq = 0;

  ts = 0;
  gameS = 0;
  period: 1 | 2 = 1;
  status: LiveState['status'] = 'pre';
  score = { home: 0, away: 0 };
  possession: Side | null = null;
  ball = { x: 52.5, y: 34 };
  private lastEventTs = 0;
  private lastShotId: Record<Side, string | null> = { home: null, away: null };

  constructor(readonly meta: MatchMeta) {
    for (const t of [meta.home, meta.away]) for (const p of t.players) this.playerIndex.set(p.id, p);
    for (const t of [meta.home, meta.away])
      for (const p of t.players.filter((x) => x.starter)) this.ensurePlayer(p.id, 0);
  }

  player(id: string): Player | undefined {
    return this.playerIndex.get(id);
  }

  playerName(id: string | undefined): string {
    return (id && this.playerIndex.get(id)?.short_name) || 'Unknown';
  }

  teamName(side: Side): string {
    return side === 'home' ? this.meta.home.name : this.meta.away.name;
  }

  private ensurePlayer(id: string, ts: number) {
    let p = this.players.get(id);
    if (!p) {
      const pl = this.playerIndex.get(id);
      if (!pl) return undefined;
      p = {
        player_id: id,
        side: pl.side,
        on_pitch: true,
        minutes: 0,
        touches: 0,
        passes: 0,
        passes_completed: 0,
        avg_pass_difficulty: 0,
        hardest_pass: 0,
        key_passes: 0,
        shots: 0,
        goals: 0,
        assists: 0,
        xg: 0,
        xt: 0,
        tackles: 0,
        interceptions: 0,
        pressures: 0,
        fouls: 0,
        cards: 0,
        distance_m: 0,
        top_speed_kmh: 0,
        sprints: 0,
        heat: new Array(96).fill(0),
        rating: 6,
        _diffSum: 0,
        _enter: ts,
        _exit: null,
        _saves: 0,
        _sprinting: false,
      };
      this.players.set(id, p);
    }
    return p;
  }

  private flag(
    kind: FlagKind,
    f: Omit<Flag, 'id' | 'kind' | 'ts'>,
    cooldownKey?: string,
    cooldownS = 0,
  ): Flag | null {
    if (cooldownKey) {
      const until = this.cooldowns.get(cooldownKey) ?? -1;
      if (this.ts < until) return null;
      this.cooldowns.set(cooldownKey, this.ts + cooldownS);
    }
    const flag: Flag = { id: `f${String(this.flagSeq++).padStart(4, '0')}`, kind, ts: this.ts, ...f };
    this.flags.push(flag);
    return flag;
  }

  private decayMomentum(ts: number) {
    const dt = ts - this.momentumAcc.ts;
    if (dt <= 0) return;
    const k = Math.pow(0.5, dt / 240);
    this.momentumAcc.home *= k;
    this.momentumAcc.away *= k;
    this.momentumAcc.ts = ts;
  }

  private threat(side: Side, amount: number) {
    this.decayMomentum(this.ts);
    this.momentumAcc[side] += Math.max(0, amount);
  }

  momentum(): number {
    this.decayMomentum(this.ts);
    const { home, away } = this.momentumAcc;
    return round1((100 * (home - away)) / (home + away + 1.5));
  }

  // ───────────────────────────── events ─────────────────────────────

  ingestEvent(e: MatchEvent): Flag[] {
    const before = this.flags.length;
    this.events.push(e);
    this.byId.set(e.id, e);
    // Time-based possession: attribute the gap since the previous event (capped to exclude dead balls).
    const gap = e.ts - this.lastEventTs;
    if (this.possession && gap > 0 && this.status === 'live') {
      const dur = Math.min(gap, 6);
      this.sums[this.possession].possS += dur;
      this.possLog.push({ ts: e.ts, side: this.possession, dur });
    }
    this.lastEventTs = e.ts;
    this.ts = e.ts;
    this.gameS = e.game_s;
    this.period = e.period;
    if (e.x !== undefined && e.y !== undefined) this.ball = { x: e.x, y: e.y };
    if (e.team && POSSESSION_TYPES.has(e.type)) this.possession = e.team;

    const side = e.team;
    const T = side ? this.teams[side] : undefined;
    const P = e.player_id ? this.ensurePlayer(e.player_id, e.ts) : undefined;
    if (
      P &&
      e.x !== undefined &&
      e.y !== undefined &&
      (ON_BALL.has(e.type) || e.type === 'tackle' || e.type === 'interception')
    ) {
      P.touches++;
      const a = att(P.side, e.x, e.y);
      const gx = Math.min(11, Math.floor(a.ax / (105 / 12)));
      const gy = Math.min(7, Math.floor(a.ay / (68 / 8)));
      P.heat[gy * 12 + gx]++;
    }
    if (ON_BALL.has(e.type)) this.onBall.push(e.ts);

    switch (e.type) {
      case 'period_start':
        this.status = 'live';
        this.possession = null;
        break;
      case 'period_end':
        this.status = e.period === 1 ? 'half_time' : 'full_time';
        break;
      case 'match_end':
        this.status = 'full_time';
        break;
      case 'pass': {
        const s = side!;
        const diff = passDifficulty(e);
        const complete = e.outcome === 'complete';
        const xt = complete ? xtDelta(s, e.x ?? 52.5, e.y ?? 34, e.end_x, e.end_y) : 0;
        this.derived.set(e.id, { difficulty: diff, xt });
        T!.passes++;
        this.sums[s].passLen += e.length_m;
        this.sums[s].diff += diff;
        const a = att(s, e.x ?? 52.5, e.y ?? 34);
        const b = att(s, e.end_x, e.end_y);
        if (b.ax > 70) this.sums[s].finalThirdPasses++;
        if (complete) {
          T!.passes_completed++;
          T!.xt = round3(T!.xt + xt);
          if (b.ax - a.ax >= 10 && b.ax > 40) T!.progressive_passes++;
          if (a.ax <= 70 && b.ax > 70) T!.final_third_entries++;
          if (inBox(s, e.end_x, e.end_y) && !inBox(s, e.x ?? 0, e.y ?? 0)) this.threat(s, 0.5);
          this.threat(s, Math.max(0, xt) * 12 + (b.ax > 70 ? 0.12 : 0));
        }
        T!.top_ball_speed_kmh = Math.max(T!.top_ball_speed_kmh, e.ball_speed_kmh);
        if (P) {
          P.passes++;
          P._diffSum += diff;
          if (complete) {
            P.passes_completed++;
            P.xt = round3(P.xt + xt);
            if (diff > P.hardest_pass) P.hardest_pass = diff;
          }
          if (complete && P.passes_completed === 50)
            this.flag('player_milestone', {
              team: s,
              player_id: P.player_id,
              value: 50,
              threshold: 50,
              unit: 'passes',
              label: `${this.playerName(P.player_id)} completes 50 passes`,
              event_ids: [e.id],
            });
        }
        this.passes.push({
          ts: e.ts,
          id: e.id,
          side: s,
          ax: a.ax,
          complete,
          len: e.length_m,
          difficulty: diff,
          xt,
          long: e.length_m > 32,
        });
        if (complete && diff >= 0.72)
          this.flag(
            'difficult_pass',
            {
              team: s,
              player_id: e.player_id,
              value: round2(diff),
              threshold: 0.72,
              unit: 'difficulty',
              label: `Pass difficulty ${(diff * 10).toFixed(1)}/10 completed`,
              event_ids: [e.id],
            },
            `dp-${s}`,
            150,
          );
        if (complete && e.length_m >= 50)
          this.flag(
            'long_pass',
            {
              team: s,
              player_id: e.player_id,
              value: round1(e.length_m),
              threshold: 50,
              unit: 'm',
              label: `${Math.round(e.length_m)} m pass on target`,
              event_ids: [e.id],
            },
            `lp-${s}`,
            300,
          );
        if (e.ball_speed_kmh >= 88)
          this.flag(
            'ball_speed',
            {
              team: s,
              player_id: e.player_id,
              value: e.ball_speed_kmh,
              threshold: 88,
              unit: 'km/h',
              label: `Ball speed ${Math.round(e.ball_speed_kmh)} km/h`,
              event_ids: [e.id],
            },
            'ball-speed',
            240,
          );
        break;
      }
      case 'carry': {
        const xt = xtDelta(side!, e.x ?? 52.5, e.y ?? 34, e.end_x, e.end_y);
        this.derived.set(e.id, { xt });
        T!.xt = round3(T!.xt + xt);
        if (P) P.xt = round3(P.xt + xt);
        this.threat(side!, Math.max(0, xt) * 12);
        break;
      }
      case 'dribble':
        this.duels.push(e.ts);
        break;
      case 'shot': {
        const s = side!;
        const xg = xgModel(e);
        this.derived.set(e.id, { xg });
        T!.shots++;
        T!.xg = round3(T!.xg + xg);
        const onTarget = e.outcome === 'goal' || e.outcome === 'saved';
        if (onTarget) T!.shots_on_target++;
        T!.top_shot_speed_kmh = Math.max(T!.top_shot_speed_kmh, e.ball_speed_kmh);
        T!.top_ball_speed_kmh = Math.max(T!.top_ball_speed_kmh, e.ball_speed_kmh);
        this.shots.push({ ts: e.ts, id: e.id, side: s, xg, onTarget, goal: e.outcome === 'goal' });
        this.lastShotId[s] = e.id;
        if (P) {
          P.shots++;
          P.xg = round3(P.xg + xg);
        }
        if (e.assist_id) {
          const A = this.ensurePlayer(e.assist_id, e.ts);
          if (A) A.key_passes++;
        }
        this.threat(s, xg * 14 + 0.6);
        if (e.ball_speed_kmh >= 105)
          this.flag('shot_speed', {
            team: s,
            player_id: e.player_id,
            value: e.ball_speed_kmh,
            threshold: 105,
            unit: 'km/h',
            label: `Shot struck at ${Math.round(e.ball_speed_kmh)} km/h`,
            event_ids: [e.id],
          });
        break;
      }
      case 'goal': {
        this.score = { ...e.score };
        this.teams.home.goals = e.score.home;
        this.teams.away.goals = e.score.away;
        if (P) {
          P.goals++;
          if (P.goals === 2 || P.goals === 3)
            this.flag('player_milestone', {
              team: side,
              player_id: P.player_id,
              value: P.goals,
              threshold: 2,
              unit: 'goals',
              label:
                P.goals === 2
                  ? `${this.playerName(P.player_id)} scores a brace`
                  : `Hat-trick for ${this.playerName(P.player_id)}`,
              event_ids: [e.id],
            });
        }
        if (e.assist_id) {
          const A = this.ensurePlayer(e.assist_id, e.ts);
          if (A) A.assists++;
        }
        this.threat(side!, 2.5);
        break;
      }
      case 'save': {
        if (P) P._saves++;
        break;
      }
      case 'pressure':
        T!.pressures++;
        if (P) P.pressures++;
        break;
      case 'tackle':
      case 'interception':
      case 'foul': {
        const s = side!;
        const a = att(s, e.x ?? 52.5, e.y ?? 34);
        this.defs.push({ ts: e.ts, id: e.id, side: s, ax: a.ax });
        if (e.type === 'tackle') {
          T!.tackles++;
          if (P) P.tackles++;
          this.duels.push(e.ts);
        } else if (e.type === 'interception') {
          T!.interceptions++;
          if (P) P.interceptions++;
        } else {
          T!.fouls++;
          if (P) P.fouls++;
          this.duels.push(e.ts);
        }
        break;
      }
      case 'possession_change': {
        const s = side!;
        this.possChanges.push(e.ts);
        if (e.reason === 'tackle' || e.reason === 'interception') {
          const a = att(s, e.x ?? 52.5, e.y ?? 34);
          this.teams[otherSide(s)].turnovers++;
          this.turnovers.push({ ts: e.ts, id: e.id, wonBy: s, ax: a.ax });
          if (a.ax > 70) {
            T!.high_turnovers++;
            this.threat(s, 0.8);
          }
        }
        break;
      }
      case 'card': {
        if (e.color === 'yellow') T!.yellow++;
        else {
          T!.red++;
          T!.players_on_pitch--;
          if (P) {
            P.on_pitch = false;
            P._exit = e.ts;
          }
        }
        if (P) P.cards++;
        break;
      }
      case 'substitution': {
        if (P) {
          P.on_pitch = false;
          P._exit = e.ts;
        }
        const In = this.ensurePlayer(e.player_in_id, e.ts);
        if (In) In._enter = e.ts;
        break;
      }
      case 'set_piece':
        if (e.kind === 'corner') {
          T!.corners++;
          this.threat(side!, 0.4);
        }
        break;
      case 'offside':
        T!.offsides++;
        break;
      default:
        break;
    }
    this.periodicChecks();
    return this.flags.slice(before);
  }

  // ───────────────────────────── tracking ─────────────────────────────

  ingestFrame(f: TrackingFrame): Flag[] {
    const before = this.flags.length;
    if (f.ts > this.ts) {
      this.ts = f.ts;
      this.gameS = f.game_s;
    }
    for (const pl of f.players) {
      const P = this.ensurePlayer(pl.id, f.ts);
      if (!P) continue;
      const last = this.lastPos.get(pl.id);
      if (last && f.ts - last.ts > 0 && f.ts - last.ts <= 1.5) {
        P.distance_m += Math.hypot(pl.x - last.x, pl.y - last.y);
      }
      this.lastPos.set(pl.id, { x: pl.x, y: pl.y, ts: f.ts });
      if (pl.s >= 25.2 && !P._sprinting) {
        P.sprints++;
        P._sprinting = true;
      } else if (pl.s < 14) P._sprinting = false;
      const T = this.teams[pl.side];
      if (pl.s > P.top_speed_kmh) P.top_speed_kmh = pl.s;
      if (pl.s > T.top_player_speed_kmh) {
        const matchTop = Math.max(this.teams.home.top_player_speed_kmh, this.teams.away.top_player_speed_kmh);
        T.top_player_speed_kmh = pl.s;
        if (pl.s >= 31 && pl.s > matchTop + 0.25) {
          this.flag(
            'top_speed',
            {
              team: pl.side,
              player_id: pl.id,
              value: pl.s,
              previous: matchTop,
              threshold: 31,
              unit: 'km/h',
              label: `Top speed ${pl.s.toFixed(1)} km/h`,
              event_ids: this.recentIds(2),
            },
            'top-speed',
            120,
          );
        }
      }
      // First player on each side to reach 10 km gets a milestone flag.
      if (P.distance_m >= 10000 && !this.cooldowns.has(`dist10-${pl.side}`)) {
        this.cooldowns.set(`dist10-${pl.side}`, Infinity);
        this.flag('distance_milestone', {
          team: pl.side,
          player_id: pl.id,
          value: 10,
          threshold: 10,
          unit: 'km',
          label: `${this.playerName(pl.id)} passes 10 km covered`,
          event_ids: this.recentIds(1),
        });
      }
    }
    this.periodicChecks();
    return this.flags.slice(before);
  }

  private recentIds(n: number): string[] {
    return this.events.slice(-n).map((e) => e.id);
  }

  // ───────────────────────────── periodic / windowed ─────────────────────────────

  private periodicChecks() {
    if (this.ts < this.nextSample) return;
    this.nextSample = Math.floor(this.ts / 60) * 60 + 60;
    const minute = Math.floor(this.gameS / 60);
    const pt = (v: number): SeriesPoint => ({ ts: Math.round(this.ts), minute, v: round2(v) });
    const mom = this.momentum();
    const tempo = this.tempo();
    const control = this.control();
    const ppdaH = this.ppdaWindow('home', this.ts - 600, this.ts);
    const ppdaA = this.ppdaWindow('away', this.ts - 600, this.ts);
    this.series.momentum.push(pt(mom));
    this.series.xg_home.push(pt(this.teams.home.xg));
    this.series.xg_away.push(pt(this.teams.away.xg));
    if (ppdaH !== null) this.series.ppda_home.push(pt(ppdaH));
    if (ppdaA !== null) this.series.ppda_away.push(pt(ppdaA));
    this.series.tempo.push(pt(tempo));
    this.series.control.push(pt(control));
    if (this.status !== 'live' || this.gameS < 600) return;

    // Momentum swing: >= 35 points in 5 minutes.
    const past = this.valueAt(this.series.momentum, this.ts - 300);
    if (past !== null && Math.abs(mom - past) >= 35) {
      const towards: Side = mom > past ? 'home' : 'away';
      this.flag(
        'momentum_swing',
        {
          team: towards,
          value: round1(mom),
          previous: round1(past),
          threshold: 35,
          unit: 'index',
          label: `Momentum swing to ${this.teamName(towards)}`,
          event_ids: this.threatIds(towards, this.ts - 300),
        },
        'momentum',
        360,
      );
    }
    // Pressing intensity shift: rolling PPDA moves >= 35% and >= 3 passes vs 10 minutes earlier.
    for (const s of ['home', 'away'] as const) {
      const now = s === 'home' ? ppdaH : ppdaA;
      const prev = this.valueAt(s === 'home' ? this.series.ppda_home : this.series.ppda_away, this.ts - 600);
      if (now !== null && prev !== null && Math.abs(now - prev) >= 3 && Math.abs(now - prev) / prev >= 0.35) {
        this.flag(
          'ppda_shift',
          {
            team: s,
            value: round1(now),
            previous: round1(prev),
            threshold: 0.35,
            unit: 'PPDA',
            label:
              now < prev ? `${this.teamName(s)} pressing harder` : `${this.teamName(s)} press dropping off`,
            event_ids: this.defs
              .filter((d) => d.side === s && d.ts >= this.ts - 300)
              .slice(-4)
              .map((d) => d.id),
          },
          `ppda-${s}`,
          600,
        );
      }
      const w = this.teamWindow(s, this.ts - 600, this.ts);
      if (w.xg >= 0.8)
        this.flag(
          'xg_swing',
          {
            team: s,
            value: round2(w.xg),
            threshold: 0.8,
            unit: 'xG',
            label: `${this.teamName(s)} create ${w.xg.toFixed(2)} xG in 10 minutes`,
            event_ids: w.event_ids.shots,
          },
          `xg-${s}`,
          600,
        );
      if (w.possession_pct !== null && w.possession_pct >= 70)
        this.flag(
          'possession_dominance',
          {
            team: s,
            value: round1(w.possession_pct),
            threshold: 70,
            unit: '%',
            label: `${this.teamName(s)} have ${Math.round(w.possession_pct)}% of the ball (10 min)`,
            event_ids: this.recentIds(3),
          },
          `poss-${s}`,
          900,
        );
    }
    const avgTempo = this.series.tempo.reduce((a, p) => a + p.v, 0) / Math.max(1, this.series.tempo.length);
    if (this.series.tempo.length > 10 && tempo >= avgTempo * 1.3)
      this.flag(
        'tempo_spike',
        {
          value: round1(tempo),
          previous: round1(avgTempo),
          threshold: 1.3,
          unit: 'actions/min',
          label: `Tempo up to ${tempo.toFixed(1)} actions/min`,
          event_ids: this.recentIds(3),
        },
        'tempo',
        600,
      );
    if (control < 30)
      this.flag(
        'chaos_spike',
        {
          value: round1(control),
          threshold: 30,
          unit: 'control',
          label: 'End-to-end chaos',
          event_ids: this.recentIds(4),
        },
        'chaos',
        600,
      );
  }

  private threatIds(side: Side, from: number): string[] {
    const shots = this.shots.filter((s) => s.side === side && s.ts >= from).map((s) => s.id);
    const tos = this.turnovers.filter((t) => t.wonBy === side && t.ts >= from && t.ax > 70).map((t) => t.id);
    const ids = [...shots, ...tos];
    if (!ids.length)
      ids.push(
        ...this.passes
          .filter((p) => p.side === side && p.ts >= from && p.xt > 0.02)
          .slice(-3)
          .map((p) => p.id),
      );
    return ids.slice(-5);
  }

  valueAt(series: SeriesPoint[], ts: number): number | null {
    let v: number | null = null;
    for (const p of series) {
      if (p.ts <= ts) v = p.v;
      else break;
    }
    return v;
  }

  getSeries(): LiveState['series'] {
    return this.series;
  }

  /** On-ball actions per minute over the last 5 minutes. */
  tempo(): number {
    const from = this.ts - 300;
    const n = countSince(this.onBall, from);
    const span = Math.min(300, Math.max(60, this.ts));
    return round1((n / span) * 60);
  }

  /** Control-vs-chaos: long chains & few turnovers/duels => control; frantic turnovers & long balls => chaos. */
  control(): number {
    const from = this.ts - 300;
    const span = Math.min(300, Math.max(60, this.ts)) / 60;
    const passes = this.passes.filter((p) => p.ts >= from);
    const changes = countSince(this.possChanges, from);
    const chain = passes.length / Math.max(1, changes);
    const turnoverRate = changes / span;
    const duelRate = countSince(this.duels, from) / span;
    const longShare = passes.length ? passes.filter((p) => p.long).length / passes.length : 0;
    const v = 50 + 7 * (chain - 4) - 6 * (turnoverRate - 2.5) - 5 * (duelRate - 2) - 70 * (longShare - 0.15);
    return round1(Math.max(0, Math.min(100, v)));
  }

  ppdaWindow(side: Side, from: number, to: number): number | null {
    const opp = otherSide(side);
    const oppPasses = this.passes.filter(
      (p) => p.side === opp && p.ts >= from && p.ts <= to && p.ax < 63,
    ).length;
    const defActions = this.defs.filter(
      (d) => d.side === side && d.ts >= from && d.ts <= to && d.ax > 42,
    ).length;
    if (defActions === 0) return oppPasses > 0 ? round1(oppPasses) : null;
    return round1(oppPasses / defActions);
  }

  teamWindow(side: Side, from: number, to: number): WindowStats {
    const passes = this.passes.filter((p) => p.side === side && p.ts >= from && p.ts <= to);
    const completed = passes.filter((p) => p.complete);
    const shots = this.shots.filter((s) => s.side === side && s.ts >= from && s.ts <= to);
    const high = this.turnovers.filter((t) => t.wonBy === side && t.ts >= from && t.ts <= to && t.ax > 70);
    const lost = this.turnovers.filter((t) => t.wonBy !== side && t.ts >= from && t.ts <= to);
    const defs = this.defs.filter((d) => d.side === side && d.ts >= from && d.ts <= to);
    const possH = this.possLog.filter((p) => p.ts >= from && p.ts <= to);
    const total = possH.reduce((a, p) => a + p.dur, 0);
    const mine = possH.filter((p) => p.side === side).reduce((a, p) => a + p.dur, 0);
    const keyPasses = this.events
      .filter((e) => e.type === 'shot' && e.team === side && e.ts >= from && e.ts <= to && e.assist_id)
      .map((e) => e.id);
    return {
      from_ts: Math.max(0, Math.round(from)),
      to_ts: Math.round(to),
      passes: passes.length,
      passes_completed: completed.length,
      pass_accuracy: passes.length ? round1((100 * completed.length) / passes.length) : null,
      avg_pass_difficulty: passes.length
        ? round2(passes.reduce((a, p) => a + p.difficulty, 0) / passes.length)
        : null,
      shots: shots.length,
      shots_on_target: shots.filter((s) => s.onTarget).length,
      xg: round2(shots.reduce((a, s) => a + s.xg, 0)),
      xt: round2(completed.reduce((a, p) => a + p.xt, 0)),
      ppda: this.ppdaWindow(side, from, to),
      def_actions: defs.length,
      high_turnovers: high.length,
      turnovers_lost: lost.length,
      final_third_entries: completed.filter((p) => {
        const e = this.byId.get(p.id);
        return e && e.type === 'pass' && p.ax <= 70 && att(side, e.end_x, e.end_y).ax > 70;
      }).length,
      possession_pct: total > 0 ? round1((100 * mine) / total) : null,
      event_ids: {
        shots: shots.map((s) => s.id),
        high_turnovers: high.map((t) => t.id),
        def_actions: defs.slice(-6).map((d) => d.id),
        key_passes: keyPasses,
      },
    };
  }

  /** Recent turnovers (ball wins), most recent last. */
  recentTurnovers(n: number): TurnoverLog[] {
    return this.turnovers.slice(-n);
  }

  recentShots(side: Side | null, n: number): ShotLog[] {
    return this.shots.filter((s) => !side || s.side === side).slice(-n);
  }

  playerStats(id: string): PlayerStats | undefined {
    const p = this.players.get(id);
    return p ? this.finalisePlayer(p) : undefined;
  }

  private finalisePlayer(
    p: PlayerStats & { _diffSum: number; _enter: number; _exit: number | null; _saves: number },
  ): PlayerStats {
    const end = p._exit ?? this.ts;
    const minutes = Math.max(0, (end - p._enter) / 60);
    const passAcc = p.passes ? p.passes_completed / p.passes : 0.8;
    let rating =
      6.0 +
      p.goals * 0.9 +
      p.assists * 0.6 +
      p.xg * 0.5 +
      p.xt * 1.2 +
      p.key_passes * 0.12 +
      (p.tackles + p.interceptions) * 0.05 +
      p._saves * 0.35 +
      (passAcc - 0.8) * 2 +
      (p.passes > 30 ? 0.2 : 0) -
      p.fouls * 0.05;
    const cardsRed = this.events.some(
      (e) => e.type === 'card' && e.player_id === p.player_id && e.color !== 'yellow',
    );
    if (cardsRed) rating -= 1.8;
    else if (p.cards) rating -= 0.3;
    if (minutes < 15) rating = 6 + (rating - 6) * 0.5;
    const { _diffSum, _enter, _exit, _saves, ...rest } = p as typeof p & { _sprinting?: boolean };
    delete (rest as { _sprinting?: boolean })._sprinting;
    void _enter;
    void _exit;
    void _saves;
    return {
      ...rest,
      minutes: round1(minutes),
      avg_pass_difficulty: p.passes ? round2(_diffSum / p.passes) : 0,
      hardest_pass: round2(p.hardest_pass),
      distance_m: Math.round(p.distance_m),
      top_speed_kmh: round1(p.top_speed_kmh),
      // Soft-compress so only outstanding games approach 10.
      rating: round1(Math.max(3, Math.min(10, 6.2 + 3.8 * Math.tanh((rating - 6.2) / 3.8)))),
    };
  }

  saves(id: string): number {
    return this.players.get(id)?._saves ?? 0;
  }

  // ───────────────────────────── snapshot ─────────────────────────────

  snapshot(): LiveState {
    const teams = { home: { ...this.teams.home }, away: { ...this.teams.away } };
    const possTotal = this.sums.home.possS + this.sums.away.possS;
    const ft = this.sums.home.finalThirdPasses + this.sums.away.finalThirdPasses;
    for (const s of ['home', 'away'] as const) {
      const T = teams[s];
      T.pass_accuracy = T.passes ? round1((100 * T.passes_completed) / T.passes) : 0;
      T.avg_pass_length = T.passes ? round1(this.sums[s].passLen / T.passes) : 0;
      T.avg_pass_difficulty = T.passes ? round2(this.sums[s].diff / T.passes) : 0;
      T.possession_pct = possTotal ? round1((100 * this.sums[s].possS) / possTotal) : 50;
      T.field_tilt = ft ? round1((100 * this.sums[s].finalThirdPasses) / ft) : 50;
      T.ppda = this.ppdaWindow(s, 0, this.ts);
      T.ppda_10 = this.ppdaWindow(s, this.ts - 600, this.ts);
      T.xg = round2(T.xg);
      T.xt = round2(T.xt);
      let dist = 0;
      for (const p of this.players.values()) if (p.side === s) dist += p.distance_m;
      T.distance_km = round1(dist / 1000);
    }
    const players: Record<string, PlayerStats> = {};
    for (const p of this.players.values()) players[p.player_id] = this.finalisePlayer(p);
    return {
      match_id: this.meta.match_id,
      ts: round1(this.ts),
      game_s: round1(this.gameS),
      period: this.period,
      minute_label: formatMinute(this.gameS, this.period),
      status: this.status,
      score: { ...this.score },
      possession: this.possession,
      ball: { ...this.ball },
      teams,
      players,
      momentum: this.momentum(),
      tempo: this.tempo(),
      control: this.control(),
      series: this.series,
      flags: this.flags.slice(-20),
      event_count: this.events.length,
      last_event_id: this.events.at(-1)?.id ?? null,
    };
  }
}

function countSince(sorted: number[], from: number): number {
  let n = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i] >= from; i--) n++;
  return n;
}
