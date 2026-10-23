import { z } from 'zod';
import { MatchEvent, TrackingFrame } from './events.js';
import { AskAnswer, Explanation, FeedItem, Moment } from './insight.js';
import { MatchMeta } from './match.js';
import { Overlay } from './overlay.js';
import { Recap } from './recap.js';
import { LiveState } from './state.js';
import { TraceSpan } from './trace.js';

export const ClockStatus = z.object({
  ts: z.number(),
  game_s: z.number(),
  period: z.union([z.literal(1), z.literal(2)]),
  speed: z.number(),
  playing: z.boolean(),
  finished: z.boolean(),
  duration_ts: z.number(),
});
export type ClockStatus = z.infer<typeof ClockStatus>;

/**
 * Messages published to Web PubSub groups.
 * Shared group  `match.<sessionId>`              : meta, events, tracking, state, clock, moment, explanation, trace, recap
 * Profile group `match.<sessionId>.<profileKey>` : overlay, feed, answer
 */
export const GroupMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meta'), meta: MatchMeta, clock: ClockStatus }),
  z.object({ kind: z.literal('reset'), reason: z.string() }),
  z.object({ kind: z.literal('events'), events: z.array(MatchEvent) }),
  z.object({ kind: z.literal('tracking'), frame: TrackingFrame }),
  z.object({ kind: z.literal('state'), state: LiveState }),
  z.object({ kind: z.literal('clock'), clock: ClockStatus }),
  z.object({ kind: z.literal('moment'), moment: Moment }),
  z.object({ kind: z.literal('explanation'), explanation: Explanation }),
  z.object({ kind: z.literal('trace'), spans: z.array(TraceSpan) }),
  z.object({ kind: z.literal('recap'), recap: Recap }),
  z.object({ kind: z.literal('overlay'), profile_key: z.string(), overlay: Overlay }),
  z.object({ kind: z.literal('overlay_clear'), profile_key: z.string(), overlay_id: z.string() }),
  z.object({ kind: z.literal('feed'), profile_key: z.string(), item: FeedItem }),
  z.object({ kind: z.literal('answer'), profile_key: z.string(), answer: AskAnswer }),
]);
export type GroupMessage = z.infer<typeof GroupMessage>;

export const sharedGroup = (sessionId: string) => `match.${sessionId}`;
export const profileGroup = (sessionId: string, key: string) => `match.${sessionId}.${key}`;
