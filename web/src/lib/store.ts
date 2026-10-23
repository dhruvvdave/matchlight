import { useEffect, useReducer, useRef } from 'react';
import type {
  AskAnswer,
  ClockStatus,
  Explanation,
  FeedItem,
  GroupMessage,
  LiveState,
  MatchEvent,
  MatchMeta,
  Moment,
  Overlay,
  Recap,
  TraceSpan,
  TrackingFrame,
  ViewerProfile,
} from '@matchlight/schema';
import { profileKey, normaliseProfile, sharedGroup } from '@matchlight/schema';
import { api } from './api';
import { PubSubClient } from './transport';

export interface ViewerData {
  key: string;
  profile: ViewerProfile;
  feed: FeedItem[];
  overlays: Map<string, Overlay>;
  answers: AskAnswer[];
  refs: number;
}

type Listener = () => void;

/**
 * Client-side session store. Receives Web PubSub group messages and keeps the latest state;
 * React components subscribe and re-render at most once per animation frame.
 */
export class SessionStore {
  meta: MatchMeta | null = null;
  clock: ClockStatus | null = null;
  clockAt = 0;
  state: LiveState | null = null;
  frame: TrackingFrame | null = null;
  prevFrame: TrackingFrame | null = null;
  events: MatchEvent[] = [];
  moments: Moment[] = [];
  explanations = new Map<string, Explanation>();
  trace: TraceSpan[] = [];
  recaps = new Map<string, Recap>();
  viewers = new Map<string, ViewerData>();
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error' = 'idle';
  error: string | null = null;
  version = 0;
  sessionId: string | null = null;
  private client: PubSubClient | null = null;
  private listeners = new Set<Listener>();
  private raf = 0;
  /** Fired for new feed items (TTS + screen-reader announcements). */
  onFeed: ((key: string, item: FeedItem) => void) | null = null;

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private changed() {
    this.version++;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      for (const l of this.listeners) l();
    });
  }

  /** Interpolated stream time. */
  now(): number {
    if (!this.clock) return 0;
    if (!this.clock.playing) return this.clock.ts;
    return Math.min(
      this.clock.duration_ts,
      this.clock.ts + ((performance.now() - this.clockAt) / 1000) * this.clock.speed,
    );
  }

  async connect(sessionId: string, meta: MatchMeta, clock: ClockStatus) {
    this.client?.close();
    this.reset();
    this.sessionId = sessionId;
    this.meta = meta;
    this.setClock(clock);
    this.client = new PubSubClient(sessionId, (g, msgs) => this.onGroup(g, msgs));
    this.client.onStatus = (s) => {
      this.status = s;
      this.changed();
    };
    try {
      await this.client.join(sharedGroup(sessionId));
    } catch (e) {
      this.status = 'error';
      this.error = (e as Error).message;
    }
    this.changed();
  }

  private reset() {
    this.state = null;
    this.frame = this.prevFrame = null;
    this.events = [];
    this.moments = [];
    this.explanations.clear();
    this.trace = [];
    this.recaps.clear();
    for (const v of this.viewers.values()) {
      v.feed = [];
      v.overlays.clear();
      v.answers = [];
    }
  }

  private setClock(c: ClockStatus) {
    this.clock = c;
    this.clockAt = performance.now();
  }

  /** Register a viewer profile with the server and join its personalised group. */
  async addViewer(profile: ViewerProfile): Promise<string> {
    if (!this.sessionId) throw new Error('no session');
    const p = normaliseProfile(profile);
    const key = profileKey(p);
    const existing = this.viewers.get(key);
    if (existing) {
      existing.refs++;
      return key;
    }
    const v: ViewerData = { key, profile: p, feed: [], overlays: new Map(), answers: [], refs: 1 };
    this.viewers.set(key, v);
    // Register with the server (retry once), merging with anything pushed while the request was in flight.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await api.addProfile(this.sessionId, p);
        const pushed = new Set(v.feed.map((f) => f.id));
        v.feed = [...r.feed.filter((f) => !pushed.has(f.id)), ...v.feed].sort((a, b) => a.ts - b.ts);
        for (const o of r.overlays) if (!v.overlays.has(o.id)) v.overlays.set(o.id, o);
        await this.client?.join(r.group);
        this.changed();
        return key;
      } catch (e) {
        if (attempt >= 1) {
          if (this.viewers.get(key) === v) this.viewers.delete(key);
          this.error = `Could not register viewer ${key}: ${(e as Error).message}`;
          this.changed();
          throw e;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  removeViewer(key: string) {
    const v = this.viewers.get(key);
    if (!v || !this.sessionId) return;
    if (--v.refs > 0) return;
    this.viewers.delete(key);
    this.client?.leave(`${sharedGroup(this.sessionId)}.${key}`);
    void api.removeProfile(this.sessionId, key);
    this.changed();
  }

  private onGroup(_group: string, msgs: GroupMessage[]) {
    for (const m of msgs) this.apply(m);
    this.changed();
  }

  private apply(m: GroupMessage) {
    switch (m.kind) {
      case 'meta':
        this.meta = m.meta;
        this.setClock(m.clock);
        break;
      case 'reset':
        this.reset();
        break;
      case 'clock':
        this.setClock(m.clock);
        break;
      case 'events':
        this.events.push(...m.events);
        if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
        break;
      case 'tracking':
        this.prevFrame = this.frame;
        this.frame = m.frame;
        break;
      case 'state':
        this.state = m.state;
        break;
      case 'moment':
        this.moments.push(m.moment);
        break;
      case 'explanation':
        this.explanations.set(m.explanation.moment_id, m.explanation);
        break;
      case 'trace':
        this.trace.push(...m.spans);
        if (this.trace.length > 400) this.trace.splice(0, this.trace.length - 400);
        break;
      case 'recap':
        this.recaps.set(m.recap.lang, m.recap);
        break;
      case 'overlay': {
        const v = this.viewers.get(m.profile_key);
        if (v) v.overlays.set(m.overlay.id, m.overlay);
        break;
      }
      case 'overlay_clear': {
        const v = this.viewers.get(m.profile_key);
        v?.overlays.delete(m.overlay_id);
        break;
      }
      case 'feed': {
        const v = this.viewers.get(m.profile_key);
        if (!v) break;
        if (m.item.supersedes) {
          const i = v.feed.findIndex((f) => f.id === m.item.supersedes);
          if (i >= 0) v.feed[i] = m.item;
          else v.feed.push(m.item);
        } else v.feed.push(m.item);
        if (v.feed.length > 250) v.feed.splice(0, v.feed.length - 250);
        this.onFeed?.(m.profile_key, m.item);
        break;
      }
      case 'answer': {
        const v = this.viewers.get(m.profile_key);
        if (v && !v.answers.some((a) => a.id === m.answer.id)) v.answers.push(m.answer);
        break;
      }
    }
  }

  async control(action: string, value?: number) {
    if (!this.sessionId) return;
    const r = await api.control(this.sessionId, action, value);
    this.setClock(r.clock);
    this.changed();
  }

  async ask(question: string, profile: ViewerProfile) {
    if (!this.sessionId) return;
    const a = await api.ask(this.sessionId, question, profile);
    const v = this.viewers.get(profileKey(normaliseProfile(profile)));
    if (v && !v.answers.some((x) => x.id === a.id)) v.answers.push(a);
    this.changed();
    return a;
  }

  close() {
    this.client?.close();
  }
}

export const store = new SessionStore();

/** Re-render when the store changes (rAF-throttled). */
export function useStore(): SessionStore {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = store.subscribe(force);
    return () => {
      off();
    };
  }, []);
  return store;
}

/** Re-render every animation frame (for the clock / pitch). */
export function useFrame(cb?: () => void) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    let id = 0;
    const loop = () => {
      ref.current?.();
      force();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}
