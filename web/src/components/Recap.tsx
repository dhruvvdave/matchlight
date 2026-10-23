import { useEffect, useState } from 'react';
import type { Language, Recap } from '@matchlight/schema';
import { api } from '../lib/api';
import { store } from '../lib/store';
import { speak } from '../lib/tts';

export function RecapModal({
  lang,
  onClose,
  ttsAzure,
}: {
  lang: Language;
  onClose: () => void;
  ttsAzure: boolean;
}) {
  const [recap, setRecap] = useState<Recap | null>(store.recaps.get(lang) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const sid = store.sessionId!;
  useEffect(() => {
    api.recap(sid, lang).then(setRecap, (e) => setErr((e as Error).message));
  }, [sid, lang]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const meta = store.meta!;
  const download = (name: string, text: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Match recap"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-x" onClick={onClose} aria-label="Close">
          ×
        </button>
        {!recap && !err && (
          <div className="loading-block">Recap agent is writing… (article, 60-second script, ratings)</div>
        )}
        {err && <p className="error">{err}</p>}
        {recap && (
          <div className="recap" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <div className="recap-kicker">
              {store.state?.status === 'full_time'
                ? 'Full-time recap'
                : `Recap so far · ${store.state?.minute_label ?? ''}`}{' '}
              · {recap.source === 'llm' ? 'Azure OpenAI' : 'template'} ·{' '}
              <span className={recap.grounded ? 'ok' : 'warn'}>
                {recap.grounded ? 'Critic: grounded' : 'Critic: issues flagged'}
              </span>
            </div>
            <h2>{recap.headline}</h2>
            <div className="recap-score">
              <span style={{ color: meta.home.colors.primary }}>{meta.home.name}</span>
              <b>
                {recap.final_score.home} – {recap.final_score.away}
              </b>
              <span style={{ color: meta.away.colors.primary }}>{meta.away.name}</span>
            </div>
            <div className="recap-grid">
              <article className="recap-article" dir="ltr">
                {recap.article_md
                  .split('\n')
                  .filter((l) => l.trim() && !l.startsWith('# '))
                  .map((l, i) => (
                    <p key={i} dangerouslySetInnerHTML={{ __html: mdInline(l) }} />
                  ))}
                <h3>60-second script</h3>
                <blockquote dir={lang === 'ar' ? 'rtl' : 'ltr'}>{recap.script_60s}</blockquote>
              </article>
              <aside>
                <h3>Key moments</h3>
                <ol className="recap-tl">
                  {recap.timeline.map((t, i) => (
                    <li
                      key={i}
                      style={{ ['--team' as string]: t.team ? meta[t.team].colors.primary : 'var(--accent)' }}
                    >
                      <b>{t.minute_label}</b> {t.title}
                    </li>
                  ))}
                </ol>
                <h3>Player ratings</h3>
                <ol className="ratings">
                  {recap.player_ratings.slice(0, 10).map((p) => (
                    <li key={p.player_id}>
                      <span className="r-val">{p.rating.toFixed(1)}</span>
                      <span className="r-name" style={{ color: meta[p.side].colors.primary }}>
                        {p.name}
                      </span>
                      <span className="r-why">{p.reason}</span>
                    </li>
                  ))}
                </ol>
                <table className="kstats">
                  <tbody>
                    {recap.key_stats.map((k) => (
                      <tr key={k.label}>
                        <td>{k.home}</td>
                        <th>{k.label}</th>
                        <td>{k.away}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </aside>
            </div>
            <div className="recap-actions">
              <a className="btn" href={api.url(`/api/sessions/${sid}/recap?lang=${lang}&format=md`)}>
                ⤓ Markdown
              </a>
              <button
                className="btn"
                onClick={() =>
                  download(
                    `${meta.match_id}-recap-${lang}.json`,
                    JSON.stringify(recap, null, 2),
                    'application/json',
                  )
                }
              >
                ⤓ JSON
              </button>
              <a className="btn" href={api.url(`/api/sessions/${sid}/events.jsonl?all=1`)}>
                ⤓ Event stream (JSONL)
              </a>
              {ttsAzure ? (
                <a className="btn" href={api.url(`/api/sessions/${sid}/recap.mp3?lang=${lang}`)}>
                  ⤓ Narrated audio (MP3)
                </a>
              ) : (
                <button
                  className="btn"
                  onClick={() => speak(recap.script_60s, lang)}
                  title="Offline: browser speech. Configure Azure AI Speech for MP3 export."
                >
                  ▶ Play script
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function mdInline(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}
