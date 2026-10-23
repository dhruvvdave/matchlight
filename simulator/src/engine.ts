import type { Formation, MatchEvent, MatchMeta, Player, Position, Side, Team, TeamStyle } from '@matchlight/schema';
import { otherSide } from '@matchlight/schema';
import { FORMATIONS, TEN_MAN_FORMATIONS, assignSlots, shapePosition, toAbs, toAtt, type Slot } from './formations.js';
import { Rng, clamp, round1, sigmoid } from './rng.js';
import type { Beat, ScenarioDef } from './scenarios.js';

interface PState {
  p: Player;
  side: Side;
  slot: Slot;
  energy: number;
  onPitch: boolean;
  yellow: number;
  sentOff: boolean;
  used: boolean;
}

interface TState {
  side: Side;
  team: Team;
  formation: Formation;
  style: TeamStyle;
  players: PState[];
  subsUsed: number;
  subWindows: number;
  lastSubMinute: number;
  natShiftDone: boolean;
}

interface Possession {
  side: Side;
  holder: PState;
  /** Ball in the possessing team's attacking coordinates. */
  ax: number;
  ay: number;
  pressure: boolean;
  startTs: number;
  startAx: number;
  passes: number;
  lastPasser?: PState;
  lastPassTs: number;
  lastPassKind?: string;
  fromSetPiece: boolean;
}

export interface LineupSnapshot {
  ts: number;
  side: Side;
  style: TeamStyle;
  players: { id: string; slot: Slot; pace: number; stamina: number }[];
}

interface Forced {
  team: Side;
  outcome: 'goal' | 'saved' | 'woodwork';
  prefer: Position[];
  deadline: number;
}

type Fields = Record<string, unknown>;

const GOAL_HALF_WIDTH = 3.66;

/** Football-flavoured, seeded, event-level match engine. */
export class MatchEngine {
  readonly events: MatchEvent[] = [];
  readonly lineups: LineupSnapshot[] = [];
  private seq = 0;
  private ts = 0;
  private gameS = 0;
  private period: 1 | 2 = 1;
  private possessionId = 0;
  private score = { home: 0, away: 0 };
  private momentum = 0;
  private teams: Record<Side, TState>;
  private poss!: Possession;
  private forced: Forced | null = null;
  private beats: (Beat & { done?: boolean })[];
  private pendingSubs: Extract<Beat, { kind: 'sub' }>[] = [];
  private pendingCards: Extract<Beat, { kind: 'card' }>[] = [];
  private lastFatigueTick = 0;

  constructor(
    private readonly meta: MatchMeta,
    private readonly scenario: ScenarioDef,
    private readonly rng: Rng,
  ) {
    const mk = (team: Team): TState => {
      const slots = FORMATIONS[team.formation];
      let i = 0;
      return {
        side: team.side,
        team,
        formation: team.formation,
        style: { ...team.style },
        players: team.players.map((p) => ({
          p,
          side: team.side,
          slot: p.starter ? slots[i++] : { pos: p.position, ax: 0, ay: 0 },
          energy: 1,
          onPitch: p.starter,
          yellow: 0,
          sentOff: false,
          used: p.starter,
        })),
        subsUsed: 0,
        subWindows: 0,
        lastSubMinute: -99,
        natShiftDone: false,
      };
    };
    this.teams = { home: mk(meta.home), away: mk(meta.away) };
    this.beats = scenario.beats.map((b) => ({ ...b }));
    this.snapshot('home');
    this.snapshot('away');
  }

