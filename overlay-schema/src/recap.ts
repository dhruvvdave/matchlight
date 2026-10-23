import { z } from 'zod';
import { Language, Side } from './common.js';

export const Recap = z.object({
  match_id: z.string(),
  lang: Language,
  generated_at_ts: z.number(),
  final_score: z.object({ home: z.number().int(), away: z.number().int() }),
  headline: z.string(),
  article_md: z.string(),
  script_60s: z.string(),
  timeline: z.array(
    z.object({
      ts: z.number(),
      minute_label: z.string(),
      kind: z.string(),
      title: z.string(),
      team: Side.optional(),
      event_ids: z.array(z.string()),
    }),
  ),
  player_ratings: z.array(
    z.object({
      player_id: z.string(),
      name: z.string(),
      side: Side,
      rating: z.number(),
      reason: z.string(),
    }),
  ),
  key_stats: z.array(z.object({ label: z.string(), home: z.string(), away: z.string() })),
  source: z.enum(['llm', 'template']),
  grounded: z.boolean(),
});
export type Recap = z.infer<typeof Recap>;
