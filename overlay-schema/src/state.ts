import { z } from 'zod';
import { Period, Side } from './common.js';

export const TeamStats = z.object({
  goals: z.number().int(),
  shots: z.number().int(),
  shots_on_target: z.number().int(),
  xg: z.number(),
  xt: z.number(),
  passes: z.number().int(),
  passes_completed: z.number().int(),
  pass_accuracy: z.number(),
  avg_pass_length: z.number(),
  avg_pass_difficulty: z.number(),
  progressive_passes: z.number().int(),
  final_third_entries: z.number().int(),
  possession_pct: z.number(),
  /** Passes allowed per defensive action (opponent's first 60% of the pitch). Lower = more intense press. */
  ppda: z.number().nullable(),
  /** Rolling PPDA over the last 10 minutes of play. */
  ppda_10: z.number().nullable(),
  pressures: z.number().int(),
  tackles: z.number().int(),
  interceptions: z.number().int(),
  turnovers: z.number().int(),
  high_turnovers: z.number().int(),
  fouls: z.number().int(),
  yellow: z.number().int(),
  red: z.number().int(),
  corners: z.number().int(),
  offsides: z.number().int(),
  top_ball_speed_kmh: z.number(),
  top_shot_speed_kmh: z.number(),
  top_player_speed_kmh: z.number(),
  distance_km: z.number(),
  field_tilt: z.number(),
  players_on_pitch: z.number().int(),
});
export type TeamStats = z.infer<typeof TeamStats>;

export const PlayerStats = z.object({
  player_id: z.string(),
  side: Side,
  on_pitch: z.boolean(),
  minutes: z.number(),
  touches: z.number().int(),
  passes: z.number().int(),
  passes_completed: z.number().int(),
  avg_pass_difficulty: z.number(),
  hardest_pass: z.number(),
  key_passes: z.number().int(),
  shots: z.number().int(),
  goals: z.number().int(),
  assists: z.number().int(),
  xg: z.number(),
  xt: z.number(),
  tackles: z.number().int(),
  interceptions: z.number().int(),
  pressures: z.number().int(),
  fouls: z.number().int(),
  cards: z.number().int(),
  distance_m: z.number(),
  top_speed_kmh: z.number(),
  sprints: z.number().int(),
  /** 12 x 8 touch heatmap, row-major (x buckets fastest). */
  heat: z.array(z.number()),
  rating: z.number(),
});
export type PlayerStats = z.infer<typeof PlayerStats>;

export const FlagKind = z.enum([
  'top_speed',
  'shot_speed',
  'ball_speed',
  'distance_milestone',
  'difficult_pass',
  'long_pass',
  'ppda_shift',
  'momentum_swing',
  'tempo_spike',
  'chaos_spike',
  'xg_swing',
  'possession_dominance',
  'player_milestone',
]);
export type FlagKind = z.infer<typeof FlagKind>;

/** Threshold-triggered flag raised by the Interpret stage. */
export const Flag = z.object({
  id: z.string(),
  kind: FlagKind,
  ts: z.number(),
  team: Side.optional(),
  player_id: z.string().optional(),
  value: z.number(),
  previous: z.number().optional(),
  threshold: z.number(),
  unit: z.string(),
  label: z.string(),
  event_ids: z.array(z.string()),
});
export type Flag = z.infer<typeof Flag>;

export const SeriesPoint = z.object({ ts: z.number(), minute: z.number(), v: z.number() });
export type SeriesPoint = z.infer<typeof SeriesPoint>;

export const LiveState = z.object({
  match_id: z.string(),
  ts: z.number(),
  game_s: z.number(),
  period: Period,
  minute_label: z.string(),
  status: z.enum(['pre', 'live', 'half_time', 'full_time']),
  score: z.object({ home: z.number().int(), away: z.number().int() }),
  possession: Side.nullable(),
  ball: z.object({ x: z.number(), y: z.number() }),
  teams: z.object({ home: TeamStats, away: TeamStats }),
  players: z.record(PlayerStats),
  /** -100..100, positive = home on top. */
  momentum: z.number(),
  /** On-ball actions per minute of play over the last 5 minutes. */
  tempo: z.number(),
  /** 0..100 control-vs-chaos score: 100 = calm, long controlled chains; 0 = end-to-end chaos. */
  control: z.number(),
  series: z.object({
    momentum: z.array(SeriesPoint),
    xg_home: z.array(SeriesPoint),
    xg_away: z.array(SeriesPoint),
    ppda_home: z.array(SeriesPoint),
    ppda_away: z.array(SeriesPoint),
    tempo: z.array(SeriesPoint),
    control: z.array(SeriesPoint),
  }),
  flags: z.array(Flag),
  event_count: z.number().int(),
  last_event_id: z.string().nullable(),
});
export type LiveState = z.infer<typeof LiveState>;
