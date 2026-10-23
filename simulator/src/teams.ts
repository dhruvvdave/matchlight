import type { Formation, Player, Position, Side, Team, TeamStyle } from '@matchlight/schema';
import { FIRST_NAMES, LAST_NAMES, type ClubTemplate } from './names.js';
import { FORMATIONS } from './formations.js';
import { Rng, clamp } from './rng.js';

const BENCH_POSITIONS: Position[] = ['GK', 'CB', 'LB', 'CM', 'AM', 'RW', 'ST'];

function attributesFor(pos: Position, rng: Rng, quality: number): Player['attributes'] {
  const r = (base: number, sd = 7) => Math.round(clamp(rng.normal(base + quality, sd), 30, 97));
  const isGk = pos === 'GK';
  const attacker = ['ST', 'LW', 'RW', 'AM'].includes(pos);
  const defender = ['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM'].includes(pos);
  const wide = ['LW', 'RW', 'LB', 'RB', 'LWB', 'RWB', 'LM', 'RM'].includes(pos);
  return {
    pace: r(isGk ? 50 : wide ? 80 : attacker ? 76 : 68),
    passing: r(isGk ? 55 : ['CM', 'DM', 'AM'].includes(pos) ? 79 : 68),
    finishing: r(isGk ? 15 : attacker ? 78 : defender ? 45 : 62),
    defending: r(isGk ? 30 : defender ? 78 : attacker ? 40 : 62),
    stamina: r(isGk ? 60 : wide ? 80 : 74),
    goalkeeping: isGk ? r(78) : Math.round(clamp(rng.normal(12, 4), 5, 25)),
  };
}

export function buildTeam(
  club: ClubTemplate,
  side: Side,
  formation: Formation,
  style: TeamStyle,
  rng: Rng,
  usedNames: Set<string>,
): Team {
  const quality = rng.float(-3, 3);
  const players: Player[] = [];
  const numbers = new Set<number>();
  const name = () => {
    for (;;) {
      const n = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!usedNames.has(n)) {
        usedNames.add(n);
        return n;
      }
    }
  };
  const numberFor = (pos: Position) => {
    const preferred: Partial<Record<Position, number[]>> = {
      GK: [1, 13, 31], RB: [2, 22], LB: [3, 23], CB: [4, 5, 6, 15], DM: [6, 16], CM: [8, 14, 18],
      AM: [10, 20], RW: [7, 17], LW: [11, 19], ST: [9, 21, 29], RM: [7, 17], LM: [11, 12], RWB: [2, 24], LWB: [3, 26],
    };
    for (const n of preferred[pos] ?? []) if (!numbers.has(n)) return n;
    for (let n = 24; n < 99; n++) if (!numbers.has(n)) return n;
    return 99;
  };
  const add = (pos: Position, starter: boolean) => {
    const full = name();
    const num = numberFor(pos);
    numbers.add(num);
    const [first, ...rest] = full.split(' ');
    players.push({
      id: `${club.id}-${String(players.length + 1).padStart(2, '0')}`,
      name: full,
      short_name: `${first[0]}. ${rest.join(' ')}`,
      number: num,
      position: pos,
      side,
      starter,
      attributes: attributesFor(pos, rng, quality),
    });
  };
  for (const slot of FORMATIONS[formation]) add(slot.pos, true);
  for (const pos of BENCH_POSITIONS) add(pos, false);
  return {
    id: club.id,
    side,
    name: club.name,
    short: club.short,
    colors: { primary: club.primary, secondary: club.secondary },
    formation,
    style,
    players,
  };
}
