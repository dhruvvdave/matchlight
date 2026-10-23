import { useEffect, useState } from 'react';
import type { CriticIssue, Language, TraceSpan } from '@matchlight/schema';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { store } from '../lib/store';

/** Turn a Critic issue into a plain sentence. */
function issueText(i: CriticIssue): string {
  const quoted = i.detail.match(/"([^"]+)"/)?.[1];
  switch (i.code) {
    case 'unsupported_number':
      return `no match data supports the figure ${quoted ?? 'cited'}`;
    case 'unsupported_entity':
      return `${i.detail.replace(/^mentions /, '').replace(/, who is not in the evidence$/, '')} played no part in this moment`;
    case 'direction_mismatch':
      return i.detail.replace(/\(.*?\)/g, '').replace('but text says', 'but the draft said');
    case 'too_many_numbers':
      return 'too many numbers for a fan line';
    case 'unknown_fact':
      return 'it cited evidence that doesn’t exist';
    case 'unknown_event':
      return 'it cited an event that never happened';
    case 'overconfident':
      return 'it claimed more certainty than the evidence allows';
    default:
      return i.detail;
  }
}

/** One plain-language line per agent step. */
function describe(s: TraceSpan): string {
  const issues = (s.detail?.issues as CriticIssue[] | undefined) ?? [];
  if (s.agent === 'critic' && s.status === 'rejected') {
    return issues.length
      ? `Critic rejected a claim: ${issues.map(issueText).join('; ')}.`
      : 'Critic rejected a claim.';
  }
  if (s.agent === 'critic' && s.status === 'ok')
    return 'Critic checked every number and name against the match data.';
  if (s.agent === 'director') {
    const m = s.summary.match(/^(\S+) (\S+) sig=([\d.]+)( → explain)?: (.*)$/);
    if (m) return `Director picked ${m[5]} at ${m[1]}${m[4] ? ' and asked for an explanation' : ''}.`;
  }
  if (s.agent === 'stats')
    return `Stats agent pulled the evidence: ${s.summary.replace(/ tool call\(s\) → /, ' lookups, ').replace(' fact(s)', ' facts')}.`;
  if (s.agent === 'explainer' && s.op.startsWith('redraft'))
    return `Explainer wrote a new draft: ${s.summary.replace(/^\S+ draft: /, '')}`;
  if (s.agent === 'explainer' && s.op === 'draft')
    return `Explainer drafted: ${s.summary.replace(/^\S+ draft: /, '')}`;
  if (s.agent === 'explainer' && s.status === 'fallback')
    return 'Explainer ran out of attempts, so the checked template line stays.';
  if (s.agent === 'personalizer')
    return `Personalizer chose graphics per channel (${s.summary.replace(/\|/g, ';')}).`;
  if (s.agent === 'narrator' && s.status === 'fallback')
    return 'Narrator was too slow, so the instant line stays on screen.';
  if (s.agent === 'translator' && s.status === 'skipped')
    return 'No translation service is connected, so the hand-written local line stays.';
  return s.summary;
}

export function Trace({ lang }: { lang: Language }) {
  const [lat, setLat] = useState<{ fast: number; llm: number } | null>(null);
  useEffect(() => {
    const id = setInterval(async () => {
      if (!store.sessionId) return;
      try {
        const s = await api.summary(store.sessionId);
        setLat({ fast: s.latency.fast_path.p95, llm: s.latency.llm_path.p95 });
      } catch {
        /* the log keeps working without latency numbers */
      }
    }, 3000);
    return () => clearInterval(id);
  }, []);
  const spans = [...store.trace].reverse().slice(0, 120);
  return (
    <div className="log">
      {lat && (
        <p className="log-latency">
          {t(lang, 'log_latency', { fast: lat.fast.toFixed(1), llm: Math.round(lat.llm) })}
        </p>
      )}
      {spans.length === 0 && <p className="feed-empty">{t(lang, 'log_empty')}</p>}
      <ol className="log-list" lang="en" dir="ltr">
        {spans.map((s) => (
          <li key={s.id} className={`log-row st-${s.status}`}>
            <span className="log-agent">{s.agent}</span>
            <span className="log-text">{describe(s)}</span>
            {s.latency_ms > 1 && <span className="log-ms num">{Math.round(s.latency_ms)} ms</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
