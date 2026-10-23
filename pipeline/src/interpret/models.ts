import type { EventOf, Side } from '@matchlight/schema';

/** Convert absolute pitch coords to `side`'s attacking coords (attacks towards ax = 105). */
export const att = (side: Side, x: number, y: number) =>
  side === 'home' ? { ax: x, ay: y } : { ax: 105 - x, ay: 68 - y };

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v));

export function goalAngle(ax: number, ay: number): number {
  const dx = Math.max(0.5, 105 - ax);
  return Math.abs(Math.atan2(34 + 3.66 - ay, dx) - Math.atan2(34 - 3.66 - ay, dx));
}

export const distToGoal = (ax: number, ay: number) => Math.hypot(105 - ax, 34 - ay);

/**
 * Expected goals: logistic model on distance, angle, body part, pressure and situation.
 * Coefficients were fitted against the synthetic league so cumulative xG tracks goals over many matches.
 */
export function xgModel(shot: EventOf<'shot'>): number {
  if (shot.situation === 'penalty') return 0.76;
  const side = shot.team ?? 'home';
  const { ax, ay } = att(side, shot.x ?? 90, shot.y ?? 34);
  const d = distToGoal(ax, ay);
  const angle = goalAngle(ax, ay);
  let logit = -1.25 - 0.1 * d + 1.3 * angle;
  if (shot.body_part === 'head') logit -= 0.55;
  if (shot.under_pressure) logit -= 0.25;
  if (shot.situation === 'counter') logit += 0.2;
  return round3(sigmoid(logit));
}

/**
 * xT-style threat surface: probability-weighted value of holding the ball at a location,
 * decaying with distance to goal and shrinking at tight angles. (A smooth parametric surrogate
 * of grid-based expected threat.)
 */
export function xtValue(ax: number, ay: number): number {
  const d = distToGoal(ax, ay);
  const angle = goalAngle(ax, ay);
  return 0.004 + 0.32 * Math.exp(-d / 13) * (0.35 + 0.65 * Math.min(1, angle / 0.9));
}

/** xT added by moving the ball from start to end (positive = more dangerous). */
export function xtDelta(side: Side, x: number, y: number, ex: number, ey: number): number {
  const a = att(side, x, y);
  const b = att(side, ex, ey);
  return round3(xtValue(b.ax, b.ay) - xtValue(a.ax, a.ay));
}

/**
 * Pass difficulty in [0, 1]: distance, forward angle, pressure, destination zone, height and pass type.
 * 0.15 = routine square ball; 0.8+ = defence-splitting pass under pressure.
 */
export function passDifficulty(pass: EventOf<'pass'>): number {
  const side = pass.team ?? 'home';
  const a = att(side, pass.x ?? 52.5, pass.y ?? 34);
  const b = att(side, pass.end_x, pass.end_y);
  const len = Math.hypot(b.ax - a.ax, b.ay - a.ay);
  const progress = b.ax - a.ax;
  let logit = -1.6 + 0.045 * (len - 15);
  if (len > 0) logit += 0.9 * Math.max(0, progress / len);
  if (pass.under_pressure) logit += 0.8;
  if (b.ax > 70) logit += 0.45;
  if (b.ax > 88.5 && Math.abs(b.ay - 34) < 20.16) logit += 0.45;
  if (pass.height === 'high') logit += 0.2;
  const kindAdj: Record<string, number> = {
    through: 0.7,
    cross: 0.55,
    switch: 0.35,
    back: -0.8,
    set_piece: -0.2,
  };
  logit += kindAdj[pass.pass_kind] ?? 0;
  return round3(sigmoid(logit));
}

export const inFinalThird = (side: Side, x: number, y: number) => att(side, x, y).ax > 70;
export const inBox = (side: Side, x: number, y: number) => {
  const { ax, ay } = att(side, x, y);
  return ax > 88.5 && Math.abs(ay - 34) < 20.16;
};

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const round3 = (v: number) => Math.round(v * 1000) / 1000;
