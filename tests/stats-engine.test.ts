import { describe, expect, it } from 'vitest';
import { LiveState, type TrackingFrame } from '@matchlight/schema';
import { StatsEngine, passDifficulty, xgModel, xtValue } from '@matchlight/pipeline';
import { toStream } from '@matchlight/simulator';
import { ev, sim, testMeta } from './helpers.js';

function runFull(scenario: Parameters<typeof sim>[0]) {
  const r = sim(scenario);
  const se = new StatsEngine(r.meta);
  for (const rec of toStream(r)) {
    if (rec.kind === 'event') se.ingestEvent(rec.event);
    else if (rec.kind === 'tracking') se.ingestFrame(rec.frame);
  }
  return se;
}

describe('metric models', () => {
  const shot = (x: number, y: number, extra: object = {}) =>
    ev('shot', {
      ts: 10,
      team: 'home',
      x,
      y,
      outcome: 'saved',
      body_part: 'right_foot',
      situation: 'open_play',
      ball_speed_kmh: 90,
      ...extra,
    });

  it('xG rises as the shooter gets closer and more central', () => {
    expect(xgModel(shot(99, 34))).toBeGreaterThan(xgModel(shot(90, 34)));
    expect(xgModel(shot(90, 34))).toBeGreaterThan(xgModel(shot(80, 34)));
    expect(xgModel(shot(95, 34))).toBeGreaterThan(xgModel(shot(95, 8)));
  });

  it('xG penalises headers and pressure, fixes penalties at 0.76', () => {
    expect(xgModel(shot(95, 34, { body_part: 'head' }))).toBeLessThan(xgModel(shot(95, 34)));
    expect(xgModel(shot(95, 34, { under_pressure: true }))).toBeLessThan(xgModel(shot(95, 34)));
    expect(xgModel(shot(94, 34, { situation: 'penalty' }))).toBe(0.76);
  });

  it('xG is mirrored correctly for the away side', () => {
    const home = xgModel(shot(95, 30));
    const away = xgModel(shot(10, 38, { team: 'away' }));
    expect(away).toBeCloseTo(home, 5);
  });

  it('xT surface increases toward goal', () => {
    expect(xtValue(95, 34)).toBeGreaterThan(xtValue(75, 34));
    expect(xtValue(75, 34)).toBeGreaterThan(xtValue(40, 34));
  });

  it('pass difficulty orders routine < progressive < through-ball-under-pressure', () => {
    const p = (extra: object) =>
      ev('pass', {
        ts: 1,
        team: 'home',
        x: 50,
        y: 34,
        end_x: 58,
        end_y: 30,
        outcome: 'complete',
        length_m: 9,
        height: 'ground',
        pass_kind: 'short',
        ball_speed_kmh: 40,
        ...extra,
      });
    const routine = passDifficulty(p({}));
    const back = passDifficulty(p({ end_x: 40, pass_kind: 'back' }));
    const progressive = passDifficulty(p({ end_x: 75, end_y: 34, length_m: 25, pass_kind: 'progressive' }));
    const through = passDifficulty(
      p({ x: 70, end_x: 95, end_y: 36, length_m: 25, pass_kind: 'through', under_pressure: true }),
    );
    expect(back).toBeLessThan(routine);
    expect(routine).toBeLessThan(progressive);
    expect(progressive).toBeLessThan(through);
    expect(through).toBeGreaterThan(0.75);
    expect(routine).toBeLessThan(0.3);
  });
});

