/**
 * Generates the published JSON Schemas in overlay-schema/json from the Zod source of truth.
 * CI fails (tests/schema.test.ts) if the committed files drift from the Zod definitions.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJsonSchemas } from './schemas.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'json');
mkdirSync(outDir, { recursive: true });
for (const [file, schema] of Object.entries(buildJsonSchemas())) {
  writeFileSync(join(outDir, file), JSON.stringify(schema, null, 2) + '\n');
  console.log(`wrote json/${file}`);
}
