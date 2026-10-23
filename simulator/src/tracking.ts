import type { MatchEvent, Side, TrackingFrame } from '@matchlight/schema';
import { otherSide } from '@matchlight/schema';
import { shapePosition, toAbs, toAtt } from './formations.js';
import type { LineupSnapshot } from './engine.js';
import { clamp, round1 } from './rng.js';

const ON_BALL = new Set(['pass', 'carry', 'dribble', 'shot', 'set_piece', 'possession_change']);
const DEF_ACTIONS = new Set(['pressure', 'tackle', 'interception', 'clearance', 'block', 'foul', 'save']);

interface BallKey {
  ts: number;
  x: number;
  y: number;
  peak: number;
}

/**
 * Synthesises 1 Hz tracking data (ball + 22 players) that is consistent with the event stream:
 * players hold formation shape relative to the ball, the actor of each event arrives at its location,
 * and movement is speed-limited by each player's pace and fatigue. Also back-fills `player_speed_kmh`.
 */
export function generateTracking(
  matchId: string,
  events: MatchEvent[],
  lineups: LineupSnapshot[],
): TrackingFrame[] {
  const frames: TrackingFrame[] = [];
  if (!events.length) return frames;
  const endTs = events[events.length - 1].ts;

  // Ball keyframes.
  const keys: BallKey[] = [];
  for (const e of events) {
    if (e.x === undefined || e.y === undefined) continue;
    keys.push({ ts: e.ts, x: e.x, y: e.y, peak: 0 });
    if ((e.type === 'pass' || e.type === 'shot') && e.end_x !== undefined && e.end_y !== undefined) {
      const len = Math.hypot(e.end_x - e.x, e.end_y - e.y);
      const flight = len / Math.max(5, e.ball_speed_kmh / 3.6);
      const peak =
        e.type === 'pass' && e.height === 'high'
          ? Math.min(12, len * 0.18)
          : e.type === 'pass' && e.height === 'low'
            ? 1.2
            : 0;
      keys[keys.length - 1].peak = peak;
      keys.push({ ts: e.ts + flight, x: e.end_x, y: e.end_y, peak: 0 });
    }
    if (e.type === 'carry') keys.push({ ts: e.ts + e.distance_m / 5.5, x: e.end_x, y: e.end_y, peak: 0 });
  }
  keys.sort((a, b) => a.ts - b.ts);

  const pos = new Map<string, { x: number; y: number }>();
  const vel = new Map<string, { x: number; y: number }>();
  const phase = new Map<string, number>();
  let ki = 0;
  let sbx = 52.5;
  let sby = 34;
  let ei = 0;
  let possession: Side | null = 'home';
  let lastClock = events[0];
  const lineupAt = (side: Side, ts: number) => {
    let cur = lineups.find((l) => l.side === side)!;
    for (const l of lineups) if (l.side === side && l.ts <= ts) cur = l;
    return cur;
  };
  const sentOff = new Set<string>();
  const speedAt = new Map<number, Map<string, number>>();

  for (let s = 0; s <= Math.ceil(endTs); s++) {
    while (ei < events.length && events[ei].ts <= s) {
      const e = events[ei];
      lastClock = e;
      if (e.team && ON_BALL.has(e.type)) possession = e.team;
      if (e.type === 'card' && e.color !== 'yellow' && e.player_id) sentOff.add(e.player_id);
      ei++;
    }
    // Ball position by interpolating keyframes.
    while (ki < keys.length - 1 && keys[ki + 1].ts <= s) ki++;
    const k0 = keys[ki];
    const k1 = keys[Math.min(ki + 1, keys.length - 1)];
    const f = k1.ts > k0.ts ? clamp((s - k0.ts) / (k1.ts - k0.ts), 0, 1) : 0;
    const bx = k0.x + (k1.x - k0.x) * f;
    const by = k0.y + (k1.y - k0.y) * f;
    const bz = k0.peak * 4 * f * (1 - f);

    // Upcoming actors get pulled toward the event location.
    const pulls = new Map<string, { x: number; y: number; w: number }>();
    for (let j = ei; j < events.length && events[j].ts <= s + 2.5; j++) {
      const e = events[j];
      if (
        e.player_id &&
        e.x !== undefined &&
        e.y !== undefined &&
        (ON_BALL.has(e.type) || DEF_ACTIONS.has(e.type))
      ) {
        if (!pulls.has(e.player_id))
          pulls.set(e.player_id, { x: e.x, y: e.y, w: e.ts - s < 1.2 ? 0.9 : 0.45 });
      }
      if (e.type === 'pass' && e.recipient_id && !pulls.has(e.recipient_id)) {
        pulls.set(e.recipient_id, { x: e.end_x, y: e.end_y, w: 0.6 });
      }
    }

    // Teams react to the ball with a lag: shape follows a smoothed ball, not every flick of it.
    sbx = s === 0 ? bx : sbx + (bx - sbx) * 0.35;
    sby = s === 0 ? by : sby + (by - sby) * 0.35;
    const players: TrackingFrame['players'] = [];
    const speeds = new Map<string, number>();
    for (const side of ['home', 'away'] as const) {
      const lu = lineupAt(side, s);
      const inPoss = possession === side;
      const b = toAtt(side, sbx, sby);
      for (const pl of lu.players) {
        if (sentOff.has(pl.id)) continue;
        const sp = shapePosition(pl.slot, {
          bx: b.ax,
          by: b.ay,
          inPossession: inPoss,
          lineHeight: lu.style.line_height,
          pressing: lu.style.pressing,
        });
        let ph = phase.get(pl.id);
        if (ph === undefined) {
          ph = (hash(pl.id) % 1000) / 159;
          phase.set(pl.id, ph);
        }
        // Off-ball movement: slow drifting runs around the shape position.
        const wig = pl.slot.pos === 'GK' ? 0.8 : 4.2;
        const t = s / 5;
        let target = toAbs(
          side,
          sp.ax + wig * Math.sin(t + ph) + 1.5 * Math.sin(t * 2.7 + ph * 2),
          sp.ay + wig * Math.cos(t * 0.8 + ph),
        );
        const pull = pulls.get(pl.id);
        if (pull)
          target = { x: target.x + (pull.x - target.x) * pull.w, y: target.y + (pull.y - target.y) * pull.w };
        let cur = pos.get(pl.id);
        if (!cur || s === 0 || (lastClock.type === 'period_start' && lastClock.ts >= s - 1))
          cur = { ...target };
        const minutes = lastClock.game_s / 60;
        const fatigue = 1 - 0.18 * clamp(minutes / 95, 0, 1) * (1.3 - pl.stamina / 100);
        const vmax = ((pl.pace / 100) * 4.6 + 5.1) * fatigue; // m/s: pace 50 -> 7.4, pace 95 -> 9.5
        // Desired velocity toward the target, then acceleration-limited (~3 m/s^2) for smooth, human movement.
        let dvx = (target.x - cur.x) * 0.5;
        let dvy = (target.y - cur.y) * 0.5;
        const dv = Math.hypot(dvx, dvy);
        if (dv > vmax) {
          dvx = (dvx / dv) * vmax;
          dvy = (dvy / dv) * vmax;
        }
        const v0 = vel.get(pl.id) ?? { x: 0, y: 0 };
        let ax = dvx - v0.x;
        let ay = dvy - v0.y;
        const a = Math.hypot(ax, ay);
        const amax = 3.2;
        if (a > amax) {
          ax = (ax / a) * amax;
          ay = (ay / a) * amax;
        }
        const v1 = { x: v0.x + ax, y: v0.y + ay };
        vel.set(pl.id, v1);
        const next = { x: clamp(cur.x + v1.x, 0, 105), y: clamp(cur.y + v1.y, 0, 68) };
        pos.set(pl.id, next);
        const kmh = round1(Math.hypot(next.x - cur.x, next.y - cur.y) * 3.6);
        speeds.set(pl.id, kmh);
        players.push({ id: pl.id, side, x: round1(next.x), y: round1(next.y), s: kmh });
      }
    }
    speedAt.set(s, speeds);
    const game_s = lastClock.game_s + Math.max(0, s - lastClock.ts);
    frames.push({
      match_id: matchId,
      ts: s,
      game_s: round1(game_s),
      period: lastClock.period,
      ball: { x: round1(clamp(bx, 0, 105)), y: round1(clamp(by, 0, 68)), z: round1(bz) },
      possession,
      players,
    });
  }

  // Back-fill actor speed onto events.
  for (const e of events) {
    if (!e.player_id || !(ON_BALL.has(e.type) || DEF_ACTIONS.has(e.type))) continue;
    const a = speedAt.get(Math.floor(e.ts))?.get(e.player_id);
    const b = speedAt.get(Math.ceil(e.ts))?.get(e.player_id);
    const v = Math.max(a ?? 0, b ?? 0);
    if (a !== undefined || b !== undefined) (e as { player_speed_kmh?: number }).player_speed_kmh = v;
  }
  return frames;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export { otherSide };