  private snapshot(side: Side) {
    const st = this.teams[side];
    this.lineups.push({
      ts: this.ts,
      side,
      style: { ...st.style },
      players: this.onPitch(side).map((ps) => ({
        id: ps.p.id,
        slot: { ...ps.slot },
        pace: ps.p.attributes.pace,
        stamina: ps.p.attributes.stamina,
      })),
    });
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private get scripted() {
    return this.scenario.script === 'scripted';
  }

  private onPitch(side: Side): PState[] {
    return this.teams[side].players.filter((p) => p.onPitch);
  }

  private minute(): number {
    return this.gameS / 60;
  }

  private teamMomentum(side: Side): number {
    return side === 'home' ? this.momentum : -this.momentum;
  }

  private emit(type: MatchEvent['type'], side: Side | undefined, f: Fields): MatchEvent {
    const ev = {
      id: `e${String(this.seq).padStart(5, '0')}`,
      seq: this.seq++,
      match_id: this.meta.match_id,
      ts: Math.round(this.ts * 10) / 10,
      game_s: Math.round(this.gameS * 10) / 10,
      period: this.period,
      possession_id: this.possessionId,
      ...(side ? { team: side } : {}),
      type,
      ...f,
    } as MatchEvent;
    // Strip undefined so JSONL is compact and stable.
    for (const k of Object.keys(ev)) if ((ev as Fields)[k] === undefined) delete (ev as Fields)[k];
    this.events.push(ev);
    return ev;
  }

  /** Absolute position fields for a point given in `side`'s attacking coords. */
  private abs(side: Side, ax: number, ay: number, prefix = '') {
    const { x, y } = toAbs(side, clamp(ax, 0, 105), clamp(ay, 0, 68));
    return { [`${prefix}x`]: round1(x), [`${prefix}y`]: round1(y) };
  }

  private shape(side: Side, inPossession: boolean, ballAx: number, ballAy: number) {
    const t = this.teams[side];
    return this.onPitch(side).map((ps) => ({
      ps,
      ...shapePosition(ps.slot, {
        bx: ballAx,
        by: ballAy,
        inPossession,
        lineHeight: t.style.line_height,
        pressing: t.style.pressing,
      }),
    }));
  }

  /** Nearest defender (of the non-possessing side) to a point in the attacker's coords. */
  private nearestDefender(attSide: Side, ax: number, ay: number, excludeGk = true): PState {
    const defSide = otherSide(attSide);
    const dax = 105 - ax;
    const day = 68 - ay;
    const shape = this.shape(defSide, false, dax, day);
    let best = shape[0].ps;
    let bestD = Infinity;
    for (const s of shape) {
      if (excludeGk && s.ps.slot.pos === 'GK') continue;
      const d = Math.hypot(s.ax - dax, s.ay - day);
      if (d < bestD) {
        bestD = d;
        best = s.ps;
      }
    }
    return best;
  }

  private goalkeeper(side: Side): PState {
    return this.onPitch(side).find((p) => p.slot.pos === 'GK') ?? this.onPitch(side)[0];
  }

  private advance(dt: number) {
    this.ts += dt;
    this.gameS += dt;
    if (this.ts - this.lastFatigueTick >= 30) {
      const elapsed = this.ts - this.lastFatigueTick;
      this.lastFatigueTick = this.ts;
      for (const side of ['home', 'away'] as const) {
        const st = this.teams[side];
        for (const ps of this.onPitch(side)) {
          if (ps.slot.pos === 'GK') continue;
          const rate = 0.0042 * (1.25 - ps.p.attributes.stamina / 100) * (0.8 + 0.5 * st.style.pressing);
          ps.energy = Math.max(0.45, ps.energy - (rate * elapsed) / 60);
        }
      }
      this.updateMomentum(elapsed);
    }
  }

  private momentumTarget(): number {
    let target = 0;
    const m = this.minute();
    for (const b of this.beats) {
      if (b.kind === 'momentum' && m >= b.from && m <= b.to) target += (b.team === 'home' ? 1 : -1) * b.strength;
    }
    if (!this.scripted) target += clamp((this.score.away - this.score.home) * 0.12, -0.25, 0.25);
    return clamp(target, -0.9, 0.9);
  }

  private updateMomentum(elapsed: number) {
    const target = this.momentumTarget();
    const k = Math.min(1, elapsed / 240);
    this.momentum += (target - this.momentum) * k + this.rng.normal(0, 0.05);
    this.momentum = clamp(this.momentum, -1, 1);
  }

  private bump(side: Side, amount: number) {
    this.momentum = clamp(this.momentum + (side === 'home' ? amount : -amount), -1, 1);
  }

  // ───────────────────────────── possession ─────────────────────────────

  private setPossession(side: Side, holder: PState, ax: number, ay: number, fromSetPiece = false) {
    this.poss = {
      side,
      holder,
      ax: clamp(ax, 0.5, 104.5),
      ay: clamp(ay, 0.5, 67.5),
      pressure: false,
      startTs: this.ts,
      startAx: ax,
      passes: 0,
      lastPassTs: -99,
      fromSetPiece,
    };
  }

  /** Hand the ball to `newSide` at a point given in the *old* possessor's attacking coords. */
  private turnover(
    newSide: Side,
    oldAx: number,
    oldAy: number,
    reason: Extract<MatchEvent, { type: 'possession_change' }>['reason'],
    winner?: PState,
  ) {
    const ax = 105 - oldAx;
    const ay = 68 - oldAy;
    const holder = winner ?? this.nearestOwn(newSide, ax, ay);
    this.possessionId++;
    this.emit('possession_change', newSide, {
      player_id: holder.p.id,
      ...this.abs(newSide, ax, ay),
      from_team: otherSide(newSide),
      reason,
    });
    this.setPossession(newSide, holder, ax, ay);
  }

  private nearestOwn(side: Side, ax: number, ay: number, exclude?: PState): PState {
    const shape = this.shape(side, true, ax, ay);
    let best = shape[0].ps;
    let bestD = Infinity;
    for (const s of shape) {
      if (s.ps === exclude) continue;
      if (s.ps.slot.pos === 'GK' && ax > 20) continue;
      const d = Math.hypot(s.ax - ax, s.ay - ay);
      if (d < bestD) {
        bestD = d;
        best = s.ps;
      }
    }
    return best;
  }

  // ───────────────────────────── scripted beats ─────────────────────────────

  private processBeats() {
    const m = this.minute();
    const inPeriod = (minute: number) => (this.period === 1 ? minute < 46 : minute >= 45);
    for (const b of this.beats) {
      if (b.done || b.kind === 'momentum') continue;
      if (!inPeriod(b.minute)) continue;
      const lead = b.kind === 'goal' || b.kind === 'big_chance' ? 0.75 : 0;
      if (m < b.minute - lead) continue;
      b.done = true;
      switch (b.kind) {
        case 'goal':
          this.forced = { team: b.team, outcome: 'goal', prefer: b.prefer ?? ['ST'], deadline: this.gameS + 240 };
          break;
        case 'big_chance':
          this.forced = { team: b.team, outcome: b.outcome, prefer: ['ST', 'AM', 'LW', 'RW'], deadline: this.gameS + 240 };
          break;
        case 'sub':
          this.pendingSubs.push(b);
          break;
        case 'card':
          this.pendingCards.push(b);
          break;
        case 'shift':
          this.tacticalShift(b.team, b.formation, b.style, b.note);
          break;
      }
    }
  }

  private tacticalShift(side: Side, formation: Formation, style: Partial<TeamStyle>, note: string) {
    const st = this.teams[side];
    const from = st.formation;
    const pressingFrom = st.style.pressing;
    const onPitch = this.onPitch(side);
    let target = formation;
    if (onPitch.length < 11 && !TEN_MAN_FORMATIONS.includes(target)) target = '4-4-1';
    if (onPitch.length === 11 && TEN_MAN_FORMATIONS.includes(target)) target = '4-4-2';
    st.formation = target;
    Object.assign(st.style, style);
    assignSlots(onPitch, target);
    const gk = this.goalkeeper(side);
    this.emit('tactical_shift', side, {
      player_id: gk.p.id,
      formation_from: from,
      formation_to: target,
      pressing_from: Math.round(pressingFrom * 100) / 100,
      pressing_to: Math.round(st.style.pressing * 100) / 100,
      note,
    });
    this.snapshot(side);
  }

  /** Called at dead-ball moments: make pending scripted subs, and natural ones. */
  private deadBall() {
    for (const b of [...this.pendingSubs]) {
      this.pendingSubs.splice(this.pendingSubs.indexOf(b), 1);
      b.out.forEach((pos, i) => this.substitute(b.team, pos, b.in[i] ?? pos));
      this.teams[b.team].subWindows++;
      this.teams[b.team].lastSubMinute = this.minute();
    }
    const m = this.minute();
    for (const side of ['home', 'away'] as const) {
      const st = this.teams[side];
      if (this.period !== 2 || m < 58 || st.subsUsed >= 5 || st.subWindows >= 3) continue;
      if (m - st.lastSubMinute < 8) continue;
      const scriptedSoon = this.beats.some(
        (b) => b.kind === 'sub' && b.team === side && !b.done && Math.abs(b.minute - m) < 6,
      );
      if (scriptedSoon || !this.rng.chance(0.35)) continue;
      const tired = this.onPitch(side)
        .filter((p) => p.slot.pos !== 'GK')
        .sort((a, b) => a.energy - b.energy);
      const n = Math.min(this.rng.int(1, 2), 5 - st.subsUsed);
      for (let i = 0; i < n && i < tired.length; i++) {
        if (tired[i].energy > 0.85) continue;
        this.substitute(side, tired[i].slot.pos, tired[i].slot.pos, tired[i]);
      }
      st.subWindows++;
      st.lastSubMinute = m;
    }
  }

  private substitute(side: Side, outPos: Position, inPos: Position, who?: PState) {
    const st = this.teams[side];
    if (st.subsUsed >= 5) return;
    const out =
      who ??
      this.onPitch(side)
        .filter((p) => p.slot.pos === outPos || p.p.position === outPos)
        .sort((a, b) => a.energy - b.energy)[0] ??
      this.onPitch(side)
        .filter((p) => p.slot.pos !== 'GK')
        .sort((a, b) => a.energy - b.energy)[0];
    const bench = st.players.filter((p) => !p.used);
    const inn =
      bench.find((p) => p.p.position === inPos) ??
      bench.find((p) => p.p.position !== 'GK') ??
      undefined;
    if (!out || !inn) return;
    out.onPitch = false;
    inn.onPitch = true;
    inn.used = true;
    inn.slot = out.slot;
    inn.energy = 1;
    st.subsUsed++;
    if (this.poss?.holder === out) this.poss.holder = inn;
    const pos = toAbs(side, out.slot.ax, out.slot.ay < 34 ? 0.5 : 67.5);
    this.emit('substitution', side, {
      player_id: out.p.id,
      player_in_id: inn.p.id,
      x: round1(52.5),
      y: round1(pos.y < 34 ? 0 : 68),
    });
    this.snapshot(side);
    this.advance(25);
  }

  private natural() {
    if (this.scripted) return;
    const m = this.minute();
    for (const side of ['home', 'away'] as const) {
      const st = this.teams[side];
      if (st.natShiftDone || this.period !== 2 || m < 68) continue;
      const diff = this.score[side] - this.score[otherSide(side)];
      if (diff < 0) {
        st.natShiftDone = true;
        const formation = this.onPitch(side).length === 11 ? '4-2-4' : '4-4-1';
        this.tacticalShift(
          side,
          formation,
          { pressing: clamp(st.style.pressing + 0.3, 0, 1), line_height: clamp(st.style.line_height + 0.25, 0, 1), directness: 0.6 },
          'Chasing the game: more bodies forward and a higher press',
        );
      } else if (diff > 0 && m > 78 && this.rng.chance(0.02)) {
        st.natShiftDone = true;
        const formation = this.onPitch(side).length === 11 ? '5-4-1' : '5-3-1';
        this.tacticalShift(side, formation, { pressing: 0.2, line_height: 0.2 }, 'Protecting the lead with a back five');
      }
    }
  }

  // ───────────────────────────── main loop ─────────────────────────────

  run(): MatchEvent[] {
    for (const period of [1, 2] as const) {
      this.period = period;
      this.gameS = period === 1 ? 0 : 2700;
      const end = (period === 1 ? 2700 : 5400) + this.scenario.stoppage[period - 1] * 60 + this.rng.float(0, 40);
      this.emit('period_start', undefined, { score: { ...this.score } });
      this.kickoff(period === 1 ? 'home' : 'away');
      let guard = 0;
      while (this.gameS < end && guard++ < 20000) {
        this.processBeats();
        this.natural();
        if (this.forced && this.gameS > this.forced.deadline) this.forced = null;
        this.step();
      }
      this.forced = null;
      this.emit('period_end', undefined, { score: { ...this.score } });
      this.advance(1);
    }
    this.emit('match_end', undefined, { score: { ...this.score } });
    return this.events;
  }

  private kickoff(side: Side) {
    this.deadBall();
    const taker = this.onPitch(side).find((p) => ['ST', 'AM', 'CM'].includes(p.slot.pos)) ?? this.onPitch(side)[1];
    this.possessionId++;
    this.setPossession(side, taker, 52.5, 34);
    this.emit('set_piece', side, { player_id: taker.p.id, ...this.abs(side, 52.5, 34), kind: 'kickoff' });
    this.advance(1);
  }

  private step() {
    const pz = this.poss;
    const att = this.teams[pz.side];
    const defSide = otherSide(pz.side);
    const def = this.teams[defSide];
    const forcedFor = this.forced?.team === pz.side ? this.forced : null;
    const forcedAgainst = this.forced && this.forced.team !== pz.side ? this.forced : null;

    // Scripted card: the booked team must be defending.
    const card = this.pendingCards.find((c) => c.team === defSide);
    if (card) {
      this.pendingCards.splice(this.pendingCards.indexOf(card), 1);
      this.scriptedCard(card);
      return;
    }

    // ── 1. Defensive pressure ──
    const zone = pz.ax < 40 ? 0.42 : pz.ax < 70 ? 0.3 : 0.24;
    const boxCrowd = pz.ax > 86 && Math.abs(pz.ay - 34) < 22 ? 0.3 : pz.ax > 78 ? 0.12 : 0;
    let pPress = 0.08 + boxCrowd + def.style.pressing * zone + 0.06 * this.teamMomentum(defSide);
    if (forcedAgainst) pPress += 0.35;
    if (forcedFor) pPress *= 0.4;
    if (this.rng.chance(clamp(pPress, 0.03, 0.85))) {
      const presser = this.nearestDefender(pz.side, pz.ax, pz.ay);
      pz.pressure = true;
      this.emit('pressure', defSide, {
        player_id: presser.p.id,
        ...this.abs(pz.side, pz.ax + this.rng.float(-1.5, 1.5), pz.ay + this.rng.float(-1.5, 1.5)),
        opponent_id: pz.holder.p.id,
      });
      this.advance(this.rng.float(0.4, 1.2));

      // ── 2. Tackle attempt ──
      let pTackle = 0.2 + 0.12 * def.style.pressing + boxCrowd * 0.5;
      if (forcedAgainst) pTackle += 0.4;
      if (forcedFor) pTackle = 0.03;
      if (this.rng.chance(pTackle)) {
        if (!forcedAgainst && !forcedFor && this.rng.chance(pz.ax > 88 ? 0.1 : 0.3)) {
          this.foul(presser, pz.holder);
          return;
        }
        let pWin =
          0.52 +
          (presser.p.attributes.defending - pz.holder.p.attributes.pace) / 220 +
          0.1 * this.teamMomentum(defSide) +
          (1 - pz.holder.energy) * 0.2;
        if (forcedAgainst) pWin += 0.4;
        if (this.rng.chance(clamp(pWin, 0.1, 0.95))) {
          this.emit('tackle', defSide, {
            player_id: presser.p.id,
            ...this.abs(pz.side, pz.ax, pz.ay),
            opponent_id: pz.holder.p.id,
            outcome: 'won',
          });
          this.advance(this.rng.float(0.5, 1.5));
          this.turnover(defSide, pz.ax, pz.ay, 'tackle', presser);
          return;
        }
        this.emit('tackle', defSide, {
          player_id: presser.p.id,
          ...this.abs(pz.side, pz.ax, pz.ay),
          opponent_id: pz.holder.p.id,
          outcome: 'lost',
        });
        this.emit('dribble', pz.side, {
          player_id: pz.holder.p.id,
          ...this.abs(pz.side, pz.ax, pz.ay),
          opponent_id: presser.p.id,
          outcome: 'success',
          under_pressure: true,
        });
        pz.ax = clamp(pz.ax + this.rng.float(2, 6), 1, 104);
        pz.pressure = false;
        this.advance(this.rng.float(0.8, 1.6));
      }
    }

    // ── 3. Decide on-ball action ──
    const d = Math.hypot(105 - pz.ax, 34 - pz.ay);
    const angle = shotAngle(pz.ax, pz.ay);
    let pShot = 0;
    if (d < 32) {
      // Shot selection: most shots come from 8-20 m; long-range efforts are rarer, wide angles discourage shooting.
      pShot =
        0.72 *
        (0.04 + 0.45 * Math.exp(-(d - 8) / 8)) *
        (0.35 + 0.65 * Math.min(1, angle / 0.45)) *
        (1 + 0.5 * this.teamMomentum(pz.side));
      if (pz.lastPassKind === 'cross' && this.ts - pz.lastPassTs < 4) pShot += 0.35;
      if (pz.lastPassKind === 'through' && this.ts - pz.lastPassTs < 4) pShot += 0.25;
    }
    if (forcedFor) {
      if (pz.ax > 86 && Math.abs(pz.ay - 34) < 13) pShot = 0.92;
      else if (pz.ax > 80 && Math.abs(pz.ay - 34) < 10) pShot = 0.55;
      else pShot = 0;
    } else if (this.scripted && forcedAgainst) pShot *= 0.3;

    if (this.rng.chance(pShot)) return this.shoot();
    const pCarry = pz.pressure ? 0.08 : 0.16 + (pz.holder.p.attributes.pace - 70) / 300;
    if (this.rng.chance(clamp(pCarry, 0.05, 0.3))) return this.carry();
    return this.pass();
  }

  // ───────────────────────────── on-ball actions ─────────────────────────────

  private carry() {
    const pz = this.poss;
    const forcedFor = this.forced?.team === pz.side;
    const dist = this.rng.float(4, forcedFor ? 18 : 13);
    const dir = this.rng.normal(0, 0.6);
    const ex = clamp(pz.ax + Math.cos(dir) * dist, 1, pz.ax > 90 ? pz.ax + 2 : 98);
    const ey = clamp(pz.ay + Math.sin(dir) * dist * 0.7 + (34 - pz.ay) * 0.08, 1, 67);
    const speed = this.rng.float(4.5, 7.2) * (0.85 + 0.15 * pz.holder.energy);
    this.emit('carry', pz.side, {
      player_id: pz.holder.p.id,
      ...this.abs(pz.side, pz.ax, pz.ay),
      ...this.abs(pz.side, ex, ey, 'end_'),
      distance_m: round1(Math.hypot(ex - pz.ax, ey - pz.ay)),
      under_pressure: pz.pressure || undefined,
    });
    this.advance(dist / speed);
    pz.ax = ex;
    pz.ay = ey;
    pz.pressure = false;

    // Occasional take-on in the final third.
    if (pz.ax > 60 && this.rng.chance(0.14)) {
      const opp = this.nearestDefender(pz.side, pz.ax, pz.ay);
      let pWin = 0.48 + (pz.holder.p.attributes.pace - opp.p.attributes.defending) / 200;
      if (forcedFor) pWin = 0.95;
      const ok = this.rng.chance(clamp(pWin, 0.15, 0.9));
      this.emit('dribble', pz.side, {
        player_id: pz.holder.p.id,
        ...this.abs(pz.side, pz.ax, pz.ay),
        opponent_id: opp.p.id,
        outcome: ok ? 'success' : 'fail',
      });
      this.advance(this.rng.float(0.8, 1.8));
      if (ok) {
        pz.ax = clamp(pz.ax + this.rng.float(2, 5), 1, 104);
      } else {
        this.emit('tackle', otherSide(pz.side), {
          player_id: opp.p.id,
          ...this.abs(pz.side, pz.ax, pz.ay),
          opponent_id: pz.holder.p.id,
          outcome: 'won',
        });
        this.turnover(otherSide(pz.side), pz.ax, pz.ay, 'tackle', opp);
      }
    }
  }

  private pass(opts: { setPiece?: boolean; forceKind?: 'cross' | 'long' } = {}) {
    const pz = this.poss;
    const att = this.teams[pz.side];
    const defSide = otherSide(pz.side);
    const forcedFor = this.forced?.team === pz.side ? this.forced : null;
    const forcedAgainst = this.forced && this.forced.team !== pz.side;
    const shape = this.shape(pz.side, true, pz.ax, pz.ay).filter((s) => s.ps !== pz.holder);

    // Choose pass type & recipient.
    const wide = pz.ay < 15 || pz.ay > 53;
    let kind: string = 'short';
    let target: { ps: PState; ax: number; ay: number } | undefined;
    const forwards = shape.filter((s) => ['ST', 'LW', 'RW', 'AM'].includes(s.ps.slot.pos));
    const r = this.rng.next();
    if (opts.forceKind === 'cross' || (wide && pz.ax > 76 && r < 0.38 + (forcedFor ? 0.3 : 0))) {
      kind = 'cross';
      const pool = shape.filter((s) => ['ST', 'LW', 'RW', 'AM', 'CB', 'CM'].includes(s.ps.slot.pos));
      const tgt = this.rng.weighted(pool, pool.map((s) => (s.ps.slot.pos === 'ST' ? 3 : s.ps.slot.pos === 'CB' && opts.setPiece ? 2 : 1)));
      target = { ps: tgt.ps, ax: this.rng.float(88, 98.5), ay: this.rng.float(26, 42) };
    } else if (
      forwards.length &&
      pz.ax > 40 &&
      pz.ax < 85 &&
      r < 0.07 + 0.08 * att.style.directness + (forcedFor ? 0.25 : 0)
    ) {
      kind = 'through';
      const tgt = this.rng.pick(forwards);
      target = { ps: tgt.ps, ax: clamp(Math.max(tgt.ax, pz.ax) + this.rng.float(6, 14), 60, 94), ay: clamp(tgt.ay + this.rng.float(-6, 6), 14, 54) };
    } else if (
      opts.forceKind === 'long' ||
      (forwards.length && pz.ax < 45 && r < 0.03 + 0.14 * att.style.directness + (pz.pressure ? 0.08 : 0))
    ) {
      kind = 'long';
      const tgt = this.rng.pick(forwards);
      target = { ps: tgt.ps, ax: tgt.ax + this.rng.float(-3, 5), ay: tgt.ay + this.rng.float(-5, 5) };
    }
    if (!target) {
      const weights = shape.map((s) => {
        if (s.ps.slot.pos === 'GK' && (pz.ax > 40 || !pz.pressure)) return 0.02;
        const dist = Math.hypot(s.ax - pz.ax, s.ay - pz.ay);
        const progress = s.ax - pz.ax;
        let w = Math.exp(-dist / 12.5) * (dist < 5 ? 0.2 : 1);
        w *= progress > 0 ? 1 + (progress / 22) * (0.6 + att.style.directness) : progress < -5 ? 0.55 + (pz.pressure ? 0.5 : 0) : 1;
        if (forcedFor) w *= progress > 0 ? 2.5 + (forcedFor.prefer.includes(s.ps.slot.pos) ? 3 : 0) : 0.2;
        return w;
      });
      const tgt = this.rng.weighted(shape, weights);
      target = { ps: tgt.ps, ax: tgt.ax + this.rng.normal(0, 2.5), ay: tgt.ay + this.rng.normal(0, 2.5) };
    }
    target.ax = clamp(target.ax, 1, 104);
    target.ay = clamp(target.ay, 1, 67);

    const len = Math.hypot(target.ax - pz.ax, target.ay - pz.ay);
    const progress = target.ax - pz.ax;
    if (kind === 'short') {
      if (Math.abs(target.ay - pz.ay) > 32 && len > 30) kind = 'switch';
      else if (progress < -4) kind = 'back';
      else if (len > 32) kind = 'long';
      else if (progress > 10 || (target.ax > 70 && progress > 5)) kind = 'progressive';
    }
    if (opts.setPiece && kind !== 'cross') kind = 'set_piece';
    const height = kind === 'cross' || kind === 'long' || kind === 'switch' ? (this.rng.chance(0.75) ? 'high' : 'low') : len > 25 ? 'low' : 'ground';

    // Success model: distance, direction, pressure, zone, skill, fatigue, momentum.
    const passer = pz.holder;
    let p =
      0.965 -
      0.006 * Math.max(0, len - 8) -
      (pz.pressure ? 0.1 : 0) -
      (target.ax > 75 ? 0.07 : 0) -
      (progress > 15 ? 0.05 : 0) -
      (kind === 'through' ? 0.14 : 0) -
      (kind === 'cross' ? 0.32 : 0) +
      (kind === 'back' ? 0.04 : 0) +
      (passer.p.attributes.passing - 70) / 400 -
      (1 - passer.energy) * 0.12 +
      0.05 * this.teamMomentum(pz.side);
    if (forcedFor) p = Math.max(p, kind === 'cross' ? 0.75 : 0.97);
    if (forcedAgainst) p -= 0.25;
    p = clamp(p, 0.12, 0.985);
    const outcomeRoll = this.rng.next();
    const complete = outcomeRoll < p;

    const ballSpeed =
      kind === 'long' || kind === 'switch'
        ? this.rng.float(62, 92)
        : kind === 'cross'
          ? this.rng.float(58, 88)
          : kind === 'through'
            ? this.rng.float(45, 72)
            : clamp(28 + len * 1.3 + this.rng.normal(0, 6), 22, 80);
    const flight = len / (ballSpeed / 3.6) * (height === 'high' ? 1.25 : 1.05);
    const think = (2.4 - 1.5 * att.style.tempo) * this.rng.float(0.5, 1.4) * (pz.pressure ? 0.6 : 1);

    let outcome: 'complete' | 'incomplete' | 'out' = 'complete';
    let endAx = target.ax;
    let endAy = target.ay;
    if (!complete) {
      outcome = this.rng.chance(0.27) ? 'out' : 'incomplete';
      if (outcome === 'out') {
        const toward = target.ay < 34 ? 0 : 68;
        endAy = kind === 'cross' || kind === 'long' ? target.ay : toward;
        endAx = kind === 'cross' ? 105 : target.ax;
      } else {
        const f = this.rng.float(0.55, 0.92);
        endAx = pz.ax + (target.ax - pz.ax) * f;
        endAy = pz.ay + (target.ay - pz.ay) * f;
      }
    }
    // Offside on through balls.
    const offside = complete && kind === 'through' && !forcedFor && this.rng.chance(0.14);

    this.emit('pass', pz.side, {
      player_id: passer.p.id,
      ...this.abs(pz.side, pz.ax, pz.ay),
      ...this.abs(pz.side, endAx, endAy, 'end_'),
      recipient_id: complete ? target.ps.p.id : undefined,
      outcome,
      length_m: round1(Math.hypot(endAx - pz.ax, endAy - pz.ay)),
      height,
      pass_kind: kind,
      ball_speed_kmh: round1(ballSpeed),
      under_pressure: pz.pressure || undefined,
    });
    this.advance(think + flight);

    if (offside) {
      this.emit('offside', pz.side, { player_id: target.ps.p.id, ...this.abs(pz.side, endAx, endAy) });
      this.advance(this.rng.float(15, 28));
      this.turnover(defSide, endAx, endAy, 'offside');
      this.deadBall();
      this.restart('free_kick');
      return;
    }
    if (complete) {
      pz.lastPasser = passer;
      pz.lastPassTs = this.ts;
      pz.lastPassKind = kind;
      pz.holder = target.ps;
      pz.ax = endAx;
      pz.ay = endAy;
      pz.pressure = false;
      pz.passes++;
      return;
    }
    if (outcome === 'out') {
      const corner = endAx >= 104 || (kind === 'cross' && this.rng.chance(0.35));
      this.advance(this.rng.float(8, 18));
      if (corner && this.rng.chance(0.5)) {
        // Deflected behind by a defender -> corner to the attackers.
        this.deadBall();
        this.corner(pz.side, pz.ay < 34 ? 0.5 : 67.5);
        return;
      }
      this.turnover(defSide, clamp(endAx, 1, 104), endAy, 'out_of_play');
      this.deadBall();
      this.restart(endAx >= 100 ? 'goal_kick' : 'throw_in');
      return;
    }
    // Intercepted.
    const interceptor = this.nearestDefender(pz.side, endAx, endAy);
    const clear = endAx > 78 && this.rng.chance(0.35);
    this.emit(clear ? 'clearance' : 'interception', defSide, {
      player_id: interceptor.p.id,
      ...this.abs(pz.side, endAx, endAy),
    });
    this.advance(this.rng.float(0.5, 1.5));
    if (clear) {
      // Cleared: 55% the defending side secures it, otherwise the second ball returns to the attack.
      if (this.rng.chance(0.55)) this.turnover(defSide, clamp(endAx - this.rng.float(20, 35), 20, 80), endAy, 'clearance');
      else {
        pz.holder = this.nearestOwn(pz.side, endAx - 22, endAy);
        pz.ax = clamp(endAx - this.rng.float(18, 28), 40, 85);
        pz.pressure = true;
      }
      return;
    }
    this.turnover(defSide, endAx, endAy, 'interception', interceptor);
  }

  private shoot(situation?: 'set_piece' | 'penalty') {
    const pz = this.poss;
    const defSide = otherSide(pz.side);
    const shooter = pz.holder;
    const forcedFor = this.forced?.team === pz.side ? this.forced : null;
    const d = Math.hypot(105 - pz.ax, 34 - pz.ay);
    const angle = shotAngle(pz.ax, pz.ay);
    const header = pz.lastPassKind === 'cross' && this.ts - pz.lastPassTs < 4 && this.rng.chance(0.7);
    const body = header ? 'head' : this.rng.chance(0.68) ? 'right_foot' : 'left_foot';
    const counter = this.ts - pz.startTs < 14 && pz.startAx < 55 && pz.passes <= 4;
    const sit = situation ?? (pz.fromSetPiece && this.ts - pz.startTs < 12 ? 'set_piece' : counter ? 'counter' : 'open_play');
    const gk = this.goalkeeper(defSide);
    let pGoal =
      sigmoid(-0.9 - 0.1 * d + 1.3 * angle) *
      (0.45 + shooter.p.attributes.finishing / 330) *
      (header ? 0.6 : 1) *
      (pz.pressure ? 0.8 : 1) *
      (1.15 - gk.p.attributes.goalkeeping / 400);
    if (sit === 'penalty') pGoal = 0.78;

    let outcome: 'goal' | 'saved' | 'off_target' | 'blocked' | 'woodwork';
    if (forcedFor) {
      outcome = forcedFor.outcome;
      this.forced = null;
    } else {
      const roll = this.rng.next();
      const pBlock = 0.22 + (pz.pressure ? 0.1 : 0) + (d > 18 ? 0.06 : 0);
      if (roll < pGoal) outcome = 'goal';
      else if (roll < pGoal + pBlock) outcome = 'blocked';
      else if (roll < pGoal + pBlock + 0.21) outcome = 'saved';
      else if (roll < pGoal + pBlock + 0.235) outcome = 'woodwork';
      else outcome = 'off_target';
      if (outcome === 'goal' && this.scripted) outcome = this.rng.chance(0.6) ? 'saved' : 'off_target';
    }
    const speed = header ? this.rng.float(38, 68) : clamp(this.rng.normal(d > 18 ? 98 : 84, 12), 55, 128);
    const endY =
      outcome === 'goal' || outcome === 'saved'
        ? 34 + this.rng.float(-GOAL_HALF_WIDTH + 0.3, GOAL_HALF_WIDTH - 0.3)
        : outcome === 'woodwork'
          ? 34 + (this.rng.chance(0.5) ? 1 : -1) * GOAL_HALF_WIDTH
          : outcome === 'blocked'
            ? pz.ay + (34 - pz.ay) * 0.2
            : 34 + (this.rng.chance(0.5) ? 1 : -1) * this.rng.float(4.2, 12);
    const endX = outcome === 'blocked' ? clamp(pz.ax + 2.5, 0, 104) : 105;
    const assist =
      pz.lastPasser && this.ts - pz.lastPassTs < 8 && pz.lastPasser !== shooter ? pz.lastPasser : undefined;
    const shot = this.emit('shot', pz.side, {
      player_id: shooter.p.id,
      ...this.abs(pz.side, pz.ax, pz.ay),
      ...this.abs(pz.side, endX, clamp(endY, 0, 68), 'end_'),
      outcome,
      body_part: body,
      situation: sit,
      ball_speed_kmh: round1(speed),
      assist_id: assist?.p.id,
      goalkeeper_id: gk.p.id,
      under_pressure: pz.pressure || undefined,
    });
    this.advance(Math.max(0.4, d / (speed / 3.6)));
    this.bump(pz.side, 0.05 + pGoal * 0.25);

    if (outcome === 'goal') {
      this.score[pz.side]++;
      this.emit('goal', pz.side, {
        player_id: shooter.p.id,
        ...this.abs(pz.side, 105, clamp(endY, 0, 68)),
        shot_event_id: shot.id,
        assist_id: assist?.p.id,
        score: { ...this.score },
      });
      this.bump(pz.side, 0.25);
      this.advance(this.rng.float(50, 75));
      this.kickoff(defSide);
      return;
    }
    if (outcome === 'saved') {
      this.emit('save', defSide, { player_id: gk.p.id, ...this.abs(pz.side, 103.5, clamp(endY, 30, 38)), shot_event_id: shot.id });
      this.advance(this.rng.float(1, 3));
      if (this.rng.chance(0.38)) {
        this.advance(this.rng.float(10, 20));
        this.deadBall();
        this.corner(pz.side, this.rng.chance(0.5) ? 0.5 : 67.5);
        return;
      }
      this.turnover(defSide, 100, 34, 'save', gk);
      this.advance(this.rng.float(3, 8));
      return;
    }
    if (outcome === 'blocked') {
      const blocker = this.nearestDefender(pz.side, pz.ax + 2, pz.ay);
      this.emit('block', defSide, { player_id: blocker.p.id, ...this.abs(pz.side, endX, endY), shot_event_id: shot.id });
      this.advance(this.rng.float(0.5, 1.5));
      const r = this.rng.next();
      if (r < 0.35) {
        this.advance(this.rng.float(10, 20));
        this.deadBall();
        this.corner(pz.side, pz.ay < 34 ? 0.5 : 67.5);
      } else if (r < 0.65) {
        pz.holder = this.nearestOwn(pz.side, pz.ax - 10, pz.ay, shooter);
        pz.ax = clamp(pz.ax - this.rng.float(6, 14), 50, 95);
        pz.pressure = true;
      } else {
        this.turnover(defSide, pz.ax + 2, pz.ay, 'clearance', blocker);
      }
      return;
    }
    // Off target / woodwork -> goal kick.
    this.advance(this.rng.float(14, 26));
    this.turnover(defSide, 104, 34, 'out_of_play', gk);
    this.deadBall();
    this.restart('goal_kick');
  }

  private corner(side: Side, ay: number) {
    const taker =
      this.onPitch(side).find((p) => ['LW', 'RW', 'LM', 'RM', 'AM'].includes(p.slot.pos)) ?? this.onPitch(side)[5];
    this.possessionId++;
    this.setPossession(side, taker, 104.5, ay, true);
    this.emit('set_piece', side, { player_id: taker.p.id, ...this.abs(side, 104.5, ay), kind: 'corner' });
    this.advance(this.rng.float(2, 5));
    this.pass({ setPiece: true, forceKind: 'cross' });
  }

  /** Restart after possession has already been assigned (goal kick / throw-in / free kick). */
  private restart(kind: 'goal_kick' | 'throw_in' | 'free_kick') {
    const pz = this.poss;
    if (kind === 'goal_kick') {
      const gk = this.goalkeeper(pz.side);
      pz.holder = gk;
      pz.ax = 6;
      pz.ay = 34;
    }
    if (kind === 'throw_in') pz.ay = pz.ay < 34 ? 0.5 : 67.5;
    pz.fromSetPiece = true;
    this.emit('set_piece', pz.side, { player_id: pz.holder.p.id, ...this.abs(pz.side, pz.ax, pz.ay), kind });
    this.advance(this.rng.float(2, 5));
    if (kind === 'goal_kick') this.pass({ setPiece: true, forceKind: this.rng.chance(this.teams[pz.side].style.directness) ? 'long' : undefined });
    else this.pass({ setPiece: true });
  }

  private foul(offender: PState, victim: PState) {
    const pz = this.poss;
    const defSide = offender.side;
    this.emit('foul', defSide, {
      player_id: offender.p.id,
      ...this.abs(pz.side, pz.ax, pz.ay),
      opponent_id: victim.p.id,
    });
    this.advance(this.rng.float(2, 4));
    this.bump(pz.side, 0.03);
    if (this.scripted) {
      if (offender.yellow === 0 && this.rng.chance(0.1)) this.card(offender, 'yellow', 'Reckless challenge');
    } else if (this.rng.chance(0.004)) this.card(offender, 'red', 'Serious foul play');
    else if (this.rng.chance(0.13)) this.card(offender, offender.yellow ? 'second_yellow' : 'yellow', 'Reckless challenge');
    this.advance(this.rng.float(12, 26));
    this.deadBall();
    this.freeKick();
  }

  private freeKick() {
    const pz = this.poss;
    this.possessionId++;
    this.setPossession(pz.side, pz.holder, pz.ax, pz.ay, true);
    const d = Math.hypot(105 - pz.ax, 34 - pz.ay);
    const inBox = pz.ax > 88.5 && Math.abs(pz.ay - 34) < 20;
    if (inBox && !this.scripted && this.rng.chance(0.45)) {
      const taker = this.onPitch(pz.side).find((p) => p.slot.pos === 'ST') ?? pz.holder;
      pz.holder = taker;
      pz.ax = 94;
      pz.ay = 34;
      this.emit('set_piece', pz.side, { player_id: taker.p.id, ...this.abs(pz.side, 94, 34), kind: 'penalty' });
      this.advance(this.rng.float(40, 70));
      this.shoot('penalty');
      return;
    }
    this.emit('set_piece', pz.side, { player_id: pz.holder.p.id, ...this.abs(pz.side, pz.ax, pz.ay), kind: 'free_kick' });
    this.advance(this.rng.float(2, 6));
    if (d < 28 && Math.abs(pz.ay - 34) < 15 && this.rng.chance(0.35)) {
      const taker = this.onPitch(pz.side).sort((a, b) => b.p.attributes.finishing - a.p.attributes.finishing)[0];
      pz.holder = taker;
      this.shoot('set_piece');
      return;
    }
    if (pz.ax > 72 && (pz.ay < 20 || pz.ay > 48)) this.pass({ setPiece: true, forceKind: 'cross' });
    else this.pass({ setPiece: true });
  }

  private card(ps: PState, color: 'yellow' | 'second_yellow' | 'red', reason: string) {
    const pz = this.poss;
    if (color === 'yellow') ps.yellow = 1;
    this.emit('card', ps.side, {
      player_id: ps.p.id,
      ...this.abs(pz.side, pz.ax, pz.ay),
      color,
      reason: color === 'second_yellow' ? 'Second bookable offence' : reason,
    });
    this.advance(this.rng.float(20, 35));
    if (color !== 'yellow') {
      ps.sentOff = true;
      ps.onPitch = false;
      this.bump(ps.side, -0.35);
      const st = this.teams[ps.side];
      const scriptedShiftSoon = this.beats.some(
        (b) => b.kind === 'shift' && b.team === ps.side && !b.done && b.minute - this.minute() < 2,
      );
      if (!scriptedShiftSoon) {
        const to: Formation = st.formation === '5-4-1' || st.formation === '3-5-2' ? '5-3-1' : '4-4-1';
        this.tacticalShift(ps.side, to, { pressing: clamp(st.style.pressing - 0.2, 0.1, 1) }, 'Reshuffle after the red card');
      } else {
        assignSlots(this.onPitch(ps.side), st.formation);
        this.snapshot(ps.side);
      }
    }
  }

  private scriptedCard(b: Extract<Beat, { kind: 'card' }>) {
    const pz = this.poss;
    const candidates = this.onPitch(b.team).filter((p) => p.slot.pos === b.pos || p.p.position === b.pos);
    let offender =
      b.color === 'second_yellow'
        ? (this.onPitch(b.team).find((p) => p.yellow > 0 && (p.slot.pos === b.pos || p.p.position === b.pos)) ??
          this.onPitch(b.team).find((p) => p.yellow > 0))
        : candidates.find((p) => p.yellow === 0);
    offender ??= this.nearestDefender(pz.side, pz.ax, pz.ay);
    this.emit('foul', b.team, { player_id: offender.p.id, ...this.abs(pz.side, pz.ax, pz.ay), opponent_id: pz.holder.p.id });
    this.advance(this.rng.float(2, 4));
    this.card(offender, b.color === 'second_yellow' && offender.yellow === 0 ? 'red' : b.color, 'Tactical foul to stop a break');
    this.advance(this.rng.float(5, 12));
    this.deadBall();
    this.freeKick();
  }
}

/** Angle (radians) subtended by the goal mouth from a point in attacking coords. */
export function shotAngle(ax: number, ay: number): number {
  const dx = Math.max(0.5, 105 - ax);
  const a1 = Math.atan2(34 + GOAL_HALF_WIDTH - ay, dx);
  const a2 = Math.atan2(34 - GOAL_HALF_WIDTH - ay, dx);
  return Math.abs(a1 - a2);
}
