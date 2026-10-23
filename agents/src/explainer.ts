import { z } from 'zod';
import type { Explanation, ExplanationDraft, Fact, MatchMeta, Moment } from '@matchlight/schema';
import { ExplanationDraft as DraftSchema } from '@matchlight/schema';
import type { StatsEngine } from '@matchlight/pipeline';
import { CriticAgent, type GroundingContext } from './critic.js';
import type { LlmClient } from './runtime/llm.js';
import type { Tracer } from './runtime/trace.js';
import { defineTool, type Tool } from './runtime/tools.js';

export const EXPLAINER_SYSTEM = `You are the Explainer agent in a live football (soccer) match-intelligence system.
Task: answer "why does this moment matter?" for broadcast analysts.
Rules (a Critic agent will reject violations and you will be asked again):
- Use ONLY the supplied facts. Every number and player name you write must appear in a fact.
- Cite 1-4 facts as evidence by fact_id; evidence.text should restate the fact concisely.
- Direction words (rose/dropped) must match the sign of the fact's delta.
- Keep the claim to one or two sentences, specific and tactical, no hype.
- confidence: 0.5-0.95, lower when evidence is thin.
- event_ids: copy the event ids from the facts you rely on.
You may call tools to look up extra context, but you can only cite facts provided in the prompt.
Respond with JSON: {"claim": string, "evidence": [{"fact_id": string, "text": string}], "confidence": number, "event_ids": string[]}`;

/** Deterministic, grounded-by-construction explanation used offline and as the fallback. */
export function templateDraft(m: Moment, facts: Fact[], s: StatsEngine): ExplanationDraft {
  const by = (k: string) => facts.find((f) => f.tkey === k || f.tkey?.startsWith(k));
  const team = m.team ? s.teamName(m.team) : 'The match';
  const who = m.player_id ? s.playerName(m.player_id) : team;
  const parts: string[] = [];
  const after = facts.find((f) => f.tkey?.startsWith('after_'));
  switch (m.kind) {
    case 'goal': {
      const score = by('score');
      const xg = by('shot_xg');
      parts.push(
        `${who} scores to make it ${score?.value ?? ''}${xg ? `, finishing a ${Number(xg.value) >= 0.3 ? 'high-quality' : Number(xg.value) < 0.1 ? 'low-probability' : 'decent'} chance (${xg.value} xG)` : ''}.`,
      );
      if (after)
        parts.push(`It came after the ${after.params?.min} ${String(after.value).replace(/ \S+$/, '')}.`);
      else if (by('shots_window'))
        parts.push(`Pressure had been building: ${by('shots_window')!.text.split(': ')[1]}.`);
      break;
    }
    case 'big_chance':
    case 'save': {
      const xg = by('shot_xg');
      parts.push(
        `${who} ${m.kind === 'save' ? 'was denied' : 'missed'} a ${xg ? `${xg.value} xG` : 'big'} chance, the kind of opportunity that usually decides tight games.`,
      );
      break;
    }
    case 'red_card':
      parts.push(
        `${who} is sent off: ${by('down_to')?.text ?? 'a numerical disadvantage'}, which forces a reshuffle.`,
      );
      break;
    case 'card':
      parts.push(`${who} is booked; ${by('yellows')?.text.toLowerCase() ?? 'discipline now matters'}.`);
      break;
    case 'substitution':
      parts.push(`${by('sub')?.text ?? 'A change'} as ${team} look for fresh legs.`);
      break;
    case 'tactical_shift': {
      const f = by('formation');
      const p = by('press_setting');
      parts.push(
        `${f?.text ?? `${team} change shape`}${p && typeof p.delta === 'number' ? `, ${p.delta > 0 ? 'pressing higher' : 'dropping deeper'}` : ''}.`,
      );
      break;
    }
    case 'momentum_swing': {
      const mo = by('momentum_change');
      const ht = by('high_turnovers');
      const towards = mo?.team ? s.teamName(mo.team) : team;
      parts.push(
        mo
          ? `Momentum has swung toward ${towards}: the index moved ${mo.params?.from} → ${mo.params?.to} in five minutes.`
          : `Momentum has swung toward ${towards}.`,
      );
      if (ht) parts.push(`${ht.text}.`);
      else if (after)
        parts.push(`The swing follows the ${after.params?.min} ${String(after.value).replace(/ \S+$/, '')}.`);
      break;
    }
    case 'pressing_shift': {
      const p = by('ppda_change');
      const harder = typeof p?.delta === 'number' && p.delta < 0;
      const what = after ? ` after the ${after.params?.min} ${String(after.value).replace(/ \S+$/, '')}` : '';
      parts.push(
        p
          ? `${harder ? `Pressure shifted: ${team} are winning the ball back sooner` : `${possessive(team)} press is fading`}, PPDA ${p.params?.from} → ${p.params?.to} over the last 10 minutes${what}.`
          : `${possessive(team)} pressing has changed${what}.`,
      );
      const ht = by('high_turnovers');
      if (ht) parts.push(`${ht.text}.`);
      break;
    }
    case 'xg_swing':
      parts.push(`${team} are creating real danger: ${by('xg_window_compare')?.text ?? ''}.`);
      break;
    case 'possession_dominance':
      parts.push(`${team} have taken control of the ball: ${by('possession_window')?.text ?? ''}.`);
      break;
    case 'tempo_change':
      parts.push(`The game has sped up: ${by('tempo')?.text ?? ''}.`);
      break;
    case 'chaos_spike':
      parts.push(`Structure has broken down: ${by('control_low')?.text ?? ''}.`);
      break;
    case 'speed_flag':
      parts.push(`${facts[0]?.text ?? 'A burst of pace'}.`);
      break;
    case 'difficult_pass':
      parts.push(`A rare pass from ${who}: ${by('pass_difficulty')?.text ?? ''}.`);
      break;
    case 'player_milestone':
      parts.push(`${facts[0]?.text ?? 'A milestone'}.`);
      break;
    case 'period_summary':
      parts.push(`${by('score')?.text ?? ''}; ${by('team_xg')?.text ?? ''}.`);
      break;
  }
  const evidence = facts.slice(0, 3).map((f) => ({ fact_id: f.id, text: f.text }));
  const event_ids = [...new Set([...m.event_ids, ...facts.flatMap((f) => f.event_ids)])];
  const confidence = Math.min(
    0.92,
    0.55 + 0.12 * evidence.length + (m.kind === 'goal' || m.kind === 'red_card' ? 0.1 : 0),
  );
  return {
    claim: parts.join(' ').replace(/\s+/g, ' ').trim(),
    evidence,
    confidence: Math.round(confidence * 100) / 100,
    event_ids,
  };
}

