import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { GroupMessage } from '@matchlight/schema';
import { startServer, type AppHandle } from '../api/src/server.js';

let app: AppHandle;
let base: string;

beforeAll(async () => {
  process.env.MOCK_LLM_LATENCY_MS = '0';
  app = await startServer({ port: 0, webDist: null });
  base = `http://127.0.0.1:${app.port}`;
});
afterAll(async () => app.close());

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

describe('API + Web PubSub-compatible push (integration)', () => {
  it('serves health, config and scenarios', async () => {
    expect((await fetch(`${base}/healthz`).then((r) => r.json())).ok).toBe(true);
    const cfg = await fetch(`${base}/api/config`).then((r) => r.json());
    expect(cfg.synthetic).toBe(true);
    const sc = await fetch(`${base}/api/scenarios`).then((r) => r.json());
    expect(sc.map((s: { id: string }) => s.id)).toEqual([
      'late-comeback',
      'red-card-collapse',
      'tactical-stalemate',
      'random',
    ]);
  });

  it('validates input', async () => {
    expect((await post('/api/sessions', { scenario: 'not-a-scenario' })).status).toBe(400);
    expect((await fetch(`${base}/api/sessions/nope`)).status).toBe(404);
  });

  it('streams a live session over the negotiated socket to shared + profile groups', async () => {
    const created = await post('/api/sessions', {
      scenario: 'late-comeback',
      speed: 120,
      autoplay: true,
      start_minute: 60,
    });
    expect(created.status).toBe(201);
    const sid = created.json.session_id as string;
    const prof = await post(`/api/sessions/${sid}/profiles`, {
      profile: { mode: 'analyst', language: 'en' },
    });
    expect(prof.json.profile_key).toBe('analyst.en');
    const neg = await fetch(
      `${base}/api/negotiate?session=${sid}&groups=${created.json.group},${prof.json.group}`,
    ).then((r) => r.json());
    const ws = new WebSocket(neg.url, 'json.webpubsub.azure.v1');
    const got: GroupMessage[] = [];
    const acks: boolean[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'joinGroup', group: created.json.group, ackId: 1 }));
        ws.send(JSON.stringify({ type: 'joinGroup', group: prof.json.group, ackId: 2 }));
        ws.send(JSON.stringify({ type: 'joinGroup', group: 'match.someone-else', ackId: 3 }));
      });
      ws.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === 'ack') acks.push(m.success);
        if (m.type === 'message') got.push(...(m.data as GroupMessage[]));
        const kinds = new Set(got.map((g) => g.kind));
        if (kinds.has('events') && kinds.has('state') && kinds.has('clock') && kinds.has('overlay'))
          resolve();
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error(`timeout; got ${[...new Set(got.map((g) => g.kind))]}`)), 15000);
    });
    ws.close();
    expect(acks).toEqual([true, true, false]);
    const st = got.find((g) => g.kind === 'state');
    expect(st && st.kind === 'state' && st.state.game_s).toBeGreaterThan(59 * 60);

    // Controls, ask, JSONL export.
    expect((await post(`/api/sessions/${sid}/control`, { action: 'pause' })).json.clock.playing).toBe(false);
    const ans = await post(`/api/sessions/${sid}/ask`, {
      question: 'what is the score?',
      profile: { mode: 'analyst', language: 'en' },
    });
    expect(ans.json.intent).toBe('score');
    const jsonl = await fetch(`${base}/api/sessions/${sid}/events.jsonl`).then((r) => r.text());
    expect(jsonl.split('\n')[0]).toContain('"kind":"meta"');
    const summary = await fetch(`${base}/api/sessions/${sid}`).then((r) => r.json());
    expect(summary.latency.fast_path.p95).toBeLessThan(1500);
  });

  it('rejects socket connections without a negotiated token', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${app.port}/client/hubs/matchlight?access_token=bogus`,
      'json.webpubsub.azure.v1',
    );
    const code = await new Promise<string>((resolve) => {
      ws.on('error', (e) => resolve(String(e.message)));
      ws.on('open', () => resolve('open'));
    });
    expect(code).toMatch(/401/);
  });

  it('returns a recap (json + markdown) once the match is played', async () => {
    const created = await post('/api/sessions', {
      scenario: 'tactical-stalemate',
      speed: 240,
      autoplay: false,
      start_minute: 90,
    });
    const sid = created.json.session_id;
    await post(`/api/sessions/${sid}/control`, { action: 'play' });
    for (let i = 0; i < 100; i++) {
      const s = await fetch(`${base}/api/sessions/${sid}`).then((r) => r.json());
      if (s.clock.finished) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const recap = await fetch(`${base}/api/sessions/${sid}/recap?lang=es`).then((r) => r.json());
    expect(recap.final_score).toEqual({ home: 0, away: 0 });
    expect(recap.lang).toBe('es');
    const md = await fetch(`${base}/api/sessions/${sid}/recap?format=md`).then((r) => r.text());
    expect(md).toContain('## Player ratings');
    expect((await fetch(`${base}/api/sessions/${sid}/recap.mp3`)).status).toBe(503);
  });
});
