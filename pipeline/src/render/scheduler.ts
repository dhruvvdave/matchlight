import type { Overlay, OverlayRegion } from '@matchlight/schema';
import { REGION_CAPACITY } from './regions.js';

export type SchedulerAction =
  | { type: 'show'; overlay: Overlay }
  | { type: 'update'; overlay: Overlay }
  | { type: 'clear'; id: string; reason: 'expired' | 'preempted' };

export interface SchedulerConfig {
  /** Max simultaneous overlays excluding persistent ones (momentum bar, pinned metric badge). */
  maxVisible: number;
  /** Seconds an overlay must be on screen before a higher priority can replace it (unless >= urgent). */
  minDisplay: number;
  /** Priority gap needed to preempt. */
  preemptGap: number;
  /** Priority at or above which minDisplay is ignored. */
  urgent: number;
  /** Seconds a queued overlay may wait before being dropped as stale. */
  maxQueueWait: number;
  /** Seconds after an overlay ends before the same debounce key may show again (unless priority >= urgent). */
  cooldown: number;
}

export const DEFAULT_SCHEDULER: SchedulerConfig = {
  maxVisible: 3,
  minDisplay: 3,
  preemptGap: 15,
  urgent: 90,
  maxQueueWait: 8,
  cooldown: 20,
};

interface Active {
  overlay: Overlay;
  shownAt: number;
  endsAt: number;
}

const PERSISTENT = (o: Overlay) => o.debounce_key.startsWith('persist:');

/**
 * Priority + debounce scheduler that keeps the screen uncluttered:
 *  - same debounce_key while visible => update in place (no stacking)
 *  - per-region capacity + global cap
 *  - higher priority preempts (after a minimum display time) by a configurable gap
 *  - lower priority waits in a short queue, then is dropped as stale
 *  - recently-shown keys cool down to avoid repetition
 * Deterministic: output depends only on the sequence of offers and ticks.
 */
export class OverlayScheduler {
  private active = new Map<string, Active>();
  private queue: { overlay: Overlay; offeredAt: number }[] = [];
  private lastEnded = new Map<string, number>();
  readonly stats = { shown: 0, updated: 0, preempted: 0, dropped: 0, expired: 0 };

  constructor(private readonly cfg: SchedulerConfig = DEFAULT_SCHEDULER) {}

  visible(): Overlay[] {
    return [...this.active.values()].map((a) => a.overlay);
  }

  offer(overlay: Overlay, now: number): SchedulerAction[] {
    const out: SchedulerAction[] = [];
    const same = [...this.active.values()].find((a) => a.overlay.debounce_key === overlay.debounce_key);
    if (same) {
      // Update in place, keep the original id so the graphics engine animates content not a new card.
      const updated = { ...overlay, id: same.overlay.id, start_ts: same.overlay.start_ts } as Overlay;
      same.overlay = updated;
      same.endsAt = Math.max(same.endsAt, now + overlay.duration);
      updated.duration = Math.round((same.endsAt - updated.start_ts) * 10) / 10;
      this.stats.updated++;
      out.push({ type: 'update', overlay: updated });
      return out;
    }
    const ended = this.lastEnded.get(overlay.debounce_key);
    if (
      ended !== undefined &&
      now - ended < this.cfg.cooldown &&
      overlay.priority < this.cfg.urgent &&
      !PERSISTENT(overlay)
    ) {
      this.stats.dropped++;
      return out;
    }
    if (this.tryShow(overlay, now, out)) return out;
    // Replace any queued overlay with the same key, keep queue sorted by priority.
    this.queue = this.queue.filter((q) => q.overlay.debounce_key !== overlay.debounce_key);
    this.queue.push({ overlay, offeredAt: now });
    this.queue.sort((a, b) => b.overlay.priority - a.overlay.priority || a.offeredAt - b.offeredAt);
    return out;
  }

  private regionLoad(region: OverlayRegion): Active[] {
    return [...this.active.values()].filter((a) => a.overlay.region === region);
  }

  private tryShow(overlay: Overlay, now: number, out: SchedulerAction[]): boolean {
    const inRegion = this.regionLoad(overlay.region);
    const nonPersistent = [...this.active.values()].filter((a) => !PERSISTENT(a.overlay));
    const regionFull = inRegion.length >= REGION_CAPACITY[overlay.region];
    const globalFull = !PERSISTENT(overlay) && nonPersistent.length >= this.cfg.maxVisible;
    if (!regionFull && !globalFull) {
      this.show(overlay, now, out);
      return true;
    }
    // Candidate victims: in the same region if that is the constraint, otherwise the weakest visible overlay.
    const pool = (regionFull ? inRegion : nonPersistent).filter((a) => !PERSISTENT(a.overlay));
    const victim = pool.sort((a, b) => a.overlay.priority - b.overlay.priority || a.shownAt - b.shownAt)[0];
    if (!victim) return false;
    const gapOk = overlay.priority >= victim.overlay.priority + this.cfg.preemptGap;
    const timeOk = now - victim.shownAt >= this.cfg.minDisplay || overlay.priority >= this.cfg.urgent;
    if (gapOk && timeOk) {
      this.remove(victim.overlay.id, now, 'preempted', out);
      this.stats.preempted++;
      return this.tryShow(overlay, now, out);
    }
    return false;
  }

  private show(overlay: Overlay, now: number, out: SchedulerAction[]) {
    const shown = { ...overlay, start_ts: Math.round(now * 10) / 10 } as Overlay;
    this.active.set(shown.id, { overlay: shown, shownAt: now, endsAt: now + overlay.duration });
    this.stats.shown++;
    out.push({ type: 'show', overlay: shown });
  }

  private remove(id: string, now: number, reason: 'expired' | 'preempted', out: SchedulerAction[]) {
    const a = this.active.get(id);
    if (!a) return;
    this.active.delete(id);
    this.lastEnded.set(a.overlay.debounce_key, now);
    out.push({ type: 'clear', id, reason });
  }

  /** Advance time: expire finished overlays, drop stale queue entries, promote waiting ones. */
  tick(now: number): SchedulerAction[] {
    const out: SchedulerAction[] = [];
    for (const a of [...this.active.values()]) {
      if (now >= a.endsAt) {
        this.remove(a.overlay.id, now, 'expired', out);
        this.stats.expired++;
      }
    }
    const keep: typeof this.queue = [];
    for (const q of this.queue) {
      if (now - q.offeredAt > this.cfg.maxQueueWait) {
        this.stats.dropped++;
        continue;
      }
      const remaining = q.overlay.duration - (now - q.offeredAt);
      if (remaining < 2) {
        this.stats.dropped++;
        continue;
      }
      if (!this.tryShow({ ...q.overlay, duration: Math.round(remaining * 10) / 10 } as Overlay, now, out))
        keep.push(q);
    }
    this.queue = keep;
    return out;
  }

  reset() {
    this.active.clear();
    this.queue = [];
    this.lastEnded.clear();
  }
}
