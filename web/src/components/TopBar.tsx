import { formatClock, formatMinute } from '@matchlight/schema';
import { store, useFrame } from '../lib/store';

const SPEEDS = [1, 10, 20, 60];

export function TopBar({
  onRecap,
  onDemo,
  demoActive,
  view,
  setView,
}: {
  onRecap: () => void;
  onDemo: () => void;
  demoActive: boolean;
  view: 'broadcast' | 'split';
  setView: (v: 'broadcast' | 'split') => void;
}) {
  useFrame();
  const meta = store.meta;
  const clock = store.clock;
  const state = store.state;
  const now = store.now();
  // Interpolate the football clock between server ticks.
  const gameS = state && clock ? state.game_s + Math.max(0, now - state.ts) : 0;
  const period = state?.period ?? 1;
  const score = state?.score ?? { home: 0, away: 0 };
  const status = state?.status ?? 'pre';
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          ◉
        </span>
        <span className="brand-name">MATCHLIGHT</span>
        <span className="brand-tag">synthetic data · fictional clubs</span>
      </div>
      {meta ? (
        <div
          className="scorebug"
          aria-live="polite"
          aria-label={`${meta.home.name} ${score.home}, ${meta.away.name} ${score.away}`}
        >
          <span className="sb-team" style={{ ['--team' as string]: meta.home.colors.primary }}>
            <i />
            {meta.home.short}
          </span>
          <span className="sb-score" key={`${score.home}-${score.away}`}>
            {score.home}
            <em>–</em>
            {score.away}
          </span>
          <span className="sb-team sb-away" style={{ ['--team' as string]: meta.away.colors.primary }}>
            {meta.away.short}
            <i />
          </span>
          <span className="sb-clock">
            {status === 'half_time'
              ? 'HT'
              : status === 'full_time'
                ? 'FT'
                : formatClock(Math.min(gameS, period === 1 ? 2700 + 600 : 5400 + 900))}
            <small>{status === 'live' ? formatMinute(gameS, period) : ''}</small>
          </span>
          {clock?.playing && status === 'live' && <span className="live-dot">LIVE</span>}
        </div>
      ) : (
        <div className="scorebug muted">No match loaded</div>
      )}
      <div className="controls">
        <button
          className="btn icon"
          onClick={() => store.control(clock?.playing ? 'pause' : 'play')}
          disabled={!meta}
          aria-label={clock?.playing ? 'Pause' : 'Play'}
        >
          {clock?.playing ? '❚❚' : '▶'}
        </button>
        <div className="seg" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={clock?.speed === s ? 'on' : ''}
              onClick={() => store.control('speed', s)}
              disabled={!meta}
            >
              {s}×
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="View">
          <button className={view === 'broadcast' ? 'on' : ''} onClick={() => setView('broadcast')}>
            Broadcast
          </button>
          <button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')}>
            Split
          </button>
        </div>
        <button className="btn" onClick={onRecap} disabled={!meta}>
          Recap
        </button>
        <button className={`btn demo ${demoActive ? 'on' : ''}`} onClick={onDemo}>
          {demoActive ? '■ Stop demo' : '★ Demo mode'}
        </button>
      </div>
    </header>
  );
}
