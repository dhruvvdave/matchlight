import type { GroupMessage, ViewerProfile } from '@matchlight/schema';
import { MatchOrchestrator, MockLlm, TranslatorAgent } from '@matchlight/agents';
import { Replayer } from '@matchlight/pipeline';
import { toStream } from '@matchlight/simulator';
import { sim } from './helpers.js';

/** Run a seeded match through all five stages deterministically and capture every published message. */
export async function runPipeline(
  scenario: Parameters<typeof sim>[0],
  profiles: ViewerProfile[],
  opts: { hallucinationRate?: number; stepMs?: number } = {},
) {
  const r = sim(scenario);
  const msgs: GroupMessage[] = [];
  const orch = new MatchOrchestrator(r.meta, {
    llm: new MockLlm(),
    translator: new TranslatorAgent(null),
    publish: (m) => msgs.push(m),
    deterministic: true,
    hallucinationRate: opts.hallucinationRate ?? 0.2,
    wallNow: () => 0,
  });
  const keys = profiles.map((p) => orch.addProfile(p));
  const rp = new Replayer(r.meta, toStream(r), 1);
  rp.clock.play();
  while (!rp.done) {
    const b = rp.tick(opts.stepMs ?? 5000);
    orch.ingest(b);
    orch.tick(rp.clock.ts);
    await orch.flush();
  }
  return { orch, msgs, keys, sim: r };
}
