import { z } from 'zod';
import { Language, Side } from './common.js';

/** An atomic, verifiable statement computed from the data. Everything a narrative says must trace to Facts. */
export const Fact = z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  previous: z.number().optional(),
  delta: z.number().optional(),
  team: Side.optional(),
  player_id: z.string().optional(),
  window: z.object({ from_ts: z.number(), to_ts: z.number() }).optional(),
  event_ids: z.array(z.string()),
  /** Canonical English rendering of the fact, e.g. "PPDA dropped 11.2 -> 6.1 after 61'". */
  text: z.string(),
});
export type Fact = z.infer<typeof Fact>;

export const MomentKind = z.enum([
  'goal',
  'big_chance',
  'save',
  'card',
  'red_card',
  'substitution',
  'tactical_shift',
  'momentum_swing',
  'pressing_shift',
  'speed_flag',
  'difficult_pass',
  'xg_swing',
  'tempo_change',
  'chaos_spike',
  'possession_dominance',
  'player_milestone',
  'period_summary',
]);
export type MomentKind = z.infer<typeof MomentKind>;

/** A candidate "worth surfacing" moment, scored by the Director. */
export const Moment = z.object({
  id: z.string(),
  kind: MomentKind,
  ts: z.number(),
  minute_label: z.string(),
  team: Side.optional(),
  player_id: z.string().optional(),
  significance: z.number().min(0).max(1),
  event_ids: z.array(z.string()),
  headline: z.string(),
  flag_id: z.string().optional(),
  topic: z.string(),
});
export type Moment = z.infer<typeof Moment>;

export const CriticIssue = z.object({
  code: z.enum([
    'unknown_fact',
    'unknown_event',
    'unsupported_number',
    'unsupported_entity',
    'direction_mismatch',
    'schema',
    'empty_evidence',
    'overconfident',
    'too_many_numbers',
  ]),
  detail: z.string(),
});
export type CriticIssue = z.infer<typeof CriticIssue>;

export const CriticVerdict = z.object({
  ok: z.boolean(),
  issues: z.array(CriticIssue),
});
export type CriticVerdict = z.infer<typeof CriticVerdict>;

/** Output contract of the Explainer agent: "why does this moment matter?" */
export const Explanation = z.object({
  id: z.string(),
  moment_id: z.string(),
  kind: MomentKind,
  ts: z.number(),
  minute_label: z.string(),
  team: Side.optional(),
  player_id: z.string().optional(),
  claim: z.string(),
  evidence: z.array(z.object({ fact_id: z.string(), text: z.string() })).min(1),
  confidence: z.number().min(0).max(1),
  event_ids: z.array(z.string()),
  facts: z.array(Fact),
  source: z.enum(['llm', 'template']),
  critic: z.object({ grounded: z.boolean(), attempts: z.number().int(), issues: z.array(CriticIssue) }),
});
export type Explanation = z.infer<typeof Explanation>;

/** Shape the LLM must return for an explanation (validated before the Critic runs). */
export const ExplanationDraft = z.object({
  claim: z.string().min(8),
  evidence: z
    .array(z.object({ fact_id: z.string(), text: z.string() }))
    .min(1)
    .max(4),
  confidence: z.number().min(0).max(1),
  event_ids: z.array(z.string()),
});
export type ExplanationDraft = z.infer<typeof ExplanationDraft>;

/** A personalised line in a viewer's commentary feed. */
export const FeedItem = z.object({
  id: z.string(),
  profile_key: z.string(),
  ts: z.number(),
  minute_label: z.string(),
  kind: z.enum(['commentary', 'key_moment', 'stat', 'milestone', 'system', 'answer', 'recap']),
  text: z.string(),
  lang: Language,
  dir: z.enum(['ltr', 'rtl']),
  emphasis: z.number().int().min(0).max(3),
  team: Side.optional(),
  player_id: z.string().optional(),
  explanation_id: z.string().optional(),
  moment_id: z.string().optional(),
  moment_kind: z.string().optional(),
  event_ids: z.array(z.string()),
  source: z.enum(['llm', 'template', 'translator']),
  supersedes: z.string().optional(),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});
export type FeedItem = z.infer<typeof FeedItem>;

export const AskAnswer = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
  lang: Language,
  dir: z.enum(['ltr', 'rtl']),
  facts: z.array(Fact),
  event_ids: z.array(z.string()),
  grounded: z.boolean(),
  source: z.enum(['llm', 'template']),
  intent: z.string(),
});
export type AskAnswer = z.infer<typeof AskAnswer>;
