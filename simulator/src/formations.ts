import type { Formation, Position } from '@matchlight/schema';
import { clamp } from './rng.js';

/** A slot in a formation, in *attacking coordinates* (team attacks towards ax = 105; ay = 68 is the left touchline). */
export interface Slot {
  pos: Position;
  ax: number;
  ay: number;
}

const s = (pos: Position, ax: number, ay: number): Slot => ({ pos, ax, ay });
const GK = s('GK', 5, 34);
const BACK4 = [s('RB', 33, 9), s('CB', 28, 25), s('CB', 28, 43), s('LB', 33, 59)];
const BACK5 = [s('RWB', 36, 6), s('CB', 27, 20), s('CB', 25, 34), s('CB', 27, 48), s('LWB', 36, 62)];

export const FORMATIONS: Record<Formation, Slot[]> = {
  '4-3-3': [GK, ...BACK4, s('DM', 44, 34), s('CM', 54, 21), s('CM', 54, 47), s('RW', 73, 9), s('ST', 79, 34), s('LW', 73, 59)],
  '4-2-3-1': [GK, ...BACK4, s('DM', 45, 26), s('DM', 45, 42), s('RW', 66, 11), s('AM', 66, 34), s('LW', 66, 57), s('ST', 79, 34)],
  '4-4-2': [GK, ...BACK4, s('RM', 55, 9), s('CM', 50, 27), s('CM', 50, 41), s('LM', 55, 59), s('ST', 76, 28), s('ST', 76, 40)],
  '3-5-2': [
    GK, s('CB', 28, 18), s('CB', 26, 34), s('CB', 28, 50), s('RWB', 53, 6), s('CM', 52, 23), s('DM', 45, 34),
    s('CM', 52, 45), s('LWB', 53, 62), s('ST', 77, 28), s('ST', 77, 40),
  ],
  '5-4-1': [GK, ...BACK5, s('RM', 50, 13), s('CM', 46, 28), s('CM', 46, 40), s('LM', 50, 55), s('ST', 70, 34)],
  '4-2-4': [GK, ...BACK4, s('CM', 50, 26), s('CM', 50, 42), s('RW', 75, 9), s('ST', 81, 28), s('ST', 81, 40), s('LW', 75, 59)],
  /** 10-man shapes used after a red card. */
  '4-4-1': [GK, ...BACK4, s('RM', 50, 11), s('CM', 46, 27), s('CM', 46, 41), s('LM', 50, 57), s('ST', 72, 34)],
  '5-3-1': [GK, ...BACK5, s('CM', 47, 22), s('CM', 45, 34), s('CM', 47, 46), s('ST', 70, 34)],
};

export const TEN_MAN_FORMATIONS: readonly Formation[] = ['4-4-1', '5-3-1'];

export interface ShapeContext {
  /** Ball in this team's attacking coordinates. */
  bx: number;
  by: number;
  inPossession: boolean;
  lineHeight: number;
  pressing: number;
}

/**
 * Where a slot "wants" to be given the ball position. Shared by the event engine (to place
 * receivers/defenders) and the tracking generator (to move players), so both stay consistent.
 */
export function shapePosition(slot: Slot, ctx: ShapeContext): { ax: number; ay: number } {
  const { bx, by, inPossession, lineHeight, pressing } = ctx;
  if (slot.pos === 'GK') {
    const cx = inPossession ? 6 + Math.max(0, bx - 50) * 0.18 : 4 + Math.max(0, bx - 60) * 0.1;
    return { ax: clamp(cx, 2, 20), ay: clamp(34 + (by - 34) * 0.15, 28, 40) };
  }
  // Team block centre (ax) follows the ball; when defending it sits behind the ball, higher with a high line.
  const centre = inPossession
    ? clamp(bx - 6 + lineHeight * 6, 32, 78)
    : clamp(bx - 22 + lineHeight * 12 + pressing * 8, 20, 64);
  const depthSpread = inPossession ? 0.95 : 0.62;
  const widthSpread = inPossession ? 1.0 : 0.72;
  const ax = centre + (slot.ax - 50) * depthSpread;
  const ay = 34 + (slot.ay - 34) * widthSpread + (by - 34) * (inPossession ? 0.18 : 0.32);
  // Attackers hold the line around the penalty spot rather than standing on the goal line.
  return { ax: clamp(ax, 3, inPossession ? 92 : 102), ay: clamp(ay, 2, 66) };
}

export const toAbs = (side: 'home' | 'away', ax: number, ay: number) =>
  side === 'home' ? { x: ax, y: ay } : { x: 105 - ax, y: 68 - ay };
export const toAtt = (side: 'home' | 'away', x: number, y: number) =>
  side === 'home' ? { ax: x, ay: y } : { ax: 105 - x, ay: 68 - y };

/** Greedily re-map players to the slots of a new formation, keeping each near their previous spot. */
export function assignSlots<T extends { slot: Slot }>(players: T[], formation: Formation): void {
  const slots = [...FORMATIONS[formation]];
  const remaining = [...players];
  const gkIdx = remaining.findIndex((p) => p.slot.pos === 'GK');
  if (gkIdx >= 0) {
    remaining[gkIdx].slot = slots.shift()!;
    remaining.splice(gkIdx, 1);
  } else {
    slots.shift();
  }
  const order = slots.map((sl, i) => ({ sl, i })).sort((a, b) => b.sl.ax - a.sl.ax);
  for (const { sl } of order) {
    if (!remaining.length) break;
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((p, i) => {
      const d = Math.hypot(p.slot.ax - sl.ax, (p.slot.ay - sl.ay) * 0.8);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    remaining[best].slot = sl;
    remaining.splice(best, 1);
  }
}
