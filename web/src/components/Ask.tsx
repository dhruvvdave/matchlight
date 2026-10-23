import { useState } from 'react';
import type { AskAnswer, ViewerProfile } from '@matchlight/schema';
import { store } from '../lib/store';

const SUGGESTIONS = [
  'Who is the fastest player?',
  'Why did the momentum change?',
  "What happened at 64'?",
  'What is the xG?',
  'How many shots?',
  'Who ran the most?',
];

export function Ask({ profile, answers }: { profile: ViewerProfile; answers: AskAnswer[] }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await store.ask(text, profile);
      setQ('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ask">
      <div className="ask-log" aria-live="polite">
        {answers.length === 0 && (
          <p className="muted">
            Ask anything about the match. Answers come from the event store and are checked by the Critic
            agent.
          </p>
        )}
        {[...answers].reverse().map((a) => (
          <div key={a.id} className="qa">
            <div className="q">{a.question}</div>
            <div className="a" dir={a.dir} lang={a.lang}>
              {a.answer}
            </div>
            <div className="a-meta">
              <span className={`chip ${a.grounded ? 'ok' : 'warn'}`}>
                {a.grounded ? '✓ grounded' : '! unverified'}
              </span>
              <span className="chip">{a.source === 'llm' ? 'Azure OpenAI + tools' : 'rule router'}</span>
              {a.event_ids.length > 0 && (
                <span className="chip mono">
                  {a.event_ids.slice(0, 4).join(' ')}
                  {a.event_ids.length > 4 ? ' …' : ''}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="ask-sugs">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="sug" onClick={() => submit(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask the match…"
          aria-label="Ask the match"
          maxLength={300}
        />
        <button className="btn" disabled={busy || !q.trim()}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
