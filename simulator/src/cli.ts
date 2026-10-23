/**
 * Usage: npm run simulate -- [scenario] [seed] [--out file.jsonl] [--no-tracking]
 * Writes a replayable JSONL stream (meta line, then time-ordered event / tracking records).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ScenarioId } from '@matchlight/schema';
import { simulateMatch, toJsonl } from './index.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const pos = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
const scenario = ScenarioId.parse(pos[0] ?? 'late-comeback');
const seed = pos[1] ? Number(pos[1]) : undefined;
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : `data/runs/${scenario}-${seed ?? 'default'}.jsonl`;
const t0 = performance.now();
const res = simulateMatch({ scenario, seed, tracking: !flags.has('--no-tracking') });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, toJsonl(res));
const s = res.events.at(-1);
console.log(
  `${res.meta.title}: ${res.meta.home.short} ${s && 'score' in s ? s.score.home : '?'}-${s && 'score' in s ? s.score.away : '?'} ${res.meta.away.short} | ${res.events.length} events, ${res.frames.length} frames -> ${out} (${(performance.now() - t0).toFixed(0)} ms)`,
);
