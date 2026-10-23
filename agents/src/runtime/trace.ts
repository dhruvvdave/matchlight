import type { AgentName, TraceSpan } from '@matchlight/schema';

export interface SpanHandle {
  id: string;
  traceId: string;
  /** Attach structured detail (tool args, critic issues, provider, tokens...). */
  set(detail: Record<string, unknown>): void;
  status(s: TraceSpan['status']): void;
  summary(text: string): void;
}

/**
 * Agent trace logger. Every agent step / tool call / LLM call / critic verdict becomes a TraceSpan:
 * streamed to the UI's Agent Trace panel and written as structured JSON logs (-> Log Analytics in Azure).
 */
export class Tracer {
  private seq = 0;
  private traceSeq = 0;
  readonly spans: TraceSpan[] = [];
  private listeners: ((s: TraceSpan) => void)[] = [];

  constructor(
    private readonly matchTs: () => number,
    private readonly wallNow: () => number = () => performance.now(),
    private readonly log: boolean = process.env.TRACE_LOG === '1',
  ) {}

  onSpan(cb: (s: TraceSpan) => void) {
    this.listeners.push(cb);
  }

  newTrace(prefix = 't'): string {
    return `${prefix}${String(this.traceSeq++).padStart(5, '0')}`;
  }

  async span<T>(
    agent: AgentName,
    op: string,
    traceId: string,
    fn: (h: SpanHandle) => Promise<T> | T,
    parentId?: string,
  ): Promise<T> {
    const id = `s${String(this.seq++).padStart(6, '0')}`;
    const start = this.wallNow();
    let status: TraceSpan['status'] = 'ok';
    let summary = op;
    let detail: Record<string, unknown> | undefined;
    const h: SpanHandle = {
      id,
      traceId,
      set: (d) => (detail = { ...(detail ?? {}), ...d }),
      status: (s) => (status = s),
      summary: (t) => (summary = t),
    };
    try {
      return await fn(h);
    } catch (e) {
      status = 'error';
      summary = `${op} failed: ${(e as Error).message}`;
      throw e;
    } finally {
      this.emit({
        id,
        trace_id: traceId,
        parent_id: parentId,
        agent,
        op,
        ts: Math.round(this.matchTs() * 10) / 10,
        wall_ms: Math.round(start),
        latency_ms: Math.round((this.wallNow() - start) * 10) / 10,
        status,
        summary,
        detail,
      });
    }
  }

  /** Record an instantaneous span (no async work). */
  point(
    agent: AgentName,
    op: string,
    traceId: string,
    summary: string,
    detail?: Record<string, unknown>,
    status: TraceSpan['status'] = 'ok',
    parentId?: string,
  ) {
    this.emit({
      id: `s${String(this.seq++).padStart(6, '0')}`,
      trace_id: traceId,
      parent_id: parentId,
      agent,
      op,
      ts: Math.round(this.matchTs() * 10) / 10,
      wall_ms: Math.round(this.wallNow()),
      latency_ms: 0,
      status,
      summary,
      detail,
    });
  }

  private emit(span: TraceSpan) {
    this.spans.push(span);
    if (this.spans.length > 2000) this.spans.splice(0, this.spans.length - 2000);
    if (this.log) console.log(JSON.stringify({ type: 'agent_trace', ...span }));
    for (const l of this.listeners) l(span);
  }
}
