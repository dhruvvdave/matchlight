import type {
  Explanation,
  Fact,
  FeedItem,
  Flag,
  GroupMessage,
  Language,
  MatchEvent,
  MatchMeta,
  Moment,
  Recap,
  TrackingFrame,
  ViewerProfile,
} from '@matchlight/schema';
import { formatMinute, languageDir, normaliseProfile, profileKey } from '@matchlight/schema';
import {
  DEFAULT_SCHEDULER,
  OverlayBuilder,
  OverlayScheduler,
  StatsEngine,
  type SchedulerAction,
} from '@matchlight/pipeline';
import { AskAgent } from './ask.js';
import { CriticAgent, type GroundingContext } from './critic.js';
import { DirectorAgent, type DirectorDecision } from './director.js';
import { ExplainerAgent, templateDraft } from './explainer.js';
import { factText } from './i18n/facts.js';
import { fill, pickTemplate } from './i18n/narrative.js';
import { NarratorAgent } from './narrator.js';
import { PersonalizationAgent, type ProfilePlan } from './personalizer.js';
import { RecapAgent } from './recap.js';
import { RendererAgent } from './renderer.js';
import { Blackboard } from './runtime/memory.js';
import type { LlmClient } from './runtime/llm.js';
import { Tracer } from './runtime/trace.js';
import { StatsAgent } from './stats-agent.js';
import type { TranslatorAgent } from './translator.js';

export interface OrchestratorOptions {
  llm: LlmClient;
  translator: TranslatorAgent;
  publish: (msg: GroupMessage) => void;
  /** Await the async LLM path inline (tests / golden files). */
  deterministic?: boolean;
  /** Mock-LLM only: share of first drafts that contain an injected error for the Critic to catch. */
  hallucinationRate?: number;
  /** Max wall ms for an LLM narrative to replace the template line before we give up. */
  narrativeBudgetMs?: number;
  explainTimeoutMs?: number;
  wallNow?: () => number;
}

