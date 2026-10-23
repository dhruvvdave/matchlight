import { z } from 'zod';
import { Period, Side, X, Y } from './common.js';
import { Formation, MatchMeta } from './match.js';

/** Fields shared by every match event. */
const Base = {
  id: z.string(),
  seq: z.number().int().nonnegative(),
  match_id: z.string(),
  /** Monotonic stream time in seconds since kickoff (includes stoppage time). Canonical timeline. */
  ts: z.number().nonnegative(),
  /** Football clock in seconds (2nd half starts at 2700). */
  game_s: z.number().nonnegative(),
  period: Period,
  team: Side.optional(),
  player_id: z.string().optional(),
  x: X.optional(),
  y: Y.optional(),
  possession_id: z.number().int().nonnegative(),
  under_pressure: z.boolean().optional(),
  /** Actor speed sampled from tracking at the moment of the event. */
  player_speed_kmh: z.number().nonnegative().optional(),
};

export const PassEvent = z.object({
  ...Base,
  type: z.literal('pass'),
  end_x: X,
  end_y: Y,
  recipient_id: z.string().optional(),
  outcome: z.enum(['complete', 'incomplete', 'out']),
  length_m: z.number().nonnegative(),
  height: z.enum(['ground', 'low', 'high']),
  pass_kind: z.enum(['short', 'progressive', 'long', 'through', 'cross', 'switch', 'back', 'set_piece']),
  ball_speed_kmh: z.number().nonnegative(),
});

export const CarryEvent = z.object({
  ...Base,
  type: z.literal('carry'),
  end_x: X,
  end_y: Y,
  distance_m: z.number().nonnegative(),
});

export const DribbleEvent = z.object({
  ...Base,
  type: z.literal('dribble'),
  opponent_id: z.string().optional(),
  outcome: z.enum(['success', 'fail']),
});

export const ShotEvent = z.object({
  ...Base,
  type: z.literal('shot'),
  end_x: X.optional(),
  end_y: Y.optional(),
  outcome: z.enum(['goal', 'saved', 'off_target', 'blocked', 'woodwork']),
  body_part: z.enum(['right_foot', 'left_foot', 'head']),
  situation: z.enum(['open_play', 'counter', 'set_piece', 'penalty']),
  ball_speed_kmh: z.number().nonnegative(),
  assist_id: z.string().optional(),
  goalkeeper_id: z.string().optional(),
});

export const GoalEvent = z.object({
  ...Base,
  type: z.literal('goal'),
  shot_event_id: z.string(),
  assist_id: z.string().optional(),
  score: z.object({ home: z.number().int(), away: z.number().int() }),
});

export const SaveEvent = z.object({ ...Base, type: z.literal('save'), shot_event_id: z.string() });

export const TackleEvent = z.object({
  ...Base,
  type: z.literal('tackle'),
  opponent_id: z.string().optional(),
  outcome: z.enum(['won', 'lost']),
});

export const InterceptionEvent = z.object({ ...Base, type: z.literal('interception') });
export const ClearanceEvent = z.object({ ...Base, type: z.literal('clearance') });
export const BlockEvent = z.object({
  ...Base,
  type: z.literal('block'),
  shot_event_id: z.string().optional(),
});

export const PressureEvent = z.object({
  ...Base,
  type: z.literal('pressure'),
  opponent_id: z.string().optional(),
});

export const PossessionChangeEvent = z.object({
  ...Base,
  type: z.literal('possession_change'),
  from_team: Side.optional(),
  reason: z.enum([
    'kickoff',
    'interception',
    'tackle',
    'out_of_play',
    'foul',
    'shot',
    'goal',
    'save',
    'clearance',
    'offside',
    'miscontrol',
    'loose_ball',
  ]),
});

export const FoulEvent = z.object({
  ...Base,
  type: z.literal('foul'),
  opponent_id: z.string().optional(),
});

export const CardEvent = z.object({
  ...Base,
  type: z.literal('card'),
  color: z.enum(['yellow', 'second_yellow', 'red']),
  reason: z.string(),
});

export const SubstitutionEvent = z.object({
  ...Base,
  type: z.literal('substitution'),
  player_in_id: z.string(),
});

export const OffsideEvent = z.object({ ...Base, type: z.literal('offside') });

export const SetPieceEvent = z.object({
  ...Base,
  type: z.literal('set_piece'),
  kind: z.enum(['corner', 'free_kick', 'throw_in', 'goal_kick', 'penalty', 'kickoff']),
});

export const TacticalShiftEvent = z.object({
  ...Base,
  type: z.literal('tactical_shift'),
  formation_from: Formation,
  formation_to: Formation,
  pressing_from: z.number(),
  pressing_to: z.number(),
  note: z.string(),
});

export const PeriodEvent = z.object({
  ...Base,
  type: z.enum(['period_start', 'period_end']),
  score: z.object({ home: z.number().int(), away: z.number().int() }),
});

export const MatchEndEvent = z.object({
  ...Base,
  type: z.literal('match_end'),
  score: z.object({ home: z.number().int(), away: z.number().int() }),
});

export const MatchEvent = z.discriminatedUnion('type', [
  PassEvent,
  CarryEvent,
  DribbleEvent,
  ShotEvent,
  GoalEvent,
  SaveEvent,
  TackleEvent,
  InterceptionEvent,
  ClearanceEvent,
  BlockEvent,
  PressureEvent,
  PossessionChangeEvent,
  FoulEvent,
  CardEvent,
  SubstitutionEvent,
  OffsideEvent,
  SetPieceEvent,
  TacticalShiftEvent,
  PeriodEvent,
  MatchEndEvent,
]);
export type MatchEvent = z.infer<typeof MatchEvent>;
export type EventType = MatchEvent['type'];
/** Narrow MatchEvent by its `type` (also works for members whose `type` is itself a union, e.g. period events). */
export type EventOf<T extends EventType> = MatchEvent extends infer E
  ? E extends { type: infer U }
    ? T extends U
      ? Omit<E, 'type'> & { type: T }
      : never
    : never
  : never;

/** 1 Hz synthetic tracking frame (ball + all on-pitch players). Used by the pitch view and auto-eventing. */
export const TrackingFrame = z.object({
  match_id: z.string(),
  ts: z.number().nonnegative(),
  game_s: z.number().nonnegative(),
  period: Period,
  ball: z.object({ x: X, y: Y, z: z.number().min(0) }),
  possession: Side.nullable(),
  players: z.array(
    z.object({
      id: z.string(),
      side: Side,
      x: X,
      y: Y,
      /** Instantaneous speed in km/h. */
      s: z.number().nonnegative(),
    }),
  ),
});
export type TrackingFrame = z.infer<typeof TrackingFrame>;

/** One line of the replayable JSONL stream. */
export const StreamRecord = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meta'), meta: MatchMeta }),
  z.object({ kind: z.literal('event'), event: MatchEvent }),
  z.object({ kind: z.literal('tracking'), frame: TrackingFrame }),
]);
export type StreamRecord = z.infer<typeof StreamRecord>;
