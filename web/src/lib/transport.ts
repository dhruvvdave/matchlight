import type { GroupMessage } from '@matchlight/schema';
import { api } from './api';

type Handler = (group: string, msgs: GroupMessage[]) => void;

/**
 * Browser client for the Azure Web PubSub `json.webpubsub.azure.v1` subprotocol (also spoken by the
 * local emulator). Joins groups, re-negotiates a token when it needs a group it isn't authorised for,
 * and reconnects with backoff.
 */
export class PubSubClient {
  private ws: WebSocket | null = null;
  private groups = new Set<string>();
  private authorised = new Set<string>();
  private ackId = 1;
  private closed = false;
  private retry = 0;
  private connecting: Promise<void> | null = null;
  onStatus: (s: 'connecting' | 'open' | 'closed') => void = () => {};

  constructor(
    private readonly sessionId: string,
    private readonly onMessage: Handler,
  ) {}

  async join(group: string) {
    this.groups.add(group);
    if (!this.authorised.has(group) || !this.ws || this.ws.readyState > 1) await this.reconnect();
    else this.send({ type: 'joinGroup', group, ackId: this.ackId++ });
  }

  leave(group: string) {
    this.groups.delete(group);
    this.send({ type: 'leaveGroup', group, ackId: this.ackId++ });
  }

  private send(o: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  private reconnect(): Promise<void> {
    if (this.connecting)
      return this.connecting.then(() =>
        this.groups.size && [...this.groups].every((g) => this.authorised.has(g))
          ? undefined
          : this.reconnect(),
      );
    this.connecting = (async () => {
      this.onStatus('connecting');
      const want = [...this.groups];
      const { url } = await api.negotiate(this.sessionId, want);
      this.authorised = new Set(want);
      const old = this.ws;
      if (old) {
        old.onclose = null;
        old.close();
      }
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(
          url.startsWith('/')
            ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${url}`
            : url,
          'json.webpubsub.azure.v1',
        );
        this.ws = ws;
        ws.onopen = () => {
          this.retry = 0;
          for (const g of this.groups) this.send({ type: 'joinGroup', group: g, ackId: this.ackId++ });
          this.onStatus('open');
          resolve();
        };
        ws.onerror = () => reject(new Error('socket error'));
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data as string);
          if (m.type === 'message' && m.from === 'group')
            this.onMessage(m.group, Array.isArray(m.data) ? m.data : [m.data]);
        };
        ws.onclose = () => {
          this.onStatus('closed');
          if (!this.closed)
            setTimeout(() => void this.reconnect().catch(() => {}), Math.min(8000, 500 * 2 ** this.retry++));
        };
      });
    })().finally(() => (this.connecting = null));
    return this.connecting;
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
