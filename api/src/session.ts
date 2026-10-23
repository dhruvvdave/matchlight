import type {
  ClockStatus,
  GroupMessage,
  Language,
  MatchMeta,
  ScenarioId,
  StreamRecord,
  ViewerProfile,
} from '@matchlight/schema';
import { profileGroup, sharedGroup } from '@matchlight/schema';
import { MatchOrchestrator, type AgentConfig } from '@matchlight/agents';
import { Replayer, EventValidator, type ReplayBatch } from '@matchlight/pipeline';
import { simulateMatch, toStream } from '@matchlight/simulator';
import type { Hub } from './transport/hub.js';
import type { Store } from './store/store.js';

const TICK_MS = 100;

export interface SessionOptions {
  id: string;
  scenario: ScenarioId;
  seed?: number;
  speed: number;
  hub: Hub;
  store: Store;
  agents: AgentConfig;
  log?: (msg: string, extra?: object) => void;
}

/**
 * One live match: Replayer (INGEST) -> MatchOrchestrator (INTERPRET/EXPLAIN/PERSONALIZE/RENDER) -> Hub.
 * Messages are buffered per group and flushed once per tick to keep push volume low.
 */
export class MatchSession {
  readonly id: string;
  readonly meta: MatchMeta;
  readonly records: StreamRecord[];
  private replayer: Replayer;
  orchestrator!: MatchOrchestrator;
  private profiles = new Map<string, { profile: ViewerProfile; refs: number }>();
  private outbox = new Map<string, unknown[]>();
  private timer: NodeJS.Timeout | null = null;
  private lastWall = 0;
  private lastStateWall = 0;
  private lastClockWall = 0;
  private validator = new EventValidator();
  lastActivity = Date.now();
  private flushing: Promise<void> = Promise.resolve();

  constructor(private readonly opts: SessionOptions) {
    this.id = opts.id;
    const sim = simulateMatch({ scenario: opts.scenario, seed: opts.seed });
    this.meta = sim.meta;
    this.records = toStream(sim);
    this.replayer = new Replayer(this.meta, this.records, opts.speed);
    this.buildOrchestrator();
    void opts.store
      .saveMatch(this.meta, this.id)
      .catch((e) => this.log('store.saveMatch failed', { error: String(e) }));
  }

  private log(msg: string, extra?: object) {
    this.opts.log?.(msg, { session: this.id, ...extra });
  }

  private buildOrchestrator() {
    const a = this.opts.agents;
    this.orchestrator = new MatchOrchestrator(this.meta, {
      llm: a.llm,
      translator: a.translator,
      hallucinationRate: a.hallucinationRate,
      narrativeBudgetMs: a.narrativeBudgetMs,
      publish: (m) => this.route(m),
    });
    this.orchestrator.setSpeed(this.replayer.clock.speed);
    for (const { profile, refs } of this.profiles.values())
      for (let i = 0; i < refs; i++) this.orchestrator.addProfile(profile);
  }

  // ───────────────────────────── routing ─────────────────────────────

  private route(m: GroupMessage) {
    const group = 'profile_key' in m ? profileGroup(this.id, m.profile_key) : sharedGroup(this.id);
    if (m.kind === 'explanation')
      void this.opts.store.saveExplanation(this.meta.match_id, m.explanation).catch(() => {});
    if (m.kind === 'recap') void this.opts.store.saveRecap(m.recap).catch(() => {});
    const box = this.outbox.get(group) ?? [];
    box.push(m);
    this.outbox.set(group, box);
  }

  private flush() {
    if (!this.outbox.size) return;
    const batches = [...this.outbox.entries()];
    this.outbox.clear();
    this.flushing = this.flushing.then(async () => {
      for (const [group, msgs] of batches) {
        // Web PubSub message size limit is 1 MB; chunk to be safe.
        for (let i = 0; i < msgs.length; i += 200) {
          try {
            await this.opts.hub.sendToGroup(group, msgs.slice(i, i + 200));
          } catch (e) {
            this.log('hub.sendToGroup failed', { error: String(e) });
          }
        }
      }
    });
  }

  // ───────────────────────────── loop ─────────────────────────────

  clock(): ClockStatus {
    const c = this.replayer.clock;
    const s = this.orchestrator.stats;
    return {
      ts: Math.round(c.ts * 10) / 10,
      game_s: s.gameS,
      period: s.period,
      speed: c.speed,
      playing: c.playing,
      finished: this.replayer.done,
      duration_ts: c.durationTs,
    };
  }

