import { useEffect, useRef, useState } from 'react';
import type { Language, Recap } from '@matchlight/schema';
import { api } from '../lib/api';
import { kit } from '../lib/kits';
import { t } from '../lib/i18n';
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const sid = store.sessionId!;
  useEffect(() => {
    api.recap(sid, lang).then(setRecap, (e) => setErr((e as Error).message));
  }, [sid, lang]);
  useEffect(() => {
    closeRef.current?.focus();
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
  const ft = store.state?.status === 'full_time';
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-title"
        onClick={(e) => e.stopPropagation()}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        lang={lang}
      >
        <button ref={closeRef} className="btn sheet-close" onClick={onClose}>
          {t(lang, 'close')}
        </button>
        {!recap && !err && <p className="feed-empty">{t(lang, 'recap_writing')}</p>}
        {err && <p className="error">{err}</p>}
        {recap && (
          <>
            <p className="recap-when">
              {ft ? t(lang, 'recap_ft') : t(lang, 'recap_so_far', { min: store.state?.minute_label ?? '' })}
            </p>
            <h2 id="recap-title" className="recap-head">
              {recap.headline}
            </h2>
            <p className="recap-score">
              <span style={{ ['--kit' as string]: kit(meta, 'home').base }}>{meta.home.name}</span>
              <b className="num">
                {recap.final_score.home}–{recap.final_score.away}
              </b>
              <span style={{ ['--kit' as string]: kit(meta, 'away').base }}>{meta.away.name}</span>
            </p>
            <p className={recap.grounded ? 'recap-check' : 'recap-check is-warn'}>
              {t(lang, recap.grounded ? 'checked' : 'not_checked')}
            </p>
            <div className="recap-cols">
              <article className="recap-article" dir="ltr" lang="en">
                {recap.article_md
                  .split('\n')
                  .filter((l) => l.trim() && !l.startsWith('# ') && !/^\*[^*].*\*$/.test(l.trim()))
                  .map((l, i) => (
                    <p key={i} dangerouslySetInnerHTML={{ __html: md(l) }} />
                  ))}
                <h3>{t(lang, 'script')}</h3>
                <blockquote dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
                  {recap.script_60s}
                </blockquote>
              </article>
              <aside>
                <h3>{t(lang, 'timeline')}</h3>
                <ol className="recap-tl">
                  {recap.timeline.map((x, i) => (
                    <li
                      key={i}
                      style={{ ['--kit' as string]: x.team ? kit(meta, x.team).base : 'var(--chalk-2)' }}
                    >
                      <span className="num">{x.minute_label}</span> {x.title}
                    </li>
                  ))}
                </ol>
                <h3>{t(lang, 'ratings')}</h3>
                <table className="ratings">
                  <tbody>
                    {recap.player_ratings.slice(0, 8).map((p) => (
                      <tr key={p.player_id} style={{ ['--kit' as string]: kit(meta, p.side).base }}>
                        <td className="num">{p.rating.toFixed(1)}</td>
                        <th scope="row">{p.name}</th>
                        <td>{p.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </aside>
            </div>
            <p className="recap-actions">
              <a className="btn" href={api.url(`/api/sessions/${sid}/recap?lang=${lang}&format=md`)}>
                {t(lang, 'download_md')}
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
                {t(lang, 'download_json')}
              </button>
              <a className="btn" href={api.url(`/api/sessions/${sid}/events.jsonl?all=1`)}>
                {t(lang, 'download_stream')}
              </a>
              {ttsAzure ? (
                <a className="btn" href={api.url(`/api/sessions/${sid}/recap.mp3?lang=${lang}`)}>
                  {t(lang, 'download_mp3')}
                </a>
              ) : (
                <button className="btn" onClick={() => speak(recap.script_60s, lang)}>
                  {t(lang, 'play_script')}
                </button>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function md(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}
