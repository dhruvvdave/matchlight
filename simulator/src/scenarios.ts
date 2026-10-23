import type { Formation, Position, ScenarioId, ScenarioInfo, Side, TeamStyle } from '@matchlight/schema';

/** Scripted "beats" guarantee each seeded scenario tells its story while everything in between is simulated. */
export type Beat =
  | { kind: 'goal'; minute: number; team: Side; prefer?: Position[] }
  | { kind: 'big_chance'; minute: number; team: Side; outcome: 'saved' | 'woodwork' }
  | { kind: 'sub'; minute: number; team: Side; out: Position[]; in: Position[] }
  | {
      kind: 'shift';
      minute: number;
      team: Side;
      formation: Formation;
      style: Partial<TeamStyle>;
      note: string;
    }
  | { kind: 'card'; minute: number; team: Side; color: 'yellow' | 'second_yellow' | 'red'; pos: Position }
  | { kind: 'momentum'; from: number; to: number; team: Side; strength: number };

export interface ScenarioDef {
  id: ScenarioId;
  title: string;
  description: string;
  seed: number;
  home: string;
  away: string;
  homeFormation: Formation;
  awayFormation: Formation;
  homeStyle: TeamStyle;
  awayStyle: TeamStyle;
  /** 'scripted' = only beats produce goals / red cards; 'natural' = fully emergent. */
  script: 'scripted' | 'natural';
  stoppage: [number, number];
  beats: Beat[];
  /** Suggested demo start (football minute) for Demo Mode. */
  demoStartMinute?: number;
}

