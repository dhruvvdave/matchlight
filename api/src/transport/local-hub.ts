import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Hub } from './hub.js';

/**
 * Local Web PubSub emulator (WebSocket). Implements the subset of the json.webpubsub.azure.v1
 * subprotocol Matchlight uses, so `npm run dev` needs no Azure resources.
 */
export class LocalHub implements Hub {
  readonly kind = 'local-ws' as const;
  private wss: WebSocketServer;
  private groups = new Map<string, Set<WebSocket>>();
  private tokens = new Map<string, { groups: Set<string>; exp: number }>();

  constructor(
    server: Server,
    private readonly path = '/client/hubs/matchlight',
    private readonly publicUrl?: string,
  ) {
    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) =>
        protocols.has('json.webpubsub.azure.v1') ? 'json.webpubsub.azure.v1' : false,
    });
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== this.path) return;
      const token = url.searchParams.get('access_token') ?? '';
      const grant = this.tokens.get(token);
      if (!grant || grant.exp < Date.now()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, grant.groups));
    });
  }

  private onConnection(ws: WebSocket, allowed: Set<string>) {
    const connectionId = randomUUID();
    ws.send(JSON.stringify({ type: 'system', event: 'connected', connectionId, userId: 'viewer' }));
    const joined = new Set<string>();
    ws.on('message', (raw) => {
      let msg: { type?: string; group?: string; ackId?: number };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const ack = (success: boolean, name?: string) =>
        msg.ackId !== undefined &&
        ws.send(
          JSON.stringify({ type: 'ack', ackId: msg.ackId, success, ...(name ? { error: { name } } : {}) }),
        );
      if (msg.type === 'joinGroup' && msg.group) {
        const permitted = [...allowed].some((g) => msg.group === g || msg.group!.startsWith(`${g}.`));
        if (!permitted) return ack(false, 'Forbidden');
        if (!this.groups.has(msg.group)) this.groups.set(msg.group, new Set());
        this.groups.get(msg.group)!.add(ws);
        joined.add(msg.group);
        ack(true);
      } else if (msg.type === 'leaveGroup' && msg.group) {
        this.groups.get(msg.group)?.delete(ws);
        joined.delete(msg.group);
        ack(true);
      }
    });
    ws.on('close', () => {
      for (const g of joined) this.groups.get(g)?.delete(ws);
    });
  }

  async sendToGroup(group: string, data: unknown): Promise<void> {
    const members = this.groups.get(group);
    if (!members?.size) return;
    const payload = JSON.stringify({ type: 'message', from: 'group', group, dataType: 'json', data });
    for (const ws of members) if (ws.readyState === ws.OPEN) ws.send(payload);
  }

  async negotiate(opts: { userId: string; groups: string[]; requestHost?: string; secure?: boolean }) {
    const token = randomUUID();
    this.tokens.set(token, { groups: new Set(opts.groups), exp: Date.now() + 60 * 60 * 1000 });
    const base = this.publicUrl ?? `${opts.secure ? 'wss' : 'ws'}://${opts.requestHost ?? 'localhost:8787'}`;
    return { url: `${base}${this.path}?access_token=${token}` };
  }

  async close() {
    for (const ws of this.wss.clients) ws.close();
    this.wss.close();
  }
}
