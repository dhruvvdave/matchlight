import type { EventOf, MatchEvent, MatchMeta } from '@matchlight/schema';
import { simulateMatch, type SimulationResult } from '@matchlight/simulator';

const cache = new Map<string, SimulationResult>();

/** Memoised simulation so suites can share the (deterministic) result. */
export function sim(
  scenario: 'late-comeback' | 'red-card-collapse' | 'tactical-stalemate' | 'random',
  seed?: number,
  tracking = true,
) {
  const key = `${scenario}:${seed}:${tracking}`;
  if (!cache.has(key)) cache.set(key, simulateMatch({ scenario, seed, tracking }));
  return cache.get(key)!;
}

let seq = 0;
/** Build a minimal valid event for hand-crafted stats tests. */
export function ev<T extends MatchEvent['type']>(
  type: T,
  fields: Partial<EventOf<T>> & { ts: number },
): EventOf<T> {
  return {
    id: `t${seq}`,
    seq: seq++,
    match_id: 'm-test',
    game_s: fields.ts,
    period: 1,
    possession_id: 1,
    type,
    ...fields,
  } as unknown as EventOf<T>;
}

export function testMeta(): MatchMeta {
  return sim('late-comeback', undefined, false).meta;
}
