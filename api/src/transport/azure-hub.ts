import type { Hub } from './hub.js';

/** Azure Web PubSub: server publishes to groups; browsers connect with a short-lived client access URL. */
export class AzureWebPubSubHub implements Hub {
  readonly kind = 'azure-web-pubsub' as const;
  private client: Promise<{
    group(name: string): {
      sendToAll(data: unknown, opts: { contentType: 'application/json' }): Promise<void>;
    };
    getClientAccessToken(opts: {
      userId: string;
      roles: string[];
      expirationTimeInMinutes: number;
    }): Promise<{ url: string }>;
  }>;

  constructor(cfg: { connectionString?: string; endpoint?: string; hub: string }) {
    this.client = (async () => {
      const { WebPubSubServiceClient } = await import('@azure/web-pubsub');
      if (cfg.connectionString) return new WebPubSubServiceClient(cfg.connectionString, cfg.hub) as never;
      const { DefaultAzureCredential } = await import('@azure/identity');
      return new WebPubSubServiceClient(cfg.endpoint!, new DefaultAzureCredential(), cfg.hub) as never;
    })();
  }

  async sendToGroup(group: string, data: unknown) {
    const c = await this.client;
    await c.group(group).sendToAll(data, { contentType: 'application/json' });
  }

  async negotiate(opts: { userId: string; groups: string[] }) {
    const c = await this.client;
    // Least privilege: the client may only join this session's groups (and its profile sub-groups).
    const roles = opts.groups.flatMap((g) => [`webpubsub.joinLeaveGroup.${g}`]);
    const token = await c.getClientAccessToken({
      userId: opts.userId,
      roles: roles.length ? roles : ['webpubsub.joinLeaveGroup'],
      expirationTimeInMinutes: 60,
    });
    return { url: token.url };
  }

  async close() {}
}
