import { useState } from 'react';
import type { AskAnswer, ViewerProfile } from '@matchlight/schema';
import { t } from '../lib/i18n';
import { store } from '../lib/store';

const SUGGESTIONS = [
  'Who is the fastest player?',
  'Why did the momentum change?',
  "What happened at 64'?",
  'What is the xG?',
  'Who ran the most?',
];

export function Ask({ profile, answers }: { profile: ViewerProfile; answers: AskAnswer[] }) {
  const lang = profile.language;
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
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(q);
        }}
      >
        <label className="sr-only" htmlFor="ask-input">
          {t(lang, 'ask_placeholder')}
        </label>
        <input
          id="ask-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(lang, 'ask_placeholder')}
          maxLength={300}
        />
        <button className="btn" disabled={busy || !q.trim()}>
          {t(lang, 'ask_button')}
        </button>
      </form>
      <p className="ask-try" lang="en" dir="ltr">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="link" onClick={() => submit(s)} disabled={busy}>
            {s}
          </button>
        ))}
      </p>
      {err && <p className="error">{err}</p>}
      <div className="ask-log" aria-live="polite">
        {answers.length === 0 && <p className="feed-empty">{t(lang, 'ask_empty')}</p>}
        {[...answers].reverse().map((a) => (
          <article key={a.id} className={a.grounded ? 'qa' : 'qa qa-unchecked'}>
            <p className="q">{a.question}</p>
            <p className="a" dir={a.dir} lang={a.lang}>
              {a.answer}
            </p>
            <p className="a-note">{t(lang, a.grounded ? 'checked' : 'not_checked')}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
