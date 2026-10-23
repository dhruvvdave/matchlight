import type { CSSProperties } from 'react';
import type { FeedItem, Language } from '@matchlight/schema';
import { kit } from '../lib/kits';
import { t } from '../lib/i18n';
import { store } from '../lib/store';

/**
 * Commentary list. The start-edge rule carries meaning: its colour is the team the line is about,
 * dashed means an instant template line, solid means the line was rewritten and checked against the data.
 */
export function Feed({
  items,
  lang,
  density,
  label,
}: {
  items: FeedItem[];
  lang: Language;
  density: 'dense' | 'relaxed' | 'compact';
  label: string;
}) {
  const list = [...items].reverse().slice(0, density === 'compact' ? 6 : 80);
  return (
    <ol className={`feed feed-${density}`} aria-label={label} aria-live="polite" aria-relevant="additions">
      {list.length === 0 && <li className="feed-empty">{t(lang, 'feed_empty')}</li>}
      {list.map((f) => {
        const style: CSSProperties = f.team ? { ['--kit' as string]: kit(store.meta, f.team).base } : {};
        return (
          <li
            key={f.id}
            className={`line ${f.source === 'template' ? 'line-instant' : 'line-checked'} ${f.kind === 'system' ? 'line-system' : ''} em-${f.emphasis}`}
            style={style}
            dir={f.dir}
            lang={f.lang}
          >
            <span className="line-min num">{f.minute_label}</span>
            <p className="line-text">{f.text}</p>
          </li>
        );
      })}
    </ol>
  );
}