describe('StatsEngine (hand-crafted events)', () => {
  it('computes time-based possession and pass accuracy', () => {
    const se = new StatsEngine(testMeta());
    se.ingestEvent(ev('period_start', { ts: 0, score: { home: 0, away: 0 } }));
    se.ingestEvent(
      ev('pass', {
        ts: 1,
        team: 'home',
        player_id: 'hba-05',
        x: 40,
        y: 30,
        end_x: 50,
        end_y: 30,
        outcome: 'complete',
        length_m: 10,
        height: 'ground',
        pass_kind: 'short',
        ball_speed_kmh: 40,
      }),
    );
    se.ingestEvent(
      ev('pass', {
        ts: 5,
        team: 'home',
        player_id: 'hba-06',
        x: 50,
        y: 30,
        end_x: 60,
        end_y: 30,
        outcome: 'incomplete',
        length_m: 10,
        height: 'ground',
        pass_kind: 'short',
        ball_speed_kmh: 40,
      }),
    );
    se.ingestEvent(ev('possession_change', { ts: 6, team: 'away', x: 55, y: 30, reason: 'interception' }));
    se.ingestEvent(
      ev('pass', {
        ts: 8,
        team: 'away',
        player_id: 'ivr-05',
        x: 55,
        y: 30,
        end_x: 45,
        end_y: 30,
        outcome: 'complete',
        length_m: 10,
        height: 'ground',
        pass_kind: 'short',
        ball_speed_kmh: 40,
      }),
    );
    const s = se.snapshot();
    expect(s.teams.home.passes).toBe(2);
    expect(s.teams.home.pass_accuracy).toBe(50);
    // home owns 1->5->6 (5s), away owns 6->8 (2s)
    expect(s.teams.home.possession_pct).toBeCloseTo((5 / 7) * 100, 0);
    expect(s.teams.home.possession_pct + s.teams.away.possession_pct).toBeCloseTo(100, 5);
  });

  it('computes PPDA as opponent passes in their own 60% per defensive action there', () => {
    const se = new StatsEngine(testMeta());
    se.ingestEvent(ev('period_start', { ts: 0, score: { home: 0, away: 0 } }));
    // Away passes in their own half: away attacks toward x=0, so x=80 is deep in away's own half.
    for (let i = 0; i < 9; i++)
      se.ingestEvent(
        ev('pass', {
          ts: 1 + i,
          team: 'away',
          x: 80,
          y: 30,
          end_x: 75,
          end_y: 30,
          outcome: 'complete',
          length_m: 5,
          height: 'ground',
          pass_kind: 'short',
          ball_speed_kmh: 30,
        }),
      );
    se.ingestEvent(ev('tackle', { ts: 12, team: 'home', player_id: 'hba-09', x: 75, y: 30, outcome: 'won' }));
    se.ingestEvent(ev('interception', { ts: 14, team: 'home', player_id: 'hba-10', x: 80, y: 30 }));
    se.ingestEvent(ev('foul', { ts: 16, team: 'home', player_id: 'hba-08', x: 70, y: 30 }));
    // Defensive action deep in home's own half does not count toward PPDA.
    se.ingestEvent(ev('tackle', { ts: 18, team: 'home', player_id: 'hba-02', x: 10, y: 30, outcome: 'won' }));
    expect(se.ppdaWindow('home', 0, 100)).toBe(3);
  });

  it('raises a top-speed flag from tracking only for new match highs above 31 km/h', () => {
    const se = new StatsEngine(testMeta());
    const frame = (ts: number, s: number): TrackingFrame => ({
      match_id: 'm',
      ts,
      game_s: ts,
      period: 1,
      ball: { x: 50, y: 34, z: 0 },
      possession: 'home',
      players: [{ id: 'hba-07', side: 'home', x: 50 + ts * 9, y: 30, s }],
    });
    expect(se.ingestFrame(frame(1, 30))).toHaveLength(0);
    const flags = se.ingestFrame(frame(2, 33.4));
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe('top_speed');
    expect(flags[0].value).toBe(33.4);
    expect(se.playerStats('hba-07')!.distance_m).toBe(9);
  });

  it('momentum leans toward the side generating threat', () => {
    const se = new StatsEngine(testMeta());
    se.ingestEvent(ev('period_start', { ts: 0, score: { home: 0, away: 0 } }));
    for (let i = 0; i < 4; i++)
      se.ingestEvent(
        ev('shot', {
          ts: 10 + i * 20,
          team: 'home',
          player_id: 'hba-11',
          x: 94,
          y: 34,
          outcome: 'saved',
          body_part: 'right_foot',
          situation: 'open_play',
          ball_speed_kmh: 90,
        }),
      );
    expect(se.momentum()).toBeGreaterThan(50);
  });
});

describe('StatsEngine (full seeded match)', () => {
  it('produces a schema-valid, internally consistent LiveState', () => {
    const se = runFull('late-comeback');
    const s = se.snapshot();
    expect(() => LiveState.parse(s)).not.toThrow();
    expect(s.status).toBe('full_time');
    expect(s.score).toEqual({ home: 3, away: 2 });
    expect(s.teams.home.possession_pct + s.teams.away.possession_pct).toBeCloseTo(100, 0);
    for (const side of ['home', 'away'] as const) {
      const t = s.teams[side];
      expect(t.pass_accuracy).toBeGreaterThan(60);
      expect(t.xg).toBeGreaterThan(0.2);
      expect(t.distance_km).toBeGreaterThan(80);
      expect(t.distance_km).toBeLessThan(150);
    }
    const ratings = Object.values(s.players).map((p) => p.rating);
    expect(Math.max(...ratings)).toBeLessThanOrEqual(10);
    expect(Math.min(...ratings)).toBeGreaterThanOrEqual(3);
  });

  it('detects the comeback press: home rolling PPDA drops after the 61st-minute switch', () => {
    const se = runFull('late-comeback');
    const before = se.ppdaWindow('home', 50 * 60, 61 * 60);
    const after = se.ppdaWindow('home', 64 * 60, 80 * 60);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!).toBeLessThan(before!);
    const s = se.snapshot();
    const mom = (min: number) => se.valueAt(s.series.momentum, min * 60)!;
    expect(mom(80)).toBeGreaterThan(mom(57));
  });

  it('raises threshold flags during a match (speed, pass difficulty, momentum)', () => {
    const se = runFull('late-comeback');
    const kinds = new Set(se.flags.map((f) => f.kind));
    expect(kinds.has('top_speed')).toBe(true);
    expect(kinds.has('difficult_pass')).toBe(true);
    expect(kinds.has('momentum_swing')).toBe(true);
    for (const f of se.flags) expect(f.event_ids.every((id) => se.byId.has(id))).toBe(true);
  });

  it('processes the whole stream fast enough for live use (< 0.2 ms per record)', () => {
    const r = sim('tactical-stalemate');
    const se = new StatsEngine(r.meta);
    const recs = toStream(r);
    const t0 = performance.now();
    for (const rec of recs) {
      if (rec.kind === 'event') se.ingestEvent(rec.event);
      else if (rec.kind === 'tracking') se.ingestFrame(rec.frame);
    }
    expect((performance.now() - t0) / recs.length).toBeLessThan(0.2);
  });
});
