import { describe, expect, it } from 'vitest';
import { MatchEvent, StreamRecord, TrackingFrame } from '@matchlight/schema';
import { simulateMatch, toJsonl, toStream } from '@matchlight/simulator';
import { createHash } from 'node:crypto';
import { sim } from './helpers.js';

const finalScore = (events: MatchEvent[]) => {
  const end = events.at(-1)!;
  if (end.type !== 'match_end') throw new Error('stream must end with match_end');
  return end.score;
};

describe('simulator', () => {
  it('is deterministic for a given scenario + seed (byte-identical JSONL)', () => {
    const a = simulateMatch({ scenario: 'random', seed: 77 });
    const b = simulateMatch({ scenario: 'random', seed: 77 });
    const h = (s: string) => createHash('sha256').update(s).digest('hex');
    expect(h(toJsonl(a))).toBe(h(toJsonl(b)));
  });

  it('produces different matches for different seeds', () => {
    const a = simulateMatch({ scenario: 'random', seed: 1, tracking: false });
    const b = simulateMatch({ scenario: 'random', seed: 2, tracking: false });
    expect(a.events.length === b.events.length && JSON.stringify(a.events) === JSON.stringify(b.events)).toBe(
      false,
    );
  });

  it.each([
    ['late-comeback', { home: 3, away: 2 }],
    ['red-card-collapse', { home: 1, away: 4 }],
    ['tactical-stalemate', { home: 0, away: 0 }],
  ] as const)('seeded scenario %s tells its story (final score)', (scenario, score) => {
    expect(finalScore(sim(scenario).events)).toEqual(score);
  });

  it('late comeback: away lead 0-2 at the hour, then a home sub + press switch', () => {
    const { events } = sim('late-comeback');
    const goals = events.filter((e) => e.type === 'goal');
    expect(goals.slice(0, 2).every((g) => g.team === 'away')).toBe(true);
    expect(goals.slice(2).every((g) => g.team === 'home')).toBe(true);
    const shift = events.find((e) => e.type === 'tactical_shift' && e.team === 'home');
    expect(shift && shift.type === 'tactical_shift' && shift.pressing_to > shift.pressing_from).toBe(true);
    expect(events.some((e) => e.type === 'substitution' && e.team === 'home' && e.game_s < 63 * 60)).toBe(
      true,
    );
  });

  it('red-card collapse: second yellow sends a home player off and they go to ten', () => {
    const { events } = sim('red-card-collapse');
    const red = events.find((e) => e.type === 'card' && e.color === 'second_yellow');
    expect(red?.team).toBe('home');
    const after = events.find((e) => e.type === 'tactical_shift' && e.team === 'home' && e.ts >= red!.ts);
    expect(after && after.type === 'tactical_shift' && ['4-4-1', '5-3-1'].includes(after.formation_to)).toBe(
      true,
    );
  });

  it('every event, tracking frame and stream record passes the shared schema', () => {
    const r = sim('red-card-collapse');
    for (const e of r.events) expect(() => MatchEvent.parse(e)).not.toThrow();
    for (const f of r.frames.filter((_, i) => i % 50 === 0))
      expect(() => TrackingFrame.parse(f)).not.toThrow();
    const stream = toStream(r);
    expect(stream[0].kind).toBe('meta');
    for (const rec of stream.filter((_, i) => i % 97 === 0))
      expect(() => StreamRecord.parse(rec)).not.toThrow();
  });

  it('events are strictly ordered with monotonic stream time', () => {
    const { events } = sim('late-comeback');
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBe(events[i - 1].seq + 1);
      expect(events[i].ts).toBeGreaterThanOrEqual(events[i - 1].ts);
    }
  });

  it('produces football-realistic distributions across many seeds', () => {
    const per: Record<string, number[]> = { passes: [], acc: [], shots: [], goals: [], fouls: [] };
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const { events } = simulateMatch({ scenario: 'random', seed, tracking: false });
      for (const side of ['home', 'away'] as const) {
        const passes = events.filter((e) => e.type === 'pass' && e.team === side);
        per.passes.push(passes.length);
        per.acc.push(
          passes.filter((p) => p.type === 'pass' && p.outcome === 'complete').length / passes.length,
        );
        per.shots.push(events.filter((e) => e.type === 'shot' && e.team === side).length);
        per.goals.push(events.filter((e) => e.type === 'goal' && e.team === side).length);
        per.fouls.push(events.filter((e) => e.type === 'foul' && e.team === side).length);
      }
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(per.passes)).toBeGreaterThan(300);
    expect(mean(per.passes)).toBeLessThan(650);
    expect(mean(per.acc)).toBeGreaterThan(0.72);
    expect(mean(per.acc)).toBeLessThan(0.9);
    expect(mean(per.shots)).toBeGreaterThan(7);
    expect(mean(per.shots)).toBeLessThan(22);
    expect(mean(per.goals)).toBeGreaterThan(0.6);
    expect(mean(per.goals)).toBeLessThan(3);
    expect(mean(per.fouls)).toBeGreaterThan(5);
  });

  it('tracking is physically plausible: speeds capped, ~1 Hz, players on the pitch', () => {
    const { frames } = sim('late-comeback');
    expect(frames.length).toBeGreaterThan(5000);
    let maxSpeed = 0;
    for (const f of frames) {
      expect(f.players.length).toBeGreaterThanOrEqual(20);
      for (const p of f.players) maxSpeed = Math.max(maxSpeed, p.s);
    }
    expect(maxSpeed).toBeGreaterThan(28);
    expect(maxSpeed).toBeLessThan(37);
  });
});
