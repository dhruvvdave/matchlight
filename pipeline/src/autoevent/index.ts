import type { MatchEvent, TrackingFrame } from '@matchlight/schema';

/**
 * EXPERIMENTAL "auto-eventing" stub (clearly labelled): derives pass / turnover / sprint events from
 * tracking-style coordinates alone (ball + player positions per frame), with no event feed.
 * This demonstrates the path toward computer-vision eventing: replace the synthetic frames with
 * positions from a video tracker and the same detector runs unchanged.
 *
 * Method (1 Hz, deliberately simple and explainable):
 *  1. Control: the nearest player to the ball "controls" it if within CONTROL_RADIUS and the ball is low.
 *  2. Pass: control moves from A to B on the same team (optionally via in-flight frames) => pass A->B.
 *     Control moves to the other team => turnover.
 *  3. Sprint: a player's speed crosses SPRINT_KMH (with hysteresis) => sprint event with peak speed.
 */
export interface DerivedEvent {
  kind: 'pass' | 'turnover' | 'sprint';
  ts: number;
  player_id: string;
  to_player_id?: string;
  x: number;
  y: number;
  end_x?: number;
  end_y?: number;
  peak_kmh?: number;
  confidence: number;
}

export const CONTROL_RADIUS = 3.0;
export const SPRINT_KMH = 25.2;

export function deriveEvents(frames: TrackingFrame[]): DerivedEvent[] {
  const out: DerivedEvent[] = [];
  let owner: { id: string; side: string; ts: number; x: number; y: number } | null = null;
  const sprinting = new Map<string, { start: number; peak: number; x: number; y: number }>();
  for (const f of frames) {
    // 1. control
    let best: TrackingFrame['players'][number] | null = null;
    let bestD = Infinity;
    for (const p of f.players) {
      const d = Math.hypot(p.x - f.ball.x, p.y - f.ball.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best && bestD <= CONTROL_RADIUS && f.ball.z < 1.5) {
      if (owner && owner.id !== best.id) {
        const gap = f.ts - owner.ts;
        const confidence = Math.max(
          0.2,
          Math.min(0.95, 1 - bestD / (CONTROL_RADIUS * 2) - Math.max(0, gap - 3) * 0.1),
        );
        out.push({
          kind: owner.side === best.side ? 'pass' : 'turnover',
          ts: owner.ts,
          player_id: owner.id,
          to_player_id: best.id,
          x: owner.x,
          y: owner.y,
          end_x: f.ball.x,
          end_y: f.ball.y,
          confidence: Math.round(confidence * 100) / 100,
        });
      }
      owner = { id: best.id, side: best.side, ts: f.ts, x: f.ball.x, y: f.ball.y };
    }
    // 3. sprints
    for (const p of f.players) {
      const s = sprinting.get(p.id);
      if (p.s >= SPRINT_KMH) {
        if (!s) sprinting.set(p.id, { start: f.ts, peak: p.s, x: p.x, y: p.y });
        else s.peak = Math.max(s.peak, p.s);
      } else if (s && p.s < SPRINT_KMH - 6) {
        out.push({
          kind: 'sprint',
          ts: s.start,
          player_id: p.id,
          x: s.x,
          y: s.y,
          end_x: p.x,
          end_y: p.y,
          peak_kmh: s.peak,
          confidence: 0.9,
        });
        sprinting.delete(p.id);
      }
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** Compare derived passes with the ground-truth event feed (passer + recipient within a time tolerance). */
export function evaluatePasses(derived: DerivedEvent[], truth: MatchEvent[], toleranceS = 3) {
  const truePasses = truth.filter(
    (e) => e.type === 'pass' && e.outcome === 'complete' && e.recipient_id,
  ) as Extract<MatchEvent, { type: 'pass' }>[];
  const found = derived.filter((d) => d.kind === 'pass');
  let tp = 0;
  const used = new Set<number>();
  for (const d of found) {
    const idx = truePasses.findIndex(
      (t, i) =>
        !used.has(i) &&
        t.player_id === d.player_id &&
        t.recipient_id === d.to_player_id &&
        Math.abs(t.ts - d.ts) <= toleranceS + 1,
    );
    if (idx >= 0) {
      used.add(idx);
      tp++;
    }
  }
  return {
    truth: truePasses.length,
    derived: found.length,
    true_positives: tp,
    precision: found.length ? tp / found.length : 0,
    recall: truePasses.length ? tp / truePasses.length : 0,
  };
}
