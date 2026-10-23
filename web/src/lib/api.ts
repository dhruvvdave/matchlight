import type {
  AskAnswer,
  ClockStatus,
  FeedItem,
  MatchMeta,
  Overlay,
  Recap,
  ScenarioInfo,
  ViewerProfile,
} from '@matchlight/schema';

/** API base: same origin locally (Vite proxy / API serves the SPA); set VITE_API_BASE for Static Web Apps -> Container Apps. */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface ServerConfig {
  llm: string;
  translator: string;
  tts: string;
  transport: string;
  store: string;
}

export const api = {
  config: () => req<ServerConfig>('/api/config'),
  scenarios: () => req<(ScenarioInfo & { demo_start_minute: number })[]>('/api/scenarios'),
  createSession: (b: {
    scenario: string;
    seed?: number;
    speed?: number;
    autoplay?: boolean;
    start_minute?: number;
  }) =>
    req<{ session_id: string; meta: MatchMeta; clock: ClockStatus; group: string }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  control: (sid: string, action: string, value?: number) =>
    req<{ clock: ClockStatus }>(`/api/sessions/${sid}/control`, {
      method: 'POST',
      body: JSON.stringify({ action, value }),
    }),
  addProfile: (sid: string, profile: ViewerProfile) =>
    req<{ profile_key: string; group: string; feed: FeedItem[]; overlays: Overlay[] }>(
      `/api/sessions/${sid}/profiles`,
      { method: 'POST', body: JSON.stringify({ profile }) },
    ),
  removeProfile: (sid: string, key: string) =>
    req(`/api/sessions/${sid}/profiles/${key}`, { method: 'DELETE' }).catch(() => {}),
  negotiate: (sid: string, groups: string[]) =>
    req<{ url: string }>(`/api/negotiate?session=${sid}&groups=${encodeURIComponent(groups.join(','))}`),
  ask: (sid: string, question: string, profile: ViewerProfile) =>
    req<AskAnswer>(`/api/sessions/${sid}/ask`, {
      method: 'POST',
      body: JSON.stringify({ question, profile }),
    }),
  recap: (sid: string, lang: string) => req<Recap>(`/api/sessions/${sid}/recap?lang=${lang}`),
  summary: (sid: string) =>
    req<{
      latency: {
        fast_path: { p50: number; p95: number; count: number };
        llm_path: { p50: number; p95: number; count: number };
      };
      metrics: Record<string, number>;
      providers: { llm: string; translator: string };
    }>(`/api/sessions/${sid}`),
  url: (path: string) => `${API_BASE}${path}`,
};
