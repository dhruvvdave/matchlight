import type { MatchEvent, MatchMeta, ScenarioId, StreamRecord, TrackingFrame } from '@matchlight/schema';
import { CLUBS, COMPETITION, REFEREES, WEATHER } from './names.js';
import { MatchEngine } from './engine.js';
import { Rng } from './rng.js';
import { SCENARIOS, type ScenarioDef } from './scenarios.js';
import { buildTeam } from './teams.js';
import { generateTracking } from './tracking.js';
import type { Formation, TeamStyle } from '@matchlight/schema';

export { listScenarios, SCENARIOS } from './scenarios.js';
export type { Beat, ScenarioDef } from './scenarios.js';
export { Rng, clamp, sigmoid } from './rng.js';
export { FORMATIONS, shapePosition, toAbs, toAtt } from './formations.js';
export { shotAngle } from './engine.js';
export { CLUBS } from './names.js';

export interface SimulationResult {
  meta: MatchMeta;
  events: MatchEvent[];
  frames: TrackingFrame[];
}

export interface SimulateOptions {
  scenario: ScenarioId;
  /** Override seed. Seeded scenarios default to their canonical seed; 'random' defaults to 1. */
  seed?: number;
  /** Skip tracking generation (faster, used by some tests). */
  tracking?: boolean;
}

const FORMATION_POOL: Formation[] = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2'];

function randomScenario(seed: number): ScenarioDef {
  const rng = new Rng(seed ^ 0x5eed);
  const [home, away] = rng.shuffle([...CLUBS]).slice(0, 2);
  const style = (): TeamStyle => ({
    pressing: Math.round(rng.float(0.25, 0.85) * 100) / 100,
    directness: Math.round(rng.float(0.2, 0.75) * 100) / 100,
    tempo: Math.round(rng.float(0.3, 0.8) * 100) / 100,
    line_height: Math.round(rng.float(0.25, 0.75) * 100) / 100,
  });
  return {
    id: 'random',
    title: `${home.name} v ${away.name}`,
    description: 'Fully emergent synthetic match.',
    seed,
    home: home.id,
    away: away.id,
    homeFormation: rng.pick(FORMATION_POOL),
    awayFormation: rng.pick(FORMATION_POOL),
    homeStyle: style(),
    awayStyle: style(),
    script: 'natural',
    stoppage: [rng.int(1, 3), rng.int(3, 6)],
    beats: [],
    demoStartMinute: 0,
  };
}

export function scenarioDef(scenario: ScenarioId, seed?: number): ScenarioDef {
  if (scenario === 'random') return randomScenario(seed ?? 1);
  const def = SCENARIOS[scenario];
  return seed === undefined ? def : { ...def, seed };
}

/** Run the full synthetic match deterministically for (scenario, seed). */
export function simulateMatch(opts: SimulateOptions): SimulationResult {
  const def = scenarioDef(opts.scenario, opts.seed);
  const seed = def.seed;
  const rng = new Rng(seed);
  const used = new Set<string>();
  const homeClub = CLUBS.find((c) => c.id === def.home)!;
  const awayClub = CLUBS.find((c) => c.id === def.away)!;
  const home = buildTeam(homeClub, 'home', def.homeFormation, def.homeStyle, rng.fork(1), used);
  const away = buildTeam(awayClub, 'away', def.awayFormation, def.awayStyle, rng.fork(2), used);
  const day = 1 + (seed % 27);
  const meta: MatchMeta = {
    match_id: `m-${def.id}-${seed}`,
    seed,
    scenario: def.id,
    title: def.id === 'random' ? `${home.name} v ${away.name}` : def.title,
    synthetic: true,
    competition: COMPETITION,
    stadium: homeClub.stadium,
    city: homeClub.city,
    weather: WEATHER[seed % WEATHER.length],
    referee: REFEREES[seed % REFEREES.length],
    kickoff_iso: `2026-11-${String(day).padStart(2, '0')}T19:45:00Z`,
    home,
    away,
  };
  const engine = new MatchEngine(meta, def, rng.fork(3));
  const events = engine.run();
  const frames = opts.tracking === false ? [] : generateTracking(meta.match_id, events, engine.lineups);
  return { meta, events, frames };
}

/** Merge events and frames into one time-ordered stream (events before the frame at the same second). */
export function toStream(result: SimulationResult): StreamRecord[] {
  const out: StreamRecord[] = [{ kind: 'meta', meta: result.meta }];
  let fi = 0;
  for (const e of result.events) {
    while (fi < result.frames.length && result.frames[fi].ts < e.ts)
      out.push({ kind: 'tracking', frame: result.frames[fi++] });
    out.push({ kind: 'event', event: e });
  }
  while (fi < result.frames.length) out.push({ kind: 'tracking', frame: result.frames[fi++] });
  return out;
}

export function toJsonl(result: SimulationResult): string {
  return (
    toStream(result)
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  );
}

export function demoStartMinute(scenario: ScenarioId): number {
  return scenario === 'random' ? 0 : (SCENARIOS[scenario].demoStartMinute ?? 0);
}