/**
 * Mock LLM brain for the Explainer: phrases things differently from the template and, on a
 * deterministic subset of first attempts, injects a plausible hallucination (wrong number or an
 * uninvolved player) so the Critic's reject -> regenerate loop is exercised in offline demos.
 */
export function mockExplainerBrain(
  m: Moment,
  facts: Fact[],
  s: StatsEngine,
  attempt: number,
  hallucinationRate: number,
  meta: MatchMeta,
): ExplanationDraft {
  const base = templateDraft(m, facts, s);
  const lead = facts.find((f) => typeof f.delta === 'number') ?? facts[0];
  const claim = lead ? `Why it matters: ${base.claim}` : base.claim;
  const draft = { ...base, claim, confidence: Math.min(0.9, base.confidence) };
  const h = hash(m.id) % 1000;
  if (attempt === 0 && h < hallucinationRate * 1000) {
    if (h % 2 === 0) {
      // Inflate the first number in the claim.
      draft.claim = draft.claim.replace(/(\d+(?:\.\d+)?)/, (n) =>
        String(Math.round(Number(n) * 1.7 * 10) / 10 + 1),
      );
      if (!/\d/.test(base.claim)) draft.claim += ' They have now won 7 of their last 9 duels.';
    } else {
      const others = [...meta.home.players, ...meta.away.players].filter((p) => p.id !== m.player_id);
      const intruder = others[h % others.length];
      draft.claim += ` ${intruder.short_name} was the architect.`;
    }
  }
  return draft;
}

export interface ExplainResult {
  explanation: Explanation;
  attempts: number;
}

/** Explainer agent: LLM (or mock) drafts, Critic verifies, regenerate up to N times, then template fallback. */
export class ExplainerAgent {
  readonly tools: Tool[];
  constructor(
    private readonly s: StatsEngine,
    private readonly llm: LlmClient,
    private readonly critic: CriticAgent,
    private readonly tracer: Tracer,
    private readonly opts: {
      maxAttempts: number;
      hallucinationRate: number;
      timeoutMs: number;
      mafEndpoint?: string;
    },
    extraTools: Tool[] = [],
  ) {
    this.tools = [
      defineTool({
        name: 'get_events',
        description: 'Fetch full event records by id (type, minute, team, player, coordinates, outcome).',
        parameters: z.object({ ids: z.array(z.string()).max(10) }),
        run: (a) => a.ids.map((id) => this.s.byId.get(id)).filter(Boolean),
      }),
      defineTool({
        name: 'xg_swing',
        description:
          'xG created by each team in the last N minutes vs the N minutes before (counterfactual-style context).',
        parameters: z.object({ minutes: z.number().min(2).max(30).default(10) }),
        run: (a) => {
          const now = this.s.ts;
          const w = a.minutes * 60;
          const out: Record<string, { recent: number; before: number }> = {};
          for (const side of ['home', 'away'] as const) {
            out[side] = {
              recent: this.s.teamWindow(side, now - w, now).xg,
              before: this.s.teamWindow(side, now - 2 * w, now - w).xg,
            };
          }
          return out;
        },
      }),
      ...extraTools,
    ];
  }

