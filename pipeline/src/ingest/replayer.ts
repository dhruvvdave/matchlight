import type { MatchEvent, MatchMeta, StreamRecord, TrackingFrame } from '@matchlight/schema';
import { MatchClock } from './clock.js';

export interface ReplayBatch {
  events: MatchEvent[];
  frames: TrackingFrame[];
  /** True when this batch was produced by a seek (fast-forward), not live playback. */
  catchUp: boolean;
}

/**
 * Stage 1 (INGEST): replays a time-ordered stream "as it happens" against a MatchClock.
 * Each `pump()` returns all records whose timestamp has been reached since the last pump.
 */
export class Replayer {
  private cursor = 0;
  readonly clock: MatchClock;
  readonly records: (StreamRecord & { kind: 'event' | 'tracking' })[];

  constructor(
    readonly meta: MatchMeta,
    records: StreamRecord[],
    speed = 1,
  ) {
    this.records = records.filter(
      (r): r is StreamRecord & { kind: 'event' | 'tracking' } => r.kind !== 'meta',
    );
    const last = this.records[this.records.length - 1];
    const end = last ? (last.kind === 'event' ? last.event.ts : last.frame.ts) : 0;
    this.clock = new MatchClock(end, speed);
  }

  private recTs(i: number): number {
    const r = this.records[i];
    return r.kind === 'event' ? r.event.ts : r.frame.ts;
  }

  get done(): boolean {
    return this.cursor >= this.records.length;
  }

  /** Emit everything due at the current clock time. */
  pump(catchUp = false): ReplayBatch {
    const out: ReplayBatch = { events: [], frames: [], catchUp };
    while (this.cursor < this.records.length && this.recTs(this.cursor) <= this.clock.ts) {
      const r = this.records[this.cursor++];
      if (r.kind === 'event') out.events.push(r.event);
      else out.frames.push(r.frame);
    }
    return out;
  }

  tick(wallDeltaMs: number): ReplayBatch {
    this.clock.tick(wallDeltaMs);
    return this.pump(false);
  }

  /** Seek forward (fast-forward, returning the skipped records) or backward (requires a consumer reset). */
  seek(ts: number): { batch: ReplayBatch; rewound: boolean } {
    const rewound = ts < this.clock.ts;
    if (rewound) this.cursor = 0;
    this.clock.seek(ts);
    return { batch: this.pump(true), rewound };
  }
}
