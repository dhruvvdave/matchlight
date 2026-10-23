import { describe, expect, it } from 'vitest';
import { EventValidator, MatchClock, Replayer, parseJsonl } from '@matchlight/pipeline';
import { toJsonl, toStream } from '@matchlight/simulator';
import { sim } from './helpers.js';

describe('ingest', () => {
  it('clock advances at the configured speed only while playing', () => {
    const c = new MatchClock(5400, 60);
    c.tick(1000);
    expect(c.ts).toBe(0);
    c.play();
    c.tick(1000);
    expect(c.ts).toBe(60);
    c.setSpeed(10);
    c.tick(500);
    expect(c.ts).toBe(65);
  });

  it('replayer emits records "as they happen" and seeks forward/back', () => {
    const r = sim('tactical-stalemate');
    const rp = new Replayer(r.meta, toStream(r), 60);
    rp.clock.play();
    const b1 = rp.tick(1000); // 60 s of match
    expect(b1.events.length).toBeGreaterThan(5);
    expect(b1.events.every((e) => e.ts <= 60)).toBe(true);
    expect(b1.frames.length).toBe(61);
    const { batch, rewound } = rp.seek(600);
    expect(rewound).toBe(false);
    expect(batch.catchUp).toBe(true);
    expect(batch.events.every((e) => e.ts > 60 && e.ts <= 600)).toBe(true);
    const back = rp.seek(30);
    expect(back.rewound).toBe(true);
    expect(back.batch.events[0].seq).toBe(0);
  });

  it('JSONL round-trips and reports invalid lines instead of trusting them', () => {
    const r = sim('tactical-stalemate');
    const text = toJsonl(r);
    const parsed = parseJsonl(text + '{"kind":"event","event":{"type":"pass"}}\nnot json\n');
    expect(parsed.meta?.match_id).toBe(r.meta.match_id);
    expect(parsed.records.length).toBe(r.events.length + r.frames.length + 1);
    expect(parsed.invalid).toHaveLength(2);
  });

  it('validator rejects malformed and out-of-order events', () => {
    const r = sim('tactical-stalemate');
    const v = new EventValidator();
    expect(v.check(r.events[0])).not.toBeNull();
    expect(v.check(r.events[1])).not.toBeNull();
    expect(v.check(r.events[0])).toBeNull();
    expect(v.check({ ...r.events[5], x: 999 })).toBeNull();
    expect(v.stats).toMatchObject({ accepted: 2, rejected: 2 });
  });
});
