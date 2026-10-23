import { z } from 'zod';

export const AgentName = z.enum([
  'ingest',
  'interpret',
  'director',
  'stats',
  'explainer',
  'critic',
  'narrator',
  'personalizer',
  'translator',
  'renderer',
  'recap',
  'ask',
  'tts',
]);
export type AgentName = z.infer<typeof AgentName>;

/** One step in the agent trace (shown in the UI's Agent Trace panel and logged as JSON). */
export const TraceSpan = z.object({
  id: z.string(),
  trace_id: z.string(),
  parent_id: z.string().optional(),
  agent: AgentName,
  op: z.string(),
  ts: z.number(),
  wall_ms: z.number(),
  latency_ms: z.number(),
  status: z.enum(['ok', 'rejected', 'fallback', 'error', 'skipped']),
  summary: z.string(),
  detail: z.record(z.unknown()).optional(),
});
export type TraceSpan = z.infer<typeof TraceSpan>;
