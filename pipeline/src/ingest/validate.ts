import { MatchEvent } from '@matchlight/schema';

export interface ValidationStats {
  accepted: number;
  rejected: number;
  lastError?: string;
}

/** Ingest boundary validation: every event is schema-checked before it reaches Interpret. */
export class EventValidator {
  readonly stats: ValidationStats = { accepted: 0, rejected: 0 };
  private lastSeq = -1;

  check(raw: unknown): MatchEvent | null {
    const res = MatchEvent.safeParse(raw);
    if (!res.success) {
      this.stats.rejected++;
      this.stats.lastError = res.error.issues[0]?.message;
      return null;
    }
    if (res.data.seq <= this.lastSeq) {
      this.stats.rejected++;
      this.stats.lastError = `out-of-order seq ${res.data.seq} <= ${this.lastSeq}`;
      return null;
    }
    this.lastSeq = res.data.seq;
    this.stats.accepted++;
    return res.data;
  }

  reset() {
    this.lastSeq = -1;
  }
}
