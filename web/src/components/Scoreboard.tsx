import type { Language, ViewerMode } from '@matchlight/schema';
import { formatClock, formatMinute } from '@matchlight/schema';
import { kit } from '../lib/kits';
import { t, type StringKey } from '../lib/i18n';
import { store, useFrame } from '../lib/store';

const SPEEDS = [1, 10, 20, 60];
export const CHANNELS: { mode: ViewerMode; key: StringKey }[] = [
  { mode: 'analyst', key: 'ch_analyst' },
  { mode: 'casual', key: 'ch_casual' },
  { mode: 'club', key: 'ch_club' },
  { mode: 'player', key: 'ch_player' },
  { mode: 'metric', key: 'ch_metric' },
];

/** Digits on individual plates, like a stadium board. Each plate flips when its digit changes. */
function Plates({ value, label }: { value: string; label: string }) {
  return (
    <span className="plates" aria-label={label}>
      {value.split('').map((d, i) => (
        <span className="plate" key={`${i}-${d}`} aria-hidden>
          {d}
        </span>
      ))}
    </span>
  );
}

export function Scoreboard({
  lang,
  mode,
  onMode,
}: {
  lang: Language;
  mode: ViewerMode;
  onMode: (m: ViewerMode) => void;
}) {
  useFrame();
  const meta = store.meta;
  const clock = store.clock;
  const state = store.state;
  const gameS = state && clock ? state.game_s + Math.max(0, store.now() - state.ts) : 0;
  const period = state?.period ?? 1;
  const score = state?.score ?? { home: 0, away: 0 };
  const status = state?.status ?? 'pre';
  const clockText =
    status === 'half_time'
      ? t(lang, 'half_time')
      : status === 'full_time'
        ? t(lang, 'full_time')
        : formatClock(Math.min(gameS, period === 1 ? 3300 : 6300));
  return (
    <div className="strip">
      {meta ? (
        <div
          className="board-score"
          role="group"
          aria-label={`${meta.home.name} ${score.home}, ${meta.away.name} ${score.away}`}
        >
          <span
            className="sb-team"
            style={{ ['--kit' as string]: kit(meta, 'home').base }}
            title={meta.home.name}
          >
            {meta.home.short}
          </span>
          <Plates value={String(score.home)} label={`${meta.home.name} ${score.home}`} />
          <Plates value={String(score.away)} label={`${meta.away.name} ${score.away}`} />
          <span
            className="sb-team"
            style={{ ['--kit' as string]: kit(meta, 'away').base }}
            title={meta.away.name}
          >
            {meta.away.short}
          </span>
          <span
            className="sb-clock num"
            aria-label={status === 'live' ? formatMinute(gameS, period) : clockText}
          >
            {clockText}
          </span>
          <span className={clock?.playing && status === 'live' ? 'sb-state is-live' : 'sb-state'}>
            {clock?.playing && status === 'live' ? t(lang, 'live') : t(lang, 'paused')}
          </span>
        </div>
      ) : (
        <p className="board-score-empty">{t(lang, 'loading_match')}</p>
      )}
      <nav className="channels" aria-label={t(lang, 'channels')}>
        {CHANNELS.map((c) => (
          <button key={c.mode} aria-pressed={mode === c.mode} onClick={() => onMode(c.mode)}>
            {t(lang, c.key)}
          </button>
        ))}
      </nav>
      <div className="transport">
        <button
          className="btn"
          onClick={() => store.control(clock?.playing ? 'pause' : 'play')}
          disabled={!meta}
        >
          {clock?.playing ? t(lang, 'pause') : t(lang, 'play')}
        </button>
        <span className="speeds" role="group" aria-label={t(lang, 'speed')}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              aria-pressed={clock?.speed === s}
              onClick={() => store.control('speed', s)}
              disabled={!meta}
            >
              <span className="num">{s}×</span>
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}
