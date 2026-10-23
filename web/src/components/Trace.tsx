import { useEffect, useState } from 'react';
import type { AgentName } from '@matchlight/schema';
import { api } from '../lib/api';
import { store } from '../lib/store';

const PIPELINE: { agent: AgentName; label: string; stage: string }[] = [
  { agent: 'director', label: 'Director', stage: 'orchestrate' },
  { agent: 'stats', label: 'Stats', stage: 'interpret' },
  { agent: 'explainer', label: 'Explainer', stage: 'explain' },
  { agent: 'critic', label: 'Critic', stage: 'verify' },
  { agent: 'personalizer', label: 'Personalizer', stage: 'personalize' },
  { agent: 'narrator', label: 'Narrator', stage: 'narrate' },
  { agent: 'translator', label: 'Translator', stage: 'localize' },
  { agent: 'recap', label: 'Recap', stage: 'summarize' },
];

export function Trace() {
  const [filter, setFilter] = useState<AgentName | 'all'>('all');
  const [lat, setLat] = useState<{ fast: number; llm: number; n: number } | null>(null);
  const [providers, setProviders] = useState<{ llm: string; translator: string } | null>(null);
  useEffect(() => {
    const id = setInterval(async () => {
      if (!store.sessionId) return;
      try {
        const s = await api.summary(store.sessionId);
        setLat({ fast: s.latency.fast_path.p95, llm: s.latency.llm_path.p95, n: s.latency.fast_path.count });
        setProviders(s.providers);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(id);
  }, []);
  const spans = store.trace;
  const recent = new Map<string, number>();
  const wallNow = spans.at(-1)?.wall_ms ?? 0;
  for (const s of spans) recent.set(s.agent, s.wall_ms);
  const shown = [...spans]
    .reverse()
    .filter((s) => filter === 'all' || s.agent === filter)
    .slice(0, 120);
  return (
    <div className="trace">
      <div className="pipeline" aria-label="Agent pipeline">
        {PIPELINE.map((p, i) => {
          const hot = wallNow - (recent.get(p.agent) ?? -1e9) < 1500;
          return (
            <button
              key={p.agent}
              className={`node a-${p.agent} ${hot ? 'hot' : ''} ${filter === p.agent ? 'sel' : ''}`}
              onClick={() => setFilter(filter === p.agent ? 'all' : p.agent)}
            >
              <span className="node-label">{p.label}</span>
              <span className="node-stage">{p.stage}</span>
              {i < PIPELINE.length - 1 && <span className="node-arrow" aria-hidden />}
            </button>
          );
        })}
      </div>
      <div className="latency">
        <span>
          event→overlay p95 <b>{lat ? `${lat.fast.toFixed(1)} ms` : '…'}</b>{' '}
          <em className={lat && lat.fast < 1500 ? 'ok' : ''}>budget 1500 ms</em>
        </span>
        <span>
          LLM path p95 <b>{lat ? `${Math.round(lat.llm)} ms` : '…'}</b>
        </span>
        {providers && (
          <span className="muted">
            LLM: {providers.llm} · i18n: {providers.translator}
          </span>
        )}
      </div>
      <ol className="spans">
        {shown.map((s) => (
          <li key={s.id} className={`span st-${s.status} a-${s.agent}`}>
            <span className="sp-agent">{s.agent}</span>
            <span className="sp-op">{s.op}</span>
            <span className="sp-lat">{s.latency_ms ? `${s.latency_ms.toFixed(0)}ms` : ''}</span>
            <span className="sp-sum">{s.summary}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