interface ProfileState {
  key: string;
  profile: ViewerProfile;
  builder: OverlayBuilder;
  scheduler: OverlayScheduler;
  refs: number;
  lastPlayerUpdate: number;
  lastMetricUpdate: number;
  feedSeq: number;
  /** Template feed item / card per moment, so the LLM version can supersede it. */
  byMoment: Map<string, { feedId: string; plan: ProfilePlan; line: string }>;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

const summarise = (xs: number[]): LatencyStats => {
  if (!xs.length) return { count: 0, p50: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100;
  return { count: xs.length, p50: q(0.5), p95: q(0.95), max: Math.round(s[s.length - 1] * 100) / 100 };
};

/**
 * Wires the five stages for one match session:
 *  INGEST (caller) -> INTERPRET (StatsEngine) -> Director -> EXPLAIN (Stats agent + Explainer + Critic)
 *  -> PERSONALIZE (Personalizer + Narrator + Translator) -> RENDER (Renderer + Scheduler) -> publish.
 * Fast path is synchronous (template narration, overlays); LLM work is async and supersedes it.
 */
export class MatchOrchestrator {
  readonly stats: StatsEngine;
  readonly memory = new Blackboard();
  readonly tracer: Tracer;
  readonly director: DirectorAgent;
  readonly statsAgent: StatsAgent;
  readonly critic: CriticAgent;
  readonly explainer: ExplainerAgent;
  readonly narrator: NarratorAgent;
  readonly personalizer: PersonalizationAgent;
  readonly renderer: RendererAgent;
  readonly recapAgent: RecapAgent;
  readonly askAgent: AskAgent;
  readonly profiles = new Map<string, ProfileState>();
  readonly recaps = new Map<Language, Recap>();
  private timeScale = 1;
  private pending = new Set<Promise<unknown>>();
  private lastMomentumBar = -Infinity;
  private lastTickTs = 0;
  private finished = false;
  private readonly wallNow: () => number;
  readonly metrics = {
    fastPathMs: [] as number[],
    llmPathMs: [] as number[],
    moments: 0,
    explained: 0,
    criticRejections: 0,
    fallbacks: 0,
    llmNarratives: 0,
    llmTooSlow: 0,
  };

  constructor(
    readonly meta: MatchMeta,
    private readonly opts: OrchestratorOptions,
  ) {
    this.wallNow = opts.wallNow ?? (() => performance.now());
    this.stats = new StatsEngine(meta);
    this.tracer = new Tracer(() => this.stats.ts, this.wallNow);
    this.director = new DirectorAgent(this.stats, this.memory);
    this.statsAgent = new StatsAgent(this.stats);
    this.critic = new CriticAgent(meta);
    this.explainer = new ExplainerAgent(
      this.stats,
      opts.llm,
      this.critic,
      this.tracer,
      {
        maxAttempts: 3,
        hallucinationRate: opts.hallucinationRate ?? 0,
        timeoutMs: opts.explainTimeoutMs ?? 8000,
      },
      this.statsAgent.tools,
    );
    this.narrator = new NarratorAgent(this.stats);
    this.personalizer = new PersonalizationAgent(this.stats);
    this.renderer = new RendererAgent(this.stats);
    this.recapAgent = new RecapAgent(
      this.stats,
      this.memory,
      opts.llm,
      this.critic,
      opts.translator,
      this.tracer,
    );
    this.askAgent = new AskAgent(
      this.stats,
      this.memory,
      opts.llm,
      this.critic,
      opts.translator,
      this.tracer,
      this.statsAgent.tools,
    );
    this.tracer.onSpan((span) => opts.publish({ kind: 'trace', spans: [span] }));
  }

  // ───────────────────────────── profiles ─────────────────────────────

  addProfile(input: ViewerProfile): string {
    const profile = normaliseProfile(input);
    const key = profileKey(profile);
    const existing = this.profiles.get(key);
    if (existing) {
      existing.refs++;
      return key;
    }
    const st: ProfileState = {
      key,
      profile,
      builder: new OverlayBuilder({
        meta: this.meta,
        profileKey: key,
        language: profile.language,
        highContrast: profile.high_contrast,
      }),
      scheduler: new OverlayScheduler(this.schedulerCfg()),
      refs: 1,
      lastPlayerUpdate: this.stats.ts,
      lastMetricUpdate: -Infinity,
      feedSeq: 0,
      byMoment: new Map(),
    };
    this.profiles.set(key, st);
    if (this.stats.events.length > 0 && this.stats.status !== 'pre') {
      const persona = profile.mode === 'analyst' || profile.mode === 'metric' ? 'analyst' : 'casual';
      const picked = pickTemplate(profile.language, 'catchup', persona, 0);
      if (picked) {
        this.pushFeed(st, {
          kind: 'system',
          text: fill(picked.tpl, {
            min: formatMinute(this.stats.gameS, this.stats.period),
            home: this.meta.home.name,
            away: this.meta.away.name,
            score: `${this.stats.score.home}-${this.stats.score.away}`,
          }),
          lang: picked.lang,
          emphasis: 1,
          event_ids: [],
          source: 'template',
        });
      }
      this.persistentOverlays(st, this.stats.ts, true);
    }
    return key;
  }

  removeProfile(key: string) {
    const st = this.profiles.get(key);
    if (!st) return;
    if (--st.refs <= 0) this.profiles.delete(key);
  }

  feed(key: string): FeedItem[] {
    return this.memory.feeds.get(key) ?? [];
  }

  private schedulerCfg() {
    const k = this.timeScale;
    return {
      ...DEFAULT_SCHEDULER,
      minDisplay: DEFAULT_SCHEDULER.minDisplay * k,
      maxQueueWait: DEFAULT_SCHEDULER.maxQueueWait * k,
      cooldown: DEFAULT_SCHEDULER.cooldown * k,
    };
  }

  /** Overlay durations are stream seconds; when replaying at N x we stretch them so they stay watchable. */
  setSpeed(speed: number) {
    this.timeScale = Math.max(1, speed / 1.5);
    for (const st of this.profiles.values()) st.scheduler = new OverlayScheduler(this.schedulerCfg());
  }

  // ───────────────────────────── ingest ─────────────────────────────

  ingest(batch: { events: MatchEvent[]; frames: TrackingFrame[]; catchUp: boolean }) {
    // Merge by stream time so flags raised by tracking land in the right order relative to events.
    let fi = 0;
    for (const e of batch.events) {
      while (fi < batch.frames.length && batch.frames[fi].ts < e.ts)
        this.onFlags(null, this.stats.ingestFrame(batch.frames[fi++]), batch.catchUp);
      const t0 = this.wallNow();
      const flags = this.stats.ingestEvent(e);
      this.onFlags(e, flags, batch.catchUp, t0);
      if (!batch.catchUp) this.onEventPersonal(e);
      if (e.type === 'match_end') this.onMatchEnd();
    }
    while (fi < batch.frames.length)
      this.onFlags(null, this.stats.ingestFrame(batch.frames[fi++]), batch.catchUp);
    if (batch.catchUp) {
      // After a seek, re-anchor persistent overlays rather than replaying every skipped moment.
      for (const st of this.profiles.values()) this.persistentOverlays(st, this.stats.ts, true);
    }
  }

  private onFlags(e: MatchEvent | null, flags: Flag[], catchUp: boolean, t0 = this.wallNow()) {
    if (!e && !flags.length) return;
    const decisions = this.director.consider(e, flags);
    for (const d of decisions) this.handleMoment(d, catchUp, t0);
  }

  private handleMoment(d: DirectorDecision, catchUp: boolean, t0: number) {
    const m = d.moment;
    this.metrics.moments++;
    this.opts.publish({ kind: 'moment', moment: m });
    if (catchUp) return;
    const traceId = this.tracer.newTrace();
    this.tracer.point(
      'director',
      'surface',
      traceId,
      `${m.minute_label} ${m.kind} sig=${m.significance.toFixed(2)}${d.explain ? ' → explain' : ''}: ${m.headline}`,
      { reasons: d.reasons, topic: m.topic },
    );

    // EXPLAIN (fast): facts via Stats agent tools, grounded template explanation.
    const facts = this.statsAgent.gather(m);
    this.tracer.point(
      'stats',
      'gather facts',
      traceId,
      `${this.statsAgent.toolLog.length} tool call(s) → ${facts.length} fact(s)`,
      { tools: this.statsAgent.toolLog.map((t) => t.name), facts: facts.map((f) => f.text) },
    );
    const tplX = this.templateExplanation(m, facts);
    this.memory.addExplanation(tplX);
    this.opts.publish({ kind: 'explanation', explanation: tplX });

    // PERSONALIZE + RENDER (fast) for each subscribed profile.
    const planSummary: string[] = [];
    for (const st of this.profiles.values()) {
      const plan = this.personalizer.plan(m, st.profile);
      if (!plan.surface) {
        planSummary.push(`${st.key}: skip`);
        continue;
      }
      const line = this.localLine(m, facts, plan, st);
      if (!line) continue;
      const feedId = this.pushFeed(st, {
        kind: m.significance >= 0.6 ? 'key_moment' : 'commentary',
        text: line.text,
        lang: line.lang,
        emphasis: plan.emphasis,
        event_ids: m.event_ids,
        source: 'template',
        moment: m,
        explanation_id: tplX.id,
        metrics:
          plan.persona === 'analyst'
            ? facts
                .slice(0, 3)
                .filter((f) => typeof f.value === 'number')
                .map((f) => ({ label: f.label, value: String(f.value) }))
            : undefined,
      });
      st.byMoment.set(m.id, { feedId, plan, line: line.text });
      const overlays = this.renderer.render(st.builder, {
        moment: m,
        plan,
        facts,
        line: line.text,
        confidence: tplX.confidence,
        explanationId: tplX.id,
        profile: st.profile,
        timeScale: this.timeScale,
      });
      for (const o of overlays) this.apply(st, st.scheduler.offer(o, this.stats.ts));
      planSummary.push(`${st.key}: ${plan.overlays.join('+') || 'feed'}`);
    }
    const fast = this.wallNow() - t0;
    this.metrics.fastPathMs.push(fast);
    if (this.metrics.fastPathMs.length > 500) this.metrics.fastPathMs.shift();
    this.tracer.point(
      'personalizer',
      'plan + render',
      traceId,
      `${planSummary.length ? planSummary.join(' | ') : 'no profiles'} (fast path ${fast.toFixed(1)} ms)`,
      { latency_budget_ms: 1500, fast_path_ms: Math.round(fast * 100) / 100 },
    );

    if (d.explain) {
      this.metrics.explained++;
      const task = this.slowPath(m, facts, traceId).catch((e) =>
        this.tracer.point('explainer', 'error', traceId, (e as Error).message, undefined, 'error'),
      );
      this.track(task);
    }
  }

  private templateExplanation(m: Moment, facts: Fact[]): Explanation {
    const d = templateDraft(m, facts, this.stats);
    return {
      id: `x-${m.id}`,
      moment_id: m.id,
      kind: m.kind,
      ts: m.ts,
      minute_label: m.minute_label,
      team: m.team,
      player_id: m.player_id,
      claim: d.claim,
      evidence: d.evidence.length ? d.evidence : [{ fact_id: 'none', text: m.headline }],
      confidence: d.confidence,
      event_ids: d.event_ids.filter((id) => this.stats.byId.has(id)),
      facts,
      source: 'template',
      critic: { grounded: true, attempts: 0, issues: [] },
    };
  }

  private groundingCtx(m: Moment, facts: Fact[]): GroundingContext {
    const allowed = new Set<string>();
    if (m.player_id) allowed.add(m.player_id);
    for (const f of facts) if (f.player_id) allowed.add(f.player_id);
    for (const id of [...m.event_ids, ...facts.flatMap((f) => f.event_ids)]) {
      const e = this.stats.byId.get(id) as
        | (MatchEvent & { player_in_id?: string; assist_id?: string; recipient_id?: string })
        | undefined;
      for (const pid of [e?.player_id, e?.player_in_id, e?.assist_id, e?.recipient_id])
        if (pid) allowed.add(pid);
    }
    return {
      facts,
      moment: m,
      meta: this.meta,
      allowedPlayers: allowed,
      knownEventIds: (id) => this.stats.byId.has(id),
    };
  }

  /** Localised template line, checked by the Critic against persona rules. */
  private localLine(m: Moment, facts: Fact[], plan: ProfilePlan, st: ProfileState) {
    const line = this.narrator.templateLine(m, facts, plan.persona, st.profile.language, st.profile);
    if (!line) return null;
    const issues = this.critic.checkText(line.text, this.groundingCtx(m, facts), {
      maxNumbers: plan.maxNumbers,
    });
    if (issues.length) {
      this.metrics.criticRejections++;
      this.tracer.point(
        'critic',
        'template check',
        'tpl',
        `template line flagged for ${st.key}: ${issues.map((i) => i.detail).join('; ')}`,
        { issues, text: line.text },
        'rejected',
      );
      // Analyst-style fallback keeps it factual; persona limits are style, facts are not negotiable.
      if (issues.some((i) => i.code !== 'too_many_numbers')) return null;
    }
    return line;
  }

  // ───────────────────────────── async LLM path ─────────────────────────────

  private async slowPath(m: Moment, facts: Fact[], traceId: string) {
    const started = this.wallNow();
    const { explanation: x } = await this.explainer.explain(m, facts, traceId);
    if (x.critic.issues.length) this.metrics.criticRejections += x.critic.issues.length ? 1 : 0;
    if (x.source === 'template') this.metrics.fallbacks++;
    this.memory.addExplanation(x);
    this.opts.publish({ kind: 'explanation', explanation: x });
    for (const st of this.profiles.values()) {
      const prior = st.byMoment.get(m.id);
      if (!prior) continue;
      await this.upgradeNarrative(st, m, x, prior, traceId, started);
    }
    this.metrics.llmPathMs.push(this.wallNow() - started);
    if (this.metrics.llmPathMs.length > 500) this.metrics.llmPathMs.shift();
  }

  private async upgradeNarrative(
    st: ProfileState,
    m: Moment,
    x: Explanation,
    prior: { feedId: string; plan: ProfilePlan; line: string },
    traceId: string,
    started: number,
  ) {
    const lang = st.profile.language;
    const budget = this.opts.narrativeBudgetMs ?? 6000;
    if (x.source === 'template') return;
    if (this.opts.llm.provider === 'mock' && lang !== 'en') {
      this.tracer.point(
        'translator',
        'offline',
        traceId,
        `${st.key}: kept localised template (no translation provider offline)`,
        undefined,
        'skipped',
      );
      this.updateCard(st, m, x, prior.line);
      return;
    }
    const req = this.narrator.llmRequest(m, x, prior.plan.persona);
    let text: string;
    try {
      text = await this.tracer.span('narrator', `narrate:${prior.plan.persona}`, traceId, async (h) => {
        const res = await this.opts.llm.complete({
          agent: 'narrator',
          ...req,
          schemaName: 'narration',
          temperature: 0.7,
          timeoutMs: budget,
        });
        h.summary(`${st.key}: "${res.data.text.slice(0, 90)}"`);
        h.set({ provider: res.provider });
        return res.data.text;
      });
    } catch (e) {
      this.metrics.llmTooSlow++;
      this.tracer.point(
        'narrator',
        'fallback',
        traceId,
        `${st.key}: ${(e as Error).message}; template line kept`,
        undefined,
        'fallback',
      );
      return;
    }
    const ctx = this.groundingCtx(m, x.facts);
    const issues = this.critic.checkText(text, ctx, { maxNumbers: prior.plan.maxNumbers });
    this.tracer.point(
      'critic',
      'narrative check',
      traceId,
      issues.length
        ? `REJECTED ${st.key}: ${issues.map((i) => i.detail).join('; ')}`
        : `${st.key}: narrative grounded`,
      { issues },
      issues.length ? 'rejected' : 'ok',
    );
    if (issues.length) {
      this.metrics.criticRejections++;
      return;
    }
    let source: FeedItem['source'] = 'llm';
    if (lang !== 'en') {
      if (!this.opts.translator.available) return;
      try {
        const protect = [...ctx.allowedPlayers]
          .map((id) => this.stats.playerName(id))
          .concat([this.meta.home.name, this.meta.away.name]);
        const tr = await this.tracer.span('translator', `translate:${lang}`, traceId, async (h) => {
          const r = await this.opts.translator.translate(text, lang, protect);
          h.summary(
            `${lang} via ${r.provider}; glossary ${r.glossary.filter((g) => g.present).length}/${r.glossary.length}`,
          );
          h.set({ glossary: r.glossary });
          return r;
        });
        const trIssues = this.critic.checkText(tr.text, ctx).filter((i) => i.code === 'unsupported_number');
        if (trIssues.length) {
          this.tracer.point(
            'critic',
            'translation check',
            traceId,
            `REJECTED translation: ${trIssues.map((i) => i.detail).join('; ')}`,
            undefined,
            'rejected',
          );
          return;
        }
        text = tr.text;
        source = 'translator';
      } catch (e) {
        this.tracer.point(
          'translator',
          'fallback',
          traceId,
          `translation failed: ${(e as Error).message}`,
          undefined,
          'fallback',
        );
        return;
      }
    }
    if (this.wallNow() - started > budget) {
      this.metrics.llmTooSlow++;
      this.tracer.point(
        'narrator',
        'over budget',
        traceId,
        `${st.key}: LLM narrative arrived after ${budget} ms; template kept`,
        undefined,
        'fallback',
      );
      return;
    }
    this.metrics.llmNarratives++;
    this.pushFeed(st, {
      kind: m.significance >= 0.6 ? 'key_moment' : 'commentary',
      text,
      lang,
      emphasis: prior.plan.emphasis,
      event_ids: x.event_ids,
      source,
      moment: m,
      explanation_id: x.id,
      supersedes: prior.feedId,
      metrics:
        prior.plan.persona === 'analyst'
          ? x.facts
              .slice(0, 3)
              .filter((f) => typeof f.value === 'number')
              .map((f) => ({ label: f.label, value: String(f.value) }))
          : undefined,
    });
    this.updateCard(st, m, x, text);
  }

  /** Refresh the moment's key card in place with the verified explanation. */
  private updateCard(st: ProfileState, m: Moment, x: Explanation, body: string) {
    const visible = st.scheduler
      .visible()
      .find((o) => o.kind === 'key_moment_card' && o.debounce_key === `card:${m.topic}`);
    if (!visible || visible.kind !== 'key_moment_card') return;
    const prior = st.byMoment.get(m.id);
    const evidence = prior?.plan.showEvidence
      ? x.evidence.map((e) => {
          const f = x.facts.find((ff) => ff.id === e.fact_id);
          return f ? factText(f, st.profile.language) : e.text;
        })
      : visible.content.evidence;
    const updated = {
      ...visible,
      explanation_id: x.id,
      content: {
        ...visible.content,
        body,
        evidence,
        confidence: prior?.plan.showEvidence ? x.confidence : undefined,
      },
    };
    if (updated.content.confidence === undefined) delete updated.content.confidence;
    this.apply(st, st.scheduler.offer(updated, this.stats.ts));
  }

  // ───────────────────────────── per-profile periodic content ─────────────────────────────

  private onEventPersonal(e: MatchEvent) {
    for (const st of this.profiles.values()) {
      const p = st.profile;
      if (e.type === 'period_start' && e.period === 1) {
        const persona = p.mode === 'analyst' || p.mode === 'metric' ? 'analyst' : 'casual';
        const picked = pickTemplate(p.language, 'kickoff', persona, 0);
        if (picked)
          this.pushFeed(st, {
            kind: 'system',
            text: fill(picked.tpl, {
              stadium: this.meta.stadium,
              home: this.meta.home.name,
              away: this.meta.away.name,
            }),
            lang: picked.lang,
            emphasis: 1,
            event_ids: [e.id],
            source: 'template',
          });
      }
      if (p.mode === 'metric' && (e.type === 'pass' || e.type === 'shot')) {
        if (this.stats.ts - st.lastMetricUpdate >= 2 * this.timeScale) {
          const o = this.renderer.metricBadge(st.builder, p, e.ts, this.timeScale, e.id);
          if (o) {
            st.lastMetricUpdate = this.stats.ts;
            this.apply(st, st.scheduler.offer(o, this.stats.ts));
          }
        }
      }
    }
  }

  private persistentOverlays(st: ProfileState, ts: number, force = false) {
    const mode = st.profile.mode;
    if (mode === 'analyst' || mode === 'club' || mode === 'casual') {
      this.apply(
        st,
        st.scheduler.offer(this.renderer.momentumBar(st.builder, st.profile, ts, this.timeScale), ts),
      );
    }
    if (
      mode === 'metric' &&
      (force || !['ball_speed', 'pass_difficulty'].includes(st.profile.metric ?? ''))
    ) {
      const o = this.renderer.metricBadge(
        st.builder,
        st.profile,
        ts,
        this.timeScale,
        this.stats.events.filter((e) => e.type === 'pass').at(-1)?.id,
      );
      if (o) this.apply(st, st.scheduler.offer(o, ts));
    }
  }

  private playerUpdate(st: ProfileState, recap = false) {
    const id = st.profile.focus_player_id;
    if (!id) return;
    const ps = this.stats.playerStats(id);
    if (!ps || (ps.touches === 0 && !recap)) return;
    const picked = pickTemplate(st.profile.language, recap ? 'player_recap' : 'player_update', 'player', 0);
    if (!picked) return;
    const text = fill(picked.tpl, {
      player: this.stats.playerName(id),
      touches: ps.touches,
      passes: ps.passes_completed,
      km: (ps.distance_m / 1000).toFixed(1),
      speed: ps.top_speed_kmh.toFixed(1),
      rating: ps.rating.toFixed(1),
    });
    this.pushFeed(st, {
      kind: recap ? 'recap' : 'stat',
      text,
      lang: picked.lang,
      emphasis: recap ? 2 : 1,
      event_ids: [],
      source: 'template',
      player_id: id,
      metrics: [
        { label: 'touches', value: String(ps.touches) },
        { label: 'km', value: (ps.distance_m / 1000).toFixed(1) },
        { label: 'top km/h', value: ps.top_speed_kmh.toFixed(1) },
        { label: 'rating', value: ps.rating.toFixed(1) },
      ],
    });
  }

  /** Advance overlay schedulers and periodic content to stream time `ts`. */
  tick(ts: number) {
    if (ts < this.lastTickTs) return;
    this.lastTickTs = ts;
    const live = this.stats.status === 'live';
    const doBar = live && ts - this.lastMomentumBar >= 60;
    if (doBar) this.lastMomentumBar = ts;
    for (const st of this.profiles.values()) {
      if (doBar) this.persistentOverlays(st, ts);
      if (live && st.profile.mode === 'player' && ts - st.lastPlayerUpdate >= 600) {
        st.lastPlayerUpdate = ts;
        this.playerUpdate(st);
      }
      this.apply(st, st.scheduler.tick(ts));
    }
  }

  private onMatchEnd() {
    if (this.finished) return;
    this.finished = true;
    for (const st of this.profiles.values()) if (st.profile.mode === 'player') this.playerUpdate(st, true);
    const langs = new Set<Language>(['en', ...[...this.profiles.values()].map((s) => s.profile.language)]);
    for (const lang of langs) this.track(this.recap(lang));
  }

  // ───────────────────────────── outputs ─────────────────────────────

  private apply(st: ProfileState, actions: SchedulerAction[]) {
    for (const a of actions) {
      if (a.type === 'clear')
        this.opts.publish({ kind: 'overlay_clear', profile_key: st.key, overlay_id: a.id });
      else this.opts.publish({ kind: 'overlay', profile_key: st.key, overlay: a.overlay });
    }
  }

  private pushFeed(
    st: ProfileState,
    f: Omit<
      FeedItem,
      'id' | 'profile_key' | 'ts' | 'minute_label' | 'dir' | 'moment_id' | 'moment_kind' | 'team'
    > & { moment?: Moment },
  ): string {
    const { moment, ...rest } = f;
    const item: FeedItem = {
      id: `${st.key}#${st.feedSeq++}`,
      profile_key: st.key,
      ts: Math.round((moment?.ts ?? this.stats.ts) * 10) / 10,
      minute_label: moment?.minute_label ?? formatMinute(this.stats.gameS, this.stats.period),
      dir: languageDir(rest.lang),
      ...rest,
      ...(moment
        ? {
            moment_id: moment.id,
            moment_kind: moment.kind,
            team: moment.team,
            player_id: rest.player_id ?? moment.player_id,
          }
        : {}),
    };
    for (const k of Object.keys(item) as (keyof FeedItem)[]) if (item[k] === undefined) delete item[k];
    this.memory.pushFeed(item);
    this.opts.publish({ kind: 'feed', profile_key: st.key, item });
    return item.id;
  }

  private track<T>(p: Promise<T>) {
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }

  /** Wait for all in-flight async (LLM) work. */
  async flush() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  async recap(lang: Language): Promise<Recap> {
    const cached = this.recaps.get(lang);
    if (cached && cached.generated_at_ts === this.stats.ts) return cached;
    const r = await this.recapAgent.build(lang, this.tracer.newTrace('r'));
    this.recaps.set(lang, r);
    this.opts.publish({ kind: 'recap', recap: r });
    return r;
  }

  async ask(question: string, profile: ViewerProfile) {
    const key = profileKey(normaliseProfile(profile));
    const answer = await this.askAgent.answer(question, profile.language, this.tracer.newTrace('q'));
    this.opts.publish({ kind: 'answer', profile_key: key, answer });
    return answer;
  }

  latency() {
    return { fast_path: summarise(this.metrics.fastPathMs), llm_path: summarise(this.metrics.llmPathMs) };
  }
}
