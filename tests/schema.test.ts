import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv';
import { Overlay, ViewerProfile, profileKey } from '@matchlight/schema';
import { buildJsonSchemas } from '../overlay-schema/scripts/schemas.js';
import { sim } from './helpers.js';

const root = join(__dirname, '..', 'overlay-schema', 'json');
// ajv ships CJS; normalise the default export under ESM.
type Validator = ((data: unknown) => boolean) & { errors?: unknown };
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as new (
  opts: Record<string, unknown>,
) => {
  compile: (schema: object) => Validator;
};

describe('schemas', () => {
  it('committed JSON Schemas match the Zod source of truth (run `npm run schema:gen`)', () => {
    for (const [file, schema] of Object.entries(buildJsonSchemas())) {
      const committed = JSON.parse(readFileSync(join(root, file), 'utf8'));
      expect(committed, file).toEqual(JSON.parse(JSON.stringify(schema)));
    }
  });

  it('JSON Schema (Ajv) accepts simulator events', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'event.schema.json'), 'utf8')));
    for (const e of sim('late-comeback').events.slice(0, 400)) {
      expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  it('JSON Schema rejects an overlay with an off-screen position or bad priority', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(join(root, 'overlay.schema.json'), 'utf8')));
    const good = {
      id: 'o1',
      schema_version: '1.0.0',
      match_id: 'm',
      profile_key: 'analyst.en',
      start_ts: 10,
      duration: 5,
      priority: 50,
      region: 'top_right',
      position: { x: 0.7, y: 0, w: 0.3, h: 0.1 },
      debounce_key: 'k',
      language: 'en',
      dir: 'ltr',
      theme: 'broadcast',
      aria_label: 'x',
      source_event_ids: ['e1'],
      kind: 'stat_badge',
      content: { metric: 'ball_speed', label: 'Ball speed', value: 92, display: '92', unit: 'km/h' },
    };
    expect(validate(good)).toBe(true);
    expect(Overlay.safeParse(good).success).toBe(true);
    expect(validate({ ...good, position: { ...good.position, x: 1.4 } })).toBe(false);
    expect(validate({ ...good, priority: 101 })).toBe(false);
    expect(validate({ ...good, kind: 'confetti' })).toBe(false);
  });

  it('profile keys are stable and ignore irrelevant fields', () => {
    const a = ViewerProfile.parse({ mode: 'analyst', language: 'en', metric: 'xg' });
    const b = ViewerProfile.parse({ mode: 'analyst', language: 'en', metric: 'ppda' });
    expect(profileKey(a)).toBe(profileKey(b));
    expect(profileKey(ViewerProfile.parse({ mode: 'club', language: 'ar', favorite_team: 'away' }))).toBe(
      'club.ar.away',
    );
  });
});
