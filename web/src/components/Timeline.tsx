import type { Language, Moment } from '@matchlight/schema';
import { kit } from '../lib/kits';
import { t } from '../lib/i18n';
import { store } from '../lib/store';

const minuteOf = (m: Moment) => {
  const base = parseInt(m.minute_label, 10);
  const added = m.minute_label.includes('+') ? Number(m.minute_label.split('+')[1].replace("'", '')) : 0;
  return base + added * 0.3;
};

/**
 * Key moments in order, numbered because they are a real sequence. Positions use the inline-start
 * edge, so in Arabic the match runs from right to left. Click a moment to rewind to it.
 */
export function Timeline({ lang }: { lang: Language }) {
  const meta = store.meta;
  const state = store.state;
  if (!meta) return <footer className="timeline" />;
  const minute = (state?.game_s ?? 0) / 60;
  const key = store.moments.filter(
    (m) => m.significance >= 0.66 || m.kind === 'goal' || m.kind === 'red_card',
  );
  const pos = (min: number) => `${Math.min(100, (min / 96) * 100)}%`;
  return (
    <footer className="timeline">
      <h2 className="sr-only">{t(lang, 'timeline')}</h2>
      <div className="tl">
        <span className="tl-half" style={{ insetInlineStart: pos(45) }} aria-hidden />
        <span className="tl-now" style={{ insetInlineStart: pos(minute) }} aria-hidden />
        <ol className="tl-moments">
          {key.map((m, i) => (
            <li
              key={m.id}
              style={{
                insetInlineStart: pos(minuteOf(m)),
                ['--kit' as string]: m.team ? kit(meta, m.team).base : 'var(--chalk-2)',
              }}
            >
              <button
                className={m.kind === 'goal' ? 'tl-mark tl-goal' : 'tl-mark'}
                aria-label={`${i + 1}. ${m.minute_label} ${m.headline}. ${t(lang, 'rewind_to', { min: m.minute_label })}`}
                title={`${m.minute_label} ${m.headline}`}
                onClick={() => store.control('seek', Math.max(0, m.ts - 8))}
              >
                <span className="num">{i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="tl-scale num" aria-hidden>
          <span style={{ insetInlineStart: '0%' }}>0′</span>
          <span style={{ insetInlineStart: pos(45) }}>45′</span>
          <span style={{ insetInlineStart: pos(90) }}>90′</span>
        </p>
      </div>
    </footer>
  );
}
