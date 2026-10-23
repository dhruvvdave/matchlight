import { z } from 'zod';
import { Side } from './common.js';

export const Position = z.enum([
  'GK',
  'CB',
  'LB',
  'RB',
  'LWB',
  'RWB',
  'DM',
  'CM',
  'AM',
  'LM',
  'RM',
  'LW',
  'RW',
  'ST',
]);
export type Position = z.infer<typeof Position>;

export const Formation = z.enum(['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '5-4-1', '4-4-1', '4-2-4', '5-3-1']);
export type Formation = z.infer<typeof Formation>;

export const Player = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  number: z.number().int().min(1).max(99),
  position: Position,
  side: Side,
  starter: z.boolean(),
  attributes: z.object({
    pace: z.number().min(0).max(100),
    passing: z.number().min(0).max(100),
    finishing: z.number().min(0).max(100),
    defending: z.number().min(0).max(100),
    stamina: z.number().min(0).max(100),
    goalkeeping: z.number().min(0).max(100),
  }),
});
export type Player = z.infer<typeof Player>;

export const TeamStyle = z.object({
  /** 0..1 how aggressively the team presses high. */
  pressing: z.number().min(0).max(1),
  /** 0..1 preference for long/vertical passes. */
  directness: z.number().min(0).max(1),
  /** 0..1 speed of play (shorter time between actions). */
  tempo: z.number().min(0).max(1),
  /** 0..1 defensive line height. */
  line_height: z.number().min(0).max(1),
});
export type TeamStyle = z.infer<typeof TeamStyle>;

export const Team = z.object({
  id: z.string(),
  side: Side,
  name: z.string(),
  short: z.string().max(4),
  colors: z.object({ primary: z.string(), secondary: z.string() }),
  formation: Formation,
  style: TeamStyle,
  players: z.array(Player),
});
export type Team = z.infer<typeof Team>;

export const ScenarioId = z.enum(['late-comeback', 'red-card-collapse', 'tactical-stalemate', 'random']);
export type ScenarioId = z.infer<typeof ScenarioId>;

export const MatchMeta = z.object({
  match_id: z.string(),
  seed: z.number().int(),
  scenario: ScenarioId,
  title: z.string(),
  synthetic: z.literal(true),
  competition: z.string(),
  stadium: z.string(),
  city: z.string(),
  weather: z.string(),
  referee: z.string(),
  kickoff_iso: z.string(),
  home: Team,
  away: Team,
});
export type MatchMeta = z.infer<typeof MatchMeta>;

export const ScenarioInfo = z.object({
  id: ScenarioId,
  title: z.string(),
  description: z.string(),
  seed: z.number().int(),
});
export type ScenarioInfo = z.infer<typeof ScenarioInfo>;