  async explain(m: Moment, facts: Fact[], traceId: string, parentId?: string): Promise<ExplainResult> {
    const allowedPlayers = new Set<string>();
    if (m.player_id) allowedPlayers.add(m.player_id);
    for (const f of facts) {
      if (f.player_id) allowedPlayers.add(f.player_id);
      for (const id of f.event_ids) {
        const e = this.s.byId.get(id);
        if (e?.player_id) allowedPlayers.add(e.player_id);
      }
    }
    for (const id of m.event_ids) {
      const e = this.s.byId.get(id);
      if (e?.player_id) allowedPlayers.add(e.player_id);
      if (e && 'player_in_id' in e) allowedPlayers.add(e.player_in_id);
      if (e && 'assist_id' in e && e.assist_id) allowedPlayers.add(e.assist_id);
    }
    const ctx: GroundingContext = {
      facts,
      moment: m,
      meta: this.s.meta,
      allowedPlayers,
      knownEventIds: (id) => this.s.byId.has(id),
    };
    if (this.opts.mafEndpoint) {
      const viaMaf = await this.explainViaMaf(m, facts, ctx, traceId, parentId);
      if (viaMaf) return viaMaf;
    }
    let attempts = 0;
    let lastIssues: Explanation['critic']['issues'] = [];
    let feedback = '';
    while (attempts < this.opts.maxAttempts) {
      const attempt = attempts++;
      let draft: unknown;
      try {
        draft = await this.tracer.span(
          'explainer',
          attempt === 0 ? 'draft' : `redraft #${attempt}`,
          traceId,
          async (h) => {
            const res = await this.llm.complete({
              agent: 'explainer',
              system: EXPLAINER_SYSTEM,
              user: this.prompt(m, facts, feedback),
              schema: DraftSchema,
              schemaName: 'explanation',
              temperature: 0.3,
              timeoutMs: this.opts.timeoutMs,
              tools: this.tools,
              mock: () =>
                mockExplainerBrain(m, facts, this.s, attempt, this.opts.hallucinationRate, this.s.meta),
              onToolCall: (name, args) =>
                this.tracer.point(
                  'explainer',
                  `tool:${name}`,
                  traceId,
                  `${name}(${JSON.stringify(args).slice(0, 80)})`,
                  undefined,
                  'ok',
                  h.id,
                ),
            });
            h.set({ provider: res.provider, model: res.model, tool_calls: res.tool_calls, usage: res.usage });
            h.summary(
              `${res.provider} draft: "${res.data.claim.slice(0, 90)}${res.data.claim.length > 90 ? '…' : ''}"`,
            );
            return res.data;
          },
          parentId,
        );
      } catch (e) {
        lastIssues = [{ code: 'schema', detail: `LLM error: ${(e as Error).message}` }];
        break;
      }
      const verdict = await this.tracer.span(
        'critic',
        'groundedness',
        traceId,
        (h) => {
          const v = this.critic.checkExplanation(draft, ctx);
          h.status(v.ok ? 'ok' : 'rejected');
          h.summary(
            v.ok
              ? `grounded: ${facts.length} facts, numbers & names verified`
              : `REJECTED: ${v.issues.map((i) => i.detail).join('; ')}`,
          );
          h.set({ issues: v.issues });
          return v;
        },
        parentId,
      );
      if (verdict.ok && verdict.draft) {
        return {
          explanation: this.finalise(
            m,
            facts,
            verdict.draft,
            this.llm.provider === 'mock' ? 'llm' : 'llm',
            attempts,
            [],
          ),
          attempts,
        };
      }
      lastIssues = verdict.issues;
      feedback = `Your previous answer was rejected by the Critic: ${verdict.issues.map((i) => `${i.code}: ${i.detail}`).join('; ')}. Fix these problems.`;
    }
    // Fallback: template explanation is grounded by construction (still verified for the record).
    const tpl = templateDraft(m, facts, this.s);
    const v = this.critic.checkExplanation(tpl, ctx);
    this.tracer.point(
      'explainer',
      'template fallback',
      traceId,
      `fallback after ${attempts} attempt(s): "${tpl.claim.slice(0, 80)}"`,
      { issues: lastIssues, template_grounded: v.ok },
      'fallback',
      parentId,
    );
    return { explanation: this.finalise(m, facts, tpl, 'template', attempts, lastIssues), attempts };
  }

