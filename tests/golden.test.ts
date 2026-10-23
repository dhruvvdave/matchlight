import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ViewerProfile } from '@matchlight/schema';
import { runPipeline } from './pipeline-run.js';

const GOLDEN = join(__dirname, 'golden', 'late-comeback.overlays.json');

/**
 * Golden-file test: the RENDER stage output for a seeded match must be byte-stable.
 * Regenerate intentionally with `npm run golden:update` and review the diff.
 */
describe('golden overlay output (late-comeback, seed 1861)', () => {
  it('matches the committed golden file', async () => {
    const profiles: ViewerProfile[] = [
      { mode: 'analyst', language: 'en', tts: false, high_contrast: false },
      { mode: 'casual', language: 'fr', tts: false, high_contrast: false },
      { mode: 'club', language: 'ar', favorite_team: 'home', tts: false, high_contrast: false },
    ];
    const { msgs } = await runPipeline('late-comeback', profiles);
    const overlays = msgs
      .filter((m) => m.kind === 'overlay')
      .map((m) => {
        const o = (m as Extract<typeof m, { kind: 'overlay' }>).overlay;
        const c = o.content as Record<string, unknown>;
        return {
          id: o.id,
          kind: o.kind,
          start_ts: o.start_ts,
          duration: o.duration,
          priority: o.priority,
          region: o.region,
          position: o.position,
          key: o.debounce_key,
          lang: o.language,
          dir: o.dir,
          text: c.title ?? c.label ?? c.name ?? '',
          body: c.body ?? c.display ?? c.value ?? '',
        };
      });
    const actual = JSON.stringify(overlays, null, 1) + '\n';
    if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) writeFileSync(GOLDEN, actual);
    expect(actual).toBe(readFileSync(GOLDEN, 'utf8'));
    expect(overlays.length).toBeGreaterThan(100);
  });
});
