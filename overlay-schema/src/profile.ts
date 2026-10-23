import { z } from 'zod';
import { Language, Side } from './common.js';

export const ViewerMode = z.enum(['analyst', 'casual', 'club', 'player', 'metric']);
export type ViewerMode = z.infer<typeof ViewerMode>;

export const TrackedMetric = z.enum([
  'ball_speed',
  'pass_difficulty',
  'player_speed',
  'xg',
  'ppda',
  'momentum',
  'tempo',
]);
export type TrackedMetric = z.infer<typeof TrackedMetric>;

export const ViewerProfile = z.object({
  mode: ViewerMode,
  language: Language,
  favorite_team: Side.optional(),
  focus_player_id: z.string().optional(),
  metric: TrackedMetric.optional(),
  tts: z.boolean().default(false),
  high_contrast: z.boolean().default(false),
});
export type ViewerProfile = z.infer<typeof ViewerProfile>;

/** Stable key used to route personalised content (Web PubSub group suffix). */
export function profileKey(p: ViewerProfile): string {
  const parts: string[] = [p.mode, p.language];
  if (p.mode === 'club') parts.push(p.favorite_team ?? 'home');
  if (p.mode === 'player') parts.push(p.focus_player_id ?? 'none');
  if (p.mode === 'metric') parts.push(p.metric ?? 'ball_speed');
  if (p.high_contrast) parts.push('hc');
  return parts.join('.');
}

export function normaliseProfile(p: ViewerProfile): ViewerProfile {
  return {
    ...p,
    favorite_team: p.mode === 'club' ? (p.favorite_team ?? 'home') : undefined,
    metric: p.mode === 'metric' ? (p.metric ?? 'ball_speed') : undefined,
    focus_player_id: p.mode === 'player' ? p.focus_player_id : undefined,
  };
}
