import { StreamRecord, type MatchMeta } from '@matchlight/schema';

export interface ParsedStream {
  meta: MatchMeta | null;
  records: StreamRecord[];
  invalid: { line: number; error: string }[];
}

/** Parse + validate a JSONL stream. Invalid lines are reported, never silently trusted. */
export function parseJsonl(text: string): ParsedStream {
  const out: ParsedStream = { meta: null, records: [], invalid: [] };
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (e) {
      out.invalid.push({ line: i + 1, error: `bad json: ${(e as Error).message}` });
      return;
    }
    const res = StreamRecord.safeParse(raw);
    if (!res.success) {
      out.invalid.push({ line: i + 1, error: res.error.issues[0]?.message ?? 'invalid' });
      return;
    }
    if (res.data.kind === 'meta') out.meta = res.data.meta;
    out.records.push(res.data);
  });
  return out;
}

export function toJsonlLines(records: StreamRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}
