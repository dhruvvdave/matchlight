import type { Explanation, MatchEvent, MatchMeta, Recap } from '@matchlight/schema';
import type { Store } from './store.js';

type Container = {
  items: { upsert(doc: object): Promise<unknown> };
  item(id: string, pk: string): { read<T>(): Promise<{ resource?: T }> };
};

/**
 * Azure Cosmos DB (NoSQL, serverless) store. One container `matchdata` partitioned by /match_id:
 * a match doc, event chunks (200 events per document to keep RU cost low), explanations and recaps.
 * Auth: Entra ID (managed identity) by default; key only if COSMOS_KEY is set.
 */
export class CosmosStore implements Store {
  readonly kind = 'cosmos' as const;
  private container!: Container;
  private buffers = new Map<string, { chunk: number; events: MatchEvent[] }>();

  constructor(private readonly cfg: { endpoint: string; key?: string; database: string }) {}

  async init() {
    const { CosmosClient } = await import('@azure/cosmos');
    const client = this.cfg.key
      ? new CosmosClient({ endpoint: this.cfg.endpoint, key: this.cfg.key })
      : new CosmosClient({
          endpoint: this.cfg.endpoint,
          aadCredentials: new (await import('@azure/identity')).DefaultAzureCredential(),
        });
    const { database } = await client.databases.createIfNotExists({ id: this.cfg.database });
    const { container } = await database.containers.createIfNotExists({
      id: 'matchdata',
      partitionKey: { paths: ['/match_id'] },
    });
    this.container = container as unknown as Container;
  }

  async saveMatch(meta: MatchMeta, sessionId: string) {
    await this.container.items.upsert({
      id: `match:${meta.match_id}`,
      type: 'match',
      match_id: meta.match_id,
      session_id: sessionId,
      meta,
      created: new Date().toISOString(),
    });
  }

  async appendEvents(matchId: string, events: MatchEvent[]) {
    const buf = this.buffers.get(matchId) ?? { chunk: 0, events: [] };
    buf.events.push(...events);
    this.buffers.set(matchId, buf);
    while (buf.events.length >= 200 || (events.some((e) => e.type === 'match_end') && buf.events.length)) {
      const slice = buf.events.splice(0, 200);
      await this.container.items.upsert({
        id: `events:${matchId}:${String(buf.chunk).padStart(3, '0')}`,
        type: 'events',
        match_id: matchId,
        chunk: buf.chunk,
        events: slice,
      });
      buf.chunk++;
    }
  }

  async saveExplanation(matchId: string, x: Explanation) {
    await this.container.items.upsert({
      id: `explanation:${x.id}`,
      type: 'explanation',
      match_id: matchId,
      explanation: x,
    });
  }

  async saveRecap(r: Recap) {
    await this.container.items.upsert({
      id: `recap:${r.lang}`,
      type: 'recap',
      match_id: r.match_id,
      recap: r,
    });
  }

  async getRecap(matchId: string, lang: string) {
    const { resource } = await this.container.item(`recap:${lang}`, matchId).read<{ recap: Recap }>();
    return resource?.recap ?? null;
  }
}
