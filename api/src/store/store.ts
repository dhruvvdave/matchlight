import type { Explanation, MatchEvent, MatchMeta, Recap } from '@matchlight/schema';

/** Persistence for match state (Cosmos DB in Azure, in-memory locally). */
export interface Store {
  readonly kind: 'memory' | 'cosmos';
  init(): Promise<void>;
  saveMatch(meta: MatchMeta, sessionId: string): Promise<void>;
  appendEvents(matchId: string, events: MatchEvent[]): Promise<void>;
  saveExplanation(matchId: string, x: Explanation): Promise<void>;
  saveRecap(recap: Recap): Promise<void>;
  getRecap(matchId: string, lang: string): Promise<Recap | null>;
}

export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  readonly matches = new Map<string, MatchMeta>();
  readonly events = new Map<string, MatchEvent[]>();
  readonly explanations = new Map<string, Explanation[]>();
  readonly recaps = new Map<string, Recap>();
  async init() {}
  async saveMatch(meta: MatchMeta) {
    this.matches.set(meta.match_id, meta);
  }
  async appendEvents(matchId: string, events: MatchEvent[]) {
    const list = this.events.get(matchId) ?? [];
    list.push(...events);
    this.events.set(matchId, list);
  }
  async saveExplanation(matchId: string, x: Explanation) {
    const list = this.explanations.get(matchId) ?? [];
    list.push(x);
    this.explanations.set(matchId, list.slice(-500));
  }
  async saveRecap(r: Recap) {
    this.recaps.set(`${r.match_id}:${r.lang}`, r);
  }
  async getRecap(matchId: string, lang: string) {
    return this.recaps.get(`${matchId}:${lang}`) ?? null;
  }
}
