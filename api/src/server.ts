import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Language, ScenarioId, ViewerProfile, sharedGroup } from '@matchlight/schema';
import { agentConfigFromEnv } from '@matchlight/agents';
import { demoStartMinute, listScenarios } from '@matchlight/simulator';
import { loadConfig } from './config.js';
import { MatchSession } from './session.js';
import { CosmosStore } from './store/cosmos-store.js';
import { MemoryStore, type Store } from './store/store.js';
import { AzureWebPubSubHub } from './transport/azure-hub.js';
import type { Hub } from './transport/hub.js';
import { LocalHub } from './transport/local-hub.js';
import { synthesize } from './tts.js';

const log = (msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

export interface AppHandle {
  port: number;
  close(): Promise<void>;
  sessions: Map<string, MatchSession>;
}

export async function startServer(
  overrides: Partial<ReturnType<typeof loadConfig>> = {},
): Promise<AppHandle> {
  const cfg = { ...loadConfig(), ...overrides };
  const agents = agentConfigFromEnv();
  const store: Store = cfg.cosmos ? new CosmosStore(cfg.cosmos) : new MemoryStore();
  await store.init().catch((e) => {
    log('store init failed, falling back to memory', { error: String(e) });
  });
  const sessions = new Map<string, MatchSession>();
  const here = fileURLToPath(new URL('.', import.meta.url));
  const webDist =
    cfg.webDist ??
    [resolve(here, '../../web/dist'), resolve(here, '../web/dist')].find((p) => existsSync(p)) ??
    null;

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      log('request failed', { url: req.url, error: String(e) });
      if (!res.headersSent) send(res, 500, { error: 'internal_error' });
    });
  });
  const hub: Hub = cfg.webPubSub
    ? new AzureWebPubSubHub(cfg.webPubSub)
    : new LocalHub(server, '/client/hubs/matchlight', cfg.publicWsUrl);

  // Idle-session reaper.
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastActivity > 30 * 60 * 1000) {
        s.stop();
        sessions.delete(id);
        log('session reaped', { session: id });
      }
    }
  }, 60_000);
  reaper.unref();

  function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const isBuf = Buffer.isBuffer(body);
    const isText = typeof body === 'string';
    res.writeHead(status, {
      'Content-Type': isBuf
        ? 'application/octet-stream'
        : isText
          ? 'text/plain; charset=utf-8'
          : 'application/json',
      'Access-Control-Allow-Origin': cfg.corsOrigin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(isBuf || isText ? body : JSON.stringify(body));
  }

  async function body<T>(req: IncomingMessage, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 64 * 1024) throw new HttpError(413, 'payload_too_large');
      chunks.push(c as Buffer);
    }
    const raw = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      throw new HttpError(
        400,
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    return parsed.data;
  }

  const getSession = (id: string) => {
    const s = sessions.get(id);
    if (!s) throw new HttpError(404, 'session_not_found');
    return s;
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') return send(res, 204, '');
    try {
      if (path === '/healthz') return send(res, 200, { ok: true, sessions: sessions.size });
      if (path === '/api/config' && method === 'GET') {
        return send(res, 200, {
          llm: agents.describe.llm,
          translator: agents.describe.translator,
          tts: cfg.speech ? 'Azure AI Speech' : 'browser speechSynthesis (offline)',
          transport: hub.kind === 'local-ws' ? 'local Web PubSub emulator (WebSocket)' : 'Azure Web PubSub',
          store: store.kind === 'cosmos' ? 'Azure Cosmos DB' : 'in-memory',
          synthetic: true,
        });
      }
      if (path === '/api/scenarios' && method === 'GET') {
        return send(
          res,
          200,
          listScenarios().map((s) => ({ ...s, demo_start_minute: demoStartMinute(s.id) })),
        );
      }
      if (path === '/api/sessions' && method === 'POST') {
        const b = await body(
          req,
          z.object({
            scenario: ScenarioId,
            seed: z
              .number()
              .int()
              .min(1)
              .max(2 ** 31)
              .optional(),
            speed: z.number().min(0.25).max(240).default(10),
            autoplay: z.boolean().default(true),
            start_minute: z.number().min(0).max(95).optional(),
          }),
        );
        if (sessions.size >= cfg.maxSessions) {
          const oldest = [...sessions.values()].sort((a, c) => a.lastActivity - c.lastActivity)[0];
          oldest.stop();
          sessions.delete(oldest.id);
        }
        const id = randomUUID().slice(0, 8);
        const seed = b.scenario === 'random' ? (b.seed ?? Math.floor(Math.random() * 1e6) + 1) : b.seed;
        const s = new MatchSession({
          id,
          scenario: b.scenario,
          seed,
          speed: b.speed,
          hub,
          store,
          agents,
          log,
        });
        sessions.set(id, s);
        if (b.start_minute) s.seekMinute(b.start_minute);
        s.start();
        if (b.autoplay) s.play();
        log('session created', { session: id, scenario: b.scenario, seed: s.meta.seed });
        return send(res, 201, { session_id: id, meta: s.meta, clock: s.clock(), group: sharedGroup(id) });
      }
      if (path === '/api/negotiate' && method === 'GET') {
        const sid = url.searchParams.get('session') ?? '';
        getSession(sid);
        const groups = (url.searchParams.get('groups') ?? sharedGroup(sid))
          .split(',')
          .filter((g) => g === sharedGroup(sid) || g.startsWith(`${sharedGroup(sid)}.`));
        const host = req.headers['x-forwarded-host']?.toString() ?? req.headers.host;
        const secure = req.headers['x-forwarded-proto'] === 'https';
        return send(
          res,
          200,
          await hub.negotiate({
            userId: `viewer-${randomUUID().slice(0, 6)}`,
            groups,
            requestHost: host,
            secure,
          }),
        );
      }
      const m = path.match(/^\/api\/sessions\/([\w-]+)(?:\/(.+))?$/);
      if (m) {
        const s = getSession(m[1]);
        const sub = m[2] ?? '';
        if (sub === '' && method === 'GET') return send(res, 200, s.summary());
        if (sub === 'control' && method === 'POST') {
          const b = await body(
            req,
            z.object({
              action: z.enum(['play', 'pause', 'speed', 'seek', 'seek_minute', 'restart']),
              value: z.number().optional(),
            }),
          );
          if (b.action === 'play') s.play();
          else if (b.action === 'pause') s.pause();
          else if (b.action === 'speed') s.setSpeed(b.value ?? 10);
          else if (b.action === 'seek') s.seek(b.value ?? 0);
          else if (b.action === 'seek_minute') s.seekMinute(b.value ?? 0);
          else s.restart();
          return send(res, 200, { clock: s.clock() });
        }
        if (sub === 'profiles' && method === 'POST') {
          const b = await body(req, z.object({ profile: ViewerProfile }));
          const r = s.addProfile(b.profile);
          return send(res, 200, {
            profile_key: r.key,
            group: `${sharedGroup(s.id)}.${r.key}`,
            feed: r.feed,
            overlays: r.overlays,
          });
        }
        const pm = sub.match(/^profiles\/([\w.-]+)$/);
        if (pm && method === 'DELETE') {
          s.removeProfile(pm[1]);
          return send(res, 200, { ok: true });
        }
        if (sub === 'ask' && method === 'POST') {
          const b = await body(
            req,
            z.object({ question: z.string().min(1).max(300), profile: ViewerProfile }),
          );
          return send(res, 200, await s.ask(b.question, b.profile));
        }
        if (sub === 'recap' && method === 'GET') {
          const lang = Language.parse(url.searchParams.get('lang') ?? 'en');
          const r = await s.recap(lang);
          if (url.searchParams.get('format') === 'md') {
            return send(res, 200, s.orchestrator.recapAgent.toMarkdown(r), {
              'Content-Type': 'text/markdown; charset=utf-8',
              'Content-Disposition': `attachment; filename="${s.meta.match_id}-recap-${lang}.md"`,
            });
          }
          return send(res, 200, r);
        }
        if (sub === 'recap.mp3' && method === 'GET') {
          if (!cfg.speech)
            return send(res, 503, {
              error: 'speech_not_configured',
              hint: 'Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION',
            });
          const lang = Language.parse(url.searchParams.get('lang') ?? 'en');
          const r = await s.recap(lang);
          const audio = await synthesize(cfg.speech, r.script_60s, lang, 'recap');
          return send(res, 200, audio, {
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': `attachment; filename="${s.meta.match_id}-recap-${lang}.mp3"`,
          });
        }
        if (sub === 'events.jsonl' && method === 'GET') {
          return send(res, 200, s.jsonl(url.searchParams.get('all') === '1'), {
            'Content-Type': 'application/x-ndjson',
            'Content-Disposition': `attachment; filename="${s.meta.match_id}.jsonl"`,
          });
        }
        if (sub === 'trace' && method === 'GET')
          return send(res, 200, s.orchestrator.tracer.spans.slice(-300));
      }
      if (path === '/api/tts' && method === 'POST') {
        if (!cfg.speech) return send(res, 503, { error: 'speech_not_configured' });
        const b = await body(req, z.object({ text: z.string().min(1).max(600), lang: Language }));
        return send(res, 200, await synthesize(cfg.speech, b.text, b.lang), { 'Content-Type': 'audio/mpeg' });
      }
      if (path.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
      if (webDist && method === 'GET') return serveStatic(webDist, path, res);
      return send(res, 404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (e instanceof SyntaxError) return send(res, 400, { error: 'invalid_json' });
      throw e;
    }
  }

  function serveStatic(root: string, path: string, res: ServerResponse) {
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, safe);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory())
      file = join(root, 'index.html');
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    };
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(readFileSync(file));
  }

  await new Promise<void>((r) => server.listen(cfg.port, r));
  const port = (server.address() as { port: number }).port;
  log('matchlight api listening', {
    port,
    llm: agents.describe.llm,
    translator: agents.describe.translator,
    transport: hub.kind,
    store: store.kind,
    web: webDist ?? 'not served',
  });
  return {
    port,
    sessions,
    async close() {
      clearInterval(reaper);
      for (const s of sessions.values()) s.stop();
      await hub.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.mjs'))) {
  startServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
