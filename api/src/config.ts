/** Runtime configuration from environment variables (see .env.example). No secrets are ever logged. */
export interface ApiConfig {
  port: number;
  corsOrigin: string;
  maxSessions: number;
  webDist: string | null;
  webPubSub: { connectionString?: string; endpoint?: string; hub: string } | null;
  cosmos: { endpoint: string; key?: string; database: string } | null;
  speech: { key: string; region: string } | null;
  publicWsUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.PORT ?? 8787),
    corsOrigin: env.CORS_ORIGIN ?? '*',
    maxSessions: Number(env.MAX_SESSIONS ?? 25),
    webDist: env.WEB_DIST ?? null,
    webPubSub:
      env.WEBPUBSUB_CONNECTION_STRING || env.WEBPUBSUB_ENDPOINT
        ? {
            connectionString: env.WEBPUBSUB_CONNECTION_STRING,
            endpoint: env.WEBPUBSUB_ENDPOINT,
            hub: env.WEBPUBSUB_HUB ?? 'matchlight',
          }
        : null,
    cosmos: env.COSMOS_ENDPOINT
      ? {
          endpoint: env.COSMOS_ENDPOINT,
          key: env.COSMOS_KEY || undefined,
          database: env.COSMOS_DATABASE ?? 'matchlight',
        }
      : null,
    speech:
      env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION
        ? { key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION }
        : null,
    publicWsUrl: env.PUBLIC_WS_URL,
  };
}
