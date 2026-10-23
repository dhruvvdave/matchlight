import { z } from 'zod';
import { Language, Side } from './common.js';

/**
 * Broadcast overlay contract (stage 4: RENDER).
 * Positions are normalised (0..1) *within the title-safe area* (inner 90% of the frame),
 * so any graphics engine can map them to its own raster.
 */
export const OverlayRegion = z.enum([
  'top_left',
  'top_center',
  'top_right',
  'left_rail',
  'right_rail',
  'center',
  'lower_third',
  'pitch',
]);
export type OverlayRegion = z.infer<typeof OverlayRegion>;

export const OverlayKind = z.enum([
  'lower_third',
  'player_tag',
  'stat_badge',
  'momentum_bar',
  'pass_map',
  'key_moment_card',
]);
export type OverlayKind = z.infer<typeof OverlayKind>;

const OverlayBase = {
  id: z.string(),
  schema_version: z.string(),
  match_id: z.string(),
  profile_key: z.string(),
  /** Stream time (s since kickoff) at which the overlay should appear. */
  start_ts: z.number().nonnegative(),
  /** Display duration in stream seconds. */
  duration: z.number().positive(),
  /** 0..100; the scheduler preempts lower priorities in the same region. */
  priority: z.number().int().min(0).max(100),
  region: OverlayRegion,
  position: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  }),
  /** Overlays with the same key update in place instead of stacking. */
  debounce_key: z.string(),
  language: Language,
  dir: z.enum(['ltr', 'rtl']),
  theme: z.enum(['broadcast', 'high_contrast']),
  aria_label: z.string(),
  source_event_ids: z.array(z.string()),
  explanation_id: z.string().optional(),
};

export const LowerThird = z.object({
  ...OverlayBase,
  kind: z.literal('lower_third'),
  content: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    team: Side.optional(),
    accent: z.string().optional(),
  }),
});

export const PlayerTag = z.object({
  ...OverlayBase,
  kind: z.literal('player_tag'),
  content: z.object({
    player_id: z.string(),
    name: z.string(),
    number: z.number().int(),
    team: Side,
    label: z.string().optional(),
    value: z.string().optional(),
  }),
});

export const StatBadge = z.object({
  ...OverlayBase,
  kind: z.literal('stat_badge'),
  content: z.object({
    metric: z.enum([
      'player_speed',
      'ball_speed',
      'shot_speed',
      'distance',
      'pass_difficulty',
      'xg',
      'ppda',
      'tempo',
      'momentum',
      'possession',
    ]),
    label: z.string(),
    value: z.number(),
    display: z.string(),
    unit: z.string(),
    team: Side.optional(),
    player_id: z.string().optional(),
    trend: z.enum(['up', 'down', 'flat']).optional(),
    series: z.array(z.number()).optional(),
  }),
});

export const MomentumBar = z.object({
  ...OverlayBase,
  kind: z.literal('momentum_bar'),
  content: z.object({
    value: z.number().min(-100).max(100),
    home_label: z.string(),
    away_label: z.string(),
    home_color: z.string(),
    away_color: z.string(),
    series: z.array(z.number()),
  }),
});

export const PassMap = z.object({
  ...OverlayBase,
  kind: z.literal('pass_map'),
  content: z.object({
    title: z.string(),
    team: Side,
    player_id: z.string().optional(),
    passes: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          end_x: z.number(),
          end_y: z.number(),
          complete: z.boolean(),
          difficulty: z.number(),
        }),
      )
      .max(16),
  }),
});

export const KeyMomentCard = z.object({
  ...OverlayBase,
  kind: z.literal('key_moment_card'),
  content: z.object({
    title: z.string(),
    body: z.string(),
    evidence: z.array(z.string()),
    confidence: z.number().min(0).max(1).optional(),
    icon: z.enum(['goal', 'card', 'chance', 'tactic', 'momentum', 'speed', 'pass', 'sub', 'save', 'info']),
    team: Side.optional(),
  }),
});

export const Overlay = z.discriminatedUnion('kind', [
  LowerThird,
  PlayerTag,
  StatBadge,
  MomentumBar,
  PassMap,
  KeyMomentCard,
]);
export type Overlay = z.infer<typeof Overlay>;
export type OverlayOf<K extends OverlayKind> = Extract<Overlay, { kind: K }>;

/** Title-safe rectangle (fraction of full frame). */
export const TITLE_SAFE = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } as const;
