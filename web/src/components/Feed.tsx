import { useEffect, useRef } from 'react';
import type { FeedItem } from '@matchlight/schema';
import { store } from '../lib/store';

const KIND_ICON: Record<string, string> = {
  goal: '⚽',
  red_card: '🟥',
  card: '🟨',
  substitution: '⇅',
  tactical_shift: '⇄',
  momentum_swing: '↗',
  pressing_shift: '⤧',
  speed_flag: '⚡',
  difficult_pass: '➶',
  big_chance: '◎',
  save: '✋',
  xg_swing: '◎',
  period_summary: '⏱',
  player_milestone: '★',
};

export function Feed({ items, compact, label }: { items: FeedItem[]; compact?: boolean; label: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const last = items.at(-1)?.id;
  useEffect(() => {
    ref.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [last]);
  const list = [...items].reverse();
  return (
    <ol
      ref={ref}
      className={`feed ${compact ? 'compact' : ''}`}
      aria-label={label}
      aria-live="polite"
      aria-relevant="additions"
    >
      {list.length === 0 && <li className="feed-empty">Commentary appears here as the match unfolds…</li>}
      {list.map((f) => {
        const x = f.moment_id ? store.explanations.get(f.moment_id) : undefined;
        return (
          <li
            key={f.id}
            className={`fi em-${f.emphasis} k-${f.kind} ${f.supersedes ? 'upgraded' : ''}`}
            dir={f.dir}
            lang={f.lang}
          >
            <div className="fi-meta">
              <span className="fi-min">{f.minute_label}</span>
              {f.moment_kind && (
                <span className="fi-icon" aria-hidden>
                  {KIND_ICON[f.moment_kind] ?? '•'}
                </span>
              )}
              <span
                className={`chip src-${f.source}`}
                title={
                  f.source === 'template'
                    ? 'Instant template line (fast path)'
                    : 'Agent narrative, verified by the Critic'
                }
              >
                {f.source === 'template'
                  ? 'instant'
                  : f.source === 'translator'
                    ? 'AI · translated'
                    : 'AI · grounded'}
              </span>
            </div>
            <p className="fi-text">{f.text}</p>
            {!compact && f.metrics && f.metrics.length > 0 && (
              <div className="fi-metrics">
                {f.metrics.map((m, i) => (
                  <span key={i}>
                    {m.label} <b>{m.value}</b>
                  </span>
                ))}
              </div>
            )}
            {!compact && x && f.kind === 'key_moment' && x.critic.attempts > 1 && (
              <div className="fi-critic" title={x.critic.issues.map((i) => i.detail).join('\n')}>
                Critic rejected {x.critic.attempts - 1} draft{x.critic.attempts > 2 ? 's' : ''} before
                approving
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
