import { describe, expect, it } from 'vitest';
import { OverlayBuilder, OverlayScheduler, deriveEvents, evaluatePasses } from '@matchlight/pipeline';
import { sim } from './helpers.js';

const meta = sim('late-comeback', undefined, false).meta;
const b = new OverlayBuilder({ meta, profileKey: 'analyst.en', language: 'en', highContrast: false });
const card = (key: string, priority: number, region: 'right_rail' | 'center' = 'right_rail') =>
  b.keyMomentCard(
    { start_ts: 0, duration: 10, priority, debounce_key: key, source_event_ids: [], aria_label: key },
    { title: key, body: key, evidence: [], icon: 'info' },
    region,
  );

describe('overlay scheduler (priority + debounce)', () => {
  it('updates in place for the same debounce key instead of stacking', () => {
    const s = new OverlayScheduler();
    const a = s.offer(card('goal', 80), 0);
    const u = s.offer(card('goal', 80), 2);
    expect(a[0].type).toBe('show');
    expect(u[0].type).toBe('update');
    expect(u[0].type === 'update' && u[0].overlay.id).toBe(a[0].type === 'show' && a[0].overlay.id);
    expect(s.visible()).toHaveLength(1);
  });

  it('preempts lower priority only after the minimum display time (unless urgent)', () => {
    const s = new OverlayScheduler();
    s.offer(card('low', 40), 0);
    expect(s.offer(card('mid', 70), 1)).toEqual([]); // queued: too soon
    const later = s.tick(4);
    expect(later.map((a) => a.type)).toEqual(['clear', 'show']);
    const urgent = s.offer(card('goal', 95), 4.5);
    expect(urgent.map((a) => a.type)).toEqual(['clear', 'show']);
  });

  it('drops stale queued overlays and keeps the screen under the global cap', () => {
    const s = new OverlayScheduler();
    s.offer(card('a', 60), 0);
    s.offer(card('b', 50, 'center'), 0);
    s.offer(card('c', 55), 0.5); // same region as a, gap too small -> queued
    s.tick(9);
    expect(s.stats.dropped).toBe(1);
    for (let i = 0; i < 6; i++)
      s.offer(
        b.lowerThird(
          {
            start_ts: 0,
            duration: 5,
            priority: 30,
            debounce_key: `lt${i}`,
            source_event_ids: [],
            aria_label: '',
          },
          { title: 't' },
        ),
        10,
      );
    expect(s.visible().length).toBeLessThanOrEqual(3);
  });

  it('cools down a recently shown key to avoid repetition', () => {
    const s = new OverlayScheduler();
    s.offer(card('speed', 50), 0);
    s.tick(11);
    expect(s.offer(card('speed', 50), 15)).toEqual([]);
    expect(s.offer(card('speed', 50), 40)[0].type).toBe('show');
  });

  it('mirrors regions for RTL languages', () => {
    const ar = new OverlayBuilder({ meta, profileKey: 'casual.ar', language: 'ar', highContrast: false });
    const o = ar.keyMomentCard(
      { start_ts: 0, duration: 5, priority: 50, debounce_key: 'k', source_event_ids: [], aria_label: '' },
      { title: 't', body: 'b', evidence: [], icon: 'info' },
    );
    expect(o.dir).toBe('rtl');
    expect(o.position.x).toBe(0);
  });
});

describe('auto-eventing stub (tracking -> events)', () => {
  it('derives passes from coordinates alone with useful precision/recall at 1 Hz', () => {
    const r = sim('late-comeback');
    const derived = deriveEvents(r.frames);
    const ev = evaluatePasses(derived, r.events);
    expect(ev.precision).toBeGreaterThan(0.4);
    expect(ev.recall).toBeGreaterThan(0.3);
    expect(derived.some((d) => d.kind === 'sprint' && (d.peak_kmh ?? 0) > 25)).toBe(true);
  });
});
