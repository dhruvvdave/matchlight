/**
 * Real-time push abstraction. Both implementations speak the Azure Web PubSub
 * `json.webpubsub.azure.v1` client protocol, so the browser code is identical locally and in Azure:
 *   client -> {type:'joinGroup', group, ackId}      server -> {type:'ack', ackId, success}
 *   server -> {type:'message', from:'group', group, dataType:'json', data}
 */
export interface Hub {
  readonly kind: 'local-ws' | 'azure-web-pubsub';
  sendToGroup(group: string, data: unknown): Promise<void>;
  /** URL (with token) a browser uses to connect. `groups` are pre-authorised for joining. */
  negotiate(opts: {
    userId: string;
    groups: string[];
    requestHost?: string;
    secure?: boolean;
  }): Promise<{ url: string }>;
  close(): Promise<void>;
}
