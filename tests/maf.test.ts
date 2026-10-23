import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { ViewerProfile } from '@matchlight/schema';
import { MatchOrchestrator, MockLlm, TranslatorAgent } from '@matchlight/agents';
import { Replayer } from '@matchlight/pipeline';
import { toStream } from '@matchlight/simulator';
import { sim } from './helpers.js';

/**
 * Contract test for the Microsoft Agent Framework sidecar integration: a stub speaking the
 * agents-maf/ HTTP contract. (The real Python workflow is tested with pytest in agents-maf/tests.)
 */
let server: Server;
let endpoint: string;
let calls = 0;
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls++;
    const facts = body.facts as { id: string; text: string; event_ids: string[] }[];
    // Every 3rd request returns an ungrounded draft to prove the in-process Critic re-verifies.
    const bad = calls % 3 === 0;
    const draft = {
      claim: bad
        ? 'They have won 7 of their last 9 duels, a 99.9 xG swing.'
        : `${body.moment.headline}. ${facts[0]?.text ?? ''}`,
      evidence: facts.slice(0, 2).map((f) => ({ fact_id: f.id, text: f.text })),
      confidence: 0.8,
      event_ids: facts.flatMap((f) => f.event_ids).slice(0, 4),
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        draft,
        grounded: !bad,
        attempts: 2,
        issues: [],
        events: [
          { agent: 'explainer', op: 'draft', summary: 'first draft' },
          { agent: 'critic', op: 'groundedness', status: 'rejected', summary: 'unsupported number' },
          { agent: 'explainer', op: 'redraft #1', summary: draft.claim },
          { agent: 'critic', op: 'groundedness', status: 'ok', summary: 'grounded' },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('Microsoft Agent Framework sidecar integration', () => {
  it('routes explanations through the MAF workflow, surfaces its events in the trace, and re-verifies', async () => {
    const r = sim('late-comeback');
    const spans: string[] = [];
    const orch = new MatchOrchestrator(r.meta, {
      llm: new MockLlm(),
      translator: new TranslatorAgent(null),
      publish: (m) => {
        if (m.kind === 'trace') for (const s of m.spans) spans.push(`${s.agent}:${s.op}:${s.status}`);
      },
      mafEndpoint: endpoint,
      wallNow: () => 0,
    });
    orch.addProfile({ mode: 'analyst', language: 'en' } as ViewerProfile);
    const rp = new Replayer(r.meta, toStream(r), 1);
    rp.seek(55 * 60);
    rp.clock.play();
    for (let i = 0; i < 70 && !rp.done; i++) {
      orch.ingest(rp.tick(30_000));
      await orch.flush();
    }
    expect(calls).toBeGreaterThan(2);
    expect(spans.some((s) => s.startsWith('explainer:maf workflow'))).toBe(true);
    expect(spans.some((s) => s === 'critic:maf:groundedness:rejected')).toBe(true);
    // The deliberately bad MAF output is caught by the in-process Critic and never published.
    expect(spans.some((s) => s.startsWith('critic:re-verify:rejected'))).toBe(true);
    for (const x of orch.memory.explanations.values()) expect(x.claim).not.toContain('99.9');
  });
});