  start() {
    if (this.timer) return;
    this.lastWall = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  private tick() {
    const now = performance.now();
    const dt = now - this.lastWall;
    this.lastWall = now;
    const batch = this.replayer.tick(dt);
    this.process(batch);
    if (this.replayer.done && this.replayer.clock.playing) {
      this.replayer.clock.pause();
      this.route({ kind: 'clock', clock: this.clock() });
    }
    this.flush();
  }

  private process(batch: ReplayBatch) {
    const events = batch.events.filter((e) => this.validator.check(e) !== null);
    if (events.length || batch.frames.length) {
      this.orchestrator.ingest({ events, frames: batch.frames, catchUp: batch.catchUp });
      if (events.length) {
        this.route({ kind: 'events', events });
        void this.opts.store.appendEvents(this.meta.match_id, events).catch(() => {});
      }
      const frame = batch.frames.at(-1);
      if (frame) this.route({ kind: 'tracking', frame });
    }
    this.orchestrator.tick(this.replayer.clock.ts);
    const wall = performance.now();
    if (wall - this.lastStateWall > 500 || batch.catchUp) {
      this.lastStateWall = wall;
      this.route({ kind: 'state', state: this.orchestrator.stats.snapshot() });
    }
    if (wall - this.lastClockWall > 250 || batch.catchUp) {
      this.lastClockWall = wall;
      this.route({ kind: 'clock', clock: this.clock() });
    }
  }

  // ───────────────────────────── controls ─────────────────────────────

  play() {
    this.touch();
    this.replayer.clock.play();
    this.start();
    this.route({ kind: 'clock', clock: this.clock() });
  }

  pause() {
    this.touch();
    this.replayer.clock.pause();
    this.route({ kind: 'clock', clock: this.clock() });
    this.flush();
  }

  setSpeed(speed: number) {
    this.touch();
    this.replayer.clock.setSpeed(speed);
    this.orchestrator.setSpeed(this.replayer.clock.speed);
    this.route({ kind: 'clock', clock: this.clock() });
  }

  /** Seek to a stream time. Backward seeks rebuild the agent state and fast-forward. */
  seek(ts: number) {
    this.touch();
    const { batch, rewound } = this.replayer.seek(ts);
    if (rewound) {
      this.validator.reset();
      this.buildOrchestrator();
      this.route({ kind: 'reset', reason: 'seek' });
      this.route({ kind: 'meta', meta: this.meta, clock: this.clock() });
    }
    this.process(batch);
    this.flush();
  }

  /** Seek to a football minute (e.g. 56 -> just before 56:00 on the match clock). */
  seekMinute(minute: number) {
    const target = minute * 60;
    const ev = this.records.find(
      (r) =>
        r.kind === 'event' &&
        r.event.game_s >= target &&
        (minute <= 45 ? r.event.period === 1 : r.event.period === 2),
    );
    if (ev && ev.kind === 'event') this.seek(ev.event.ts);
  }

  restart() {
    this.seek(0);
  }

  addProfile(p: ViewerProfile) {
    this.touch();
    const key = this.orchestrator.addProfile(p);
    const cur = this.profiles.get(key);
    if (cur) cur.refs++;
    else this.profiles.set(key, { profile: p, refs: 1 });
    this.flush();
    const st = this.orchestrator.profiles.get(key)!;
    return { key, feed: this.orchestrator.feed(key).slice(-60), overlays: st.scheduler.visible() };
  }

  removeProfile(key: string) {
    const cur = this.profiles.get(key);
    if (!cur) return;
    this.orchestrator.removeProfile(key);
    if (--cur.refs <= 0) this.profiles.delete(key);
  }

  async ask(question: string, profile: ViewerProfile) {
    this.touch();
    const a = await this.orchestrator.ask(question, profile);
    this.flush();
    return a;
  }

  async recap(lang: Language) {
    this.touch();
    const cached = await this.opts.store.getRecap(this.meta.match_id, lang).catch(() => null);
    if (cached && this.replayer.done && cached.final_score.home === this.orchestrator.stats.score.home)
      return cached;
    const r = await this.orchestrator.recap(lang);
    this.flush();
    return r;
  }

  /** Replayable JSONL of everything streamed so far (or the full match). */
  jsonl(all: boolean): string {
    const ts = this.replayer.clock.ts;
    const recs = all
      ? this.records
      : this.records.filter((r) => r.kind === 'meta' || (r.kind === 'event' ? r.event.ts : r.frame.ts) <= ts);
    return recs.map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  summary() {
    const o = this.orchestrator;
    return {
      session_id: this.id,
      meta: this.meta,
      clock: this.clock(),
      state: o.stats.snapshot(),
      moments: o.memory.moments.slice(-200),
      latency: o.latency(),
      metrics: { ...o.metrics, fastPathMs: undefined, llmPathMs: undefined },
      validation: this.validator.stats,
      profiles: [...this.profiles.keys()],
      providers: this.opts.agents.describe,
    };
  }

  private touch() {
    this.lastActivity = Date.now();
  }
}