  /**
   * Delegate the Explainer <-> Critic loop to the Microsoft Agent Framework sidecar (agents-maf/).
   * Its result is re-verified by this process's Critic before use (defence in depth).
   */
  private async explainViaMaf(
    m: Moment,
    facts: Fact[],
    ctx: GroundingContext,
    traceId: string,
    parentId?: string,
  ): Promise<ExplainResult | null> {
    const names = (ids: Iterable<string>) =>
      [...ids].map((id) => this.s.player(id)?.name).filter((n): n is string => !!n);
    const everyone = [...this.s.meta.home.players, ...this.s.meta.away.players].map((p) => p.id);
    try {
      const res = await this.tracer.span(
        'explainer',
        'maf workflow',
        traceId,
        async (h) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs * 2);
          try {
            const r = await fetch(`${this.opts.mafEndpoint!.replace(/\/$/, '')}/explain`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: ctrl.signal,
              body: JSON.stringify({
                moment: { id: m.id, kind: m.kind, minute_label: m.minute_label, headline: m.headline },
                facts,
                allowed_names: names(ctx.allowedPlayers),
                disallowed_names: names(everyone.filter((id) => !ctx.allowedPlayers.has(id))),
                known_event_ids: [...new Set([...m.event_ids, ...facts.flatMap((f) => f.event_ids)])],
                max_attempts: this.opts.maxAttempts,
              }),
            });
            if (!r.ok) throw new Error(`MAF sidecar ${r.status}`);
            const body = (await r.json()) as {
              draft: unknown;
              grounded: boolean;
              attempts: number;
              issues: Explanation['critic']['issues'];
              events: { agent: 'explainer' | 'critic'; op: string; status?: string; summary: string }[];
            };
            for (const e of body.events)
              this.tracer.point(
                e.agent,
                `maf:${e.op}`,
                traceId,
                e.summary,
                undefined,
                e.status === 'rejected' ? 'rejected' : 'ok',
                h.id,
              );
            h.summary(
              `Microsoft Agent Framework workflow: ${body.attempts} attempt(s), ${body.grounded ? 'grounded' : 'not grounded'}`,
            );
            return body;
          } finally {
            clearTimeout(timer);
          }
        },
        parentId,
      );
      const verdict = this.critic.checkExplanation(res.draft, ctx);
      this.tracer.point(
        'critic',
        're-verify',
        traceId,
        verdict.ok
          ? 'MAF result re-verified in-process'
          : `MAF result REJECTED in-process: ${verdict.issues.map((i) => i.detail).join('; ')}`,
        undefined,
        verdict.ok ? 'ok' : 'rejected',
        parentId,
      );
      if (!verdict.ok || !verdict.draft) return null;
      return {
        explanation: this.finalise(m, facts, verdict.draft, 'llm', res.attempts, res.issues ?? []),
        attempts: res.attempts,
      };
    } catch (e) {
      this.tracer.point(
        'explainer',
        'maf unavailable',
        traceId,
        `MAF sidecar failed (${(e as Error).message}); using in-process loop`,
        undefined,
        'fallback',
        parentId,
      );
      return null;
    }
  }

  private prompt(m: Moment, facts: Fact[], feedback: string): string {
    return JSON.stringify(
      {
        moment: {
          kind: m.kind,
          minute: m.minute_label,
          headline: m.headline,
          team: m.team ? this.s.teamName(m.team) : null,
          player: m.player_id ? this.s.playerName(m.player_id) : null,
        },
        score: this.s.score,
        facts: facts.map((f) => ({
          fact_id: f.id,
          text: f.text,
          value: f.value,
          previous: f.previous,
          delta: f.delta,
          event_ids: f.event_ids,
        })),
        feedback: feedback || undefined,
      },
      null,
      1,
    );
  }

  private finalise(
    m: Moment,
    facts: Fact[],
    d: ExplanationDraft,
    source: 'llm' | 'template',
    attempts: number,
    issues: Explanation['critic']['issues'],
  ): Explanation {
    return {
      id: `x-${m.id}`,
      moment_id: m.id,
      kind: m.kind,
      ts: m.ts,
      minute_label: m.minute_label,
      team: m.team,
      player_id: m.player_id,
      claim: d.claim,
      evidence: d.evidence,
      confidence: d.confidence,
      event_ids: d.event_ids.filter((id) => this.s.byId.has(id)),
      facts,
      source,
      critic: { grounded: true, attempts, issues },
    };
  }
}

const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