export const SCENARIOS: Record<Exclude<ScenarioId, 'random'>, ScenarioDef> = {
  'late-comeback': {
    id: 'late-comeback',
    title: 'The Comeback',
    description:
      'Harbourside trail 0-2 at the hour. A double substitution and a switch to an aggressive high press flip the match: three goals in 17 minutes.',
    seed: 1861,
    home: 'hba',
    away: 'ivr',
    homeFormation: '4-3-3',
    awayFormation: '4-2-3-1',
    homeStyle: { pressing: 0.42, directness: 0.35, tempo: 0.5, line_height: 0.45 },
    awayStyle: { pressing: 0.55, directness: 0.5, tempo: 0.55, line_height: 0.5 },
    script: 'scripted',
    stoppage: [2, 5],
    demoStartMinute: 56,
    beats: [
      { kind: 'momentum', from: 15, to: 30, team: 'away', strength: 0.35 },
      { kind: 'goal', minute: 23, team: 'away', prefer: ['ST', 'AM'] },
      { kind: 'momentum', from: 46, to: 60, team: 'away', strength: 0.45 },
      { kind: 'goal', minute: 51, team: 'away', prefer: ['LW', 'RW', 'ST'] },
      { kind: 'sub', minute: 61, team: 'home', out: ['CM', 'LW'], in: ['AM', 'ST'] },
      {
        kind: 'shift',
        minute: 61.2,
        team: 'home',
        formation: '4-2-4',
        style: { pressing: 0.9, line_height: 0.8, tempo: 0.75, directness: 0.55 },
        note: 'Switch to 4-2-4 with an all-out high press',
      },
      { kind: 'momentum', from: 62, to: 95, team: 'home', strength: 0.6 },
      { kind: 'goal', minute: 64, team: 'home', prefer: ['ST'] },
      { kind: 'card', minute: 69, team: 'away', color: 'yellow', pos: 'DM' },
      { kind: 'goal', minute: 73, team: 'home', prefer: ['RW', 'LW', 'ST'] },
      {
        kind: 'shift',
        minute: 75,
        team: 'away',
        formation: '5-4-1',
        style: { pressing: 0.25, line_height: 0.2, directness: 0.75 },
        note: 'Drop into a deep 5-4-1 to protect the point',
      },
      { kind: 'goal', minute: 81, team: 'home', prefer: ['ST', 'AM'] },
      { kind: 'big_chance', minute: 88, team: 'away', outcome: 'saved' },
    ],
  },
  'red-card-collapse': {
    id: 'red-card-collapse',
    title: 'Red-Card Collapse',
    description:
      'Kestrel Vale cruise into a 1-0 lead, then their centre-back is sent off for a second booking. Larkspur exploit the extra man and run away with it.',
    seed: 2207,
    home: 'kvf',
    away: 'lkt',
    homeFormation: '4-3-3',
    awayFormation: '4-2-3-1',
    homeStyle: { pressing: 0.6, directness: 0.4, tempo: 0.6, line_height: 0.6 },
    awayStyle: { pressing: 0.45, directness: 0.45, tempo: 0.5, line_height: 0.45 },
    script: 'scripted',
    stoppage: [3, 4],
    demoStartMinute: 35,
    beats: [
      { kind: 'momentum', from: 5, to: 30, team: 'home', strength: 0.35 },
      { kind: 'goal', minute: 18, team: 'home', prefer: ['ST', 'LW'] },
      { kind: 'card', minute: 27, team: 'home', color: 'yellow', pos: 'CB' },
      { kind: 'card', minute: 39, team: 'home', color: 'second_yellow', pos: 'CB' },
      {
        kind: 'shift',
        minute: 39.5,
        team: 'home',
        formation: '4-4-1',
        style: { pressing: 0.25, line_height: 0.3, tempo: 0.4 },
        note: 'Down to ten: drop into a 4-4-1 and sit deep',
      },
      { kind: 'momentum', from: 40, to: 95, team: 'away', strength: 0.55 },
      { kind: 'goal', minute: 44, team: 'away', prefer: ['ST', 'AM'] },
      {
        kind: 'shift',
        minute: 55,
        team: 'away',
        formation: '4-2-3-1',
        style: { pressing: 0.8, line_height: 0.7, tempo: 0.7 },
        note: 'Push both full-backs on and press the ten men',
      },
      { kind: 'goal', minute: 58, team: 'away', prefer: ['LW', 'RW'] },
      { kind: 'sub', minute: 63, team: 'home', out: ['ST', 'CM'], in: ['ST', 'CM'] },
      { kind: 'goal', minute: 71, team: 'away', prefer: ['ST'] },
      { kind: 'goal', minute: 83, team: 'away', prefer: ['AM', 'ST'] },
    ],
  },
  'tactical-stalemate': {
    id: 'tactical-stalemate',
    title: 'Tactical Stalemate',
    description:
      'Two disciplined low blocks cancel each other out. Low tempo, few chances, and a 0-0 decided by structure and one late save.',
    seed: 3313,
    home: 'cpb',
    away: 'smm',
    homeFormation: '4-4-2',
    awayFormation: '5-4-1',
    homeStyle: { pressing: 0.3, directness: 0.3, tempo: 0.35, line_height: 0.35 },
    awayStyle: { pressing: 0.25, directness: 0.45, tempo: 0.3, line_height: 0.25 },
    script: 'scripted',
    stoppage: [1, 3],
    demoStartMinute: 60,
    beats: [
      { kind: 'big_chance', minute: 52, team: 'home', outcome: 'woodwork' },
      {
        kind: 'shift',
        minute: 66,
        team: 'home',
        formation: '4-2-3-1',
        style: { pressing: 0.55, tempo: 0.5 },
        note: 'Add a No.10 between the lines to unlock the block',
      },
      { kind: 'big_chance', minute: 88, team: 'away', outcome: 'saved' },
    ],
  },
};

export function listScenarios(): ScenarioInfo[] {
  return [
    ...Object.values(SCENARIOS).map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      seed: s.seed,
    })),
    {
      id: 'random' as const,
      title: 'Generate New Match',
      description: 'A fresh, fully emergent match between two random fictional clubs. Any seed, any story.',
      seed: 0,
    },
  ];
}
