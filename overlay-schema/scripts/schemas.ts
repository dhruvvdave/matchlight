import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import {
  Explanation,
  FeedItem,
  LiveState,
  MatchEvent,
  MatchMeta,
  Overlay,
  Recap,
  SCHEMA_VERSION,
  StreamRecord,
  TraceSpan,
  TrackingFrame,
  ViewerProfile,
} from '../src/index.js';

const entries: Record<string, [string, ZodTypeAny]> = {
  'overlay.schema.json': ['Overlay', Overlay],
  'event.schema.json': ['MatchEvent', MatchEvent],
  'tracking.schema.json': ['TrackingFrame', TrackingFrame],
  'stream-record.schema.json': ['StreamRecord', StreamRecord],
  'match-meta.schema.json': ['MatchMeta', MatchMeta],
  'live-state.schema.json': ['LiveState', LiveState],
  'explanation.schema.json': ['Explanation', Explanation],
  'feed-item.schema.json': ['FeedItem', FeedItem],
  'viewer-profile.schema.json': ['ViewerProfile', ViewerProfile],
  'trace-span.schema.json': ['TraceSpan', TraceSpan],
  'recap.schema.json': ['Recap', Recap],
};

export function buildJsonSchemas(): Record<string, object> {
  const out: Record<string, object> = {};
  for (const [file, [name, schema]] of Object.entries(entries)) {
    const json = zodToJsonSchema(schema, { name, $refStrategy: 'none', target: 'jsonSchema7' }) as Record<
      string,
      unknown
    >;
    out[file] = {
      $id: `https://matchlight.dev/schema/${SCHEMA_VERSION}/${file}`,
      title: name,
      'x-schema-version': SCHEMA_VERSION,
      ...json,
    };
  }
  return out;
}
