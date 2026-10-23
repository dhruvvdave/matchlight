/**
 * Simulated match clock. Stream time advances at `speed` x wall time while playing.
 * Driven externally via `tick(wallDeltaMs)` so it is fully deterministic in tests.
 */
export class MatchClock {
  ts = 0;
  speed: number;
  playing = false;

  constructor(
    readonly durationTs: number,
    speed = 1,
  ) {
    this.speed = speed;
  }

  get finished(): boolean {
    return this.ts >= this.durationTs;
  }

  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  setSpeed(speed: number) {
    this.speed = Math.max(0.25, Math.min(240, speed));
  }
  seek(ts: number) {
    this.ts = Math.max(0, Math.min(this.durationTs, ts));
  }

  /** Advance by a wall-clock delta. Returns the new stream time. */
  tick(wallDeltaMs: number): number {
    if (this.playing && !this.finished)
      this.ts = Math.min(this.durationTs, this.ts + (wallDeltaMs / 1000) * this.speed);
    return this.ts;
  }
}
