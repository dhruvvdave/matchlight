import { useEffect, useState } from 'react';
import type { ViewerProfile } from '@matchlight/schema';
import { normaliseProfile, profileKey } from '@matchlight/schema';
import { store, useFrame } from '../lib/store';
import { Insights } from './Insights';
import { OverlayLayer } from './Overlays';
import { Pitch } from './Pitch';
import { LANGS, MODES } from './ProfilePanel';

/** Register a profile with the server for the current session; returns its key once live. */
export function useViewer(profile: ViewerProfile): string | null {
  const sid = store.sessionId;
  const key = profileKey(normaliseProfile(profile));
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!sid) return;
    let alive = true;
    store
      .addViewer(profile)
      .then((k) => alive && setReady(k))
      .catch(() => alive && setReady(null));
    return () => {
      alive = false;
      store.removeViewer(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, key]);
  return ready === key ? key : null;
}

export function Stage({ profile, compact }: { profile: ViewerProfile; compact?: boolean }) {
  useFrame();
  const key = useViewer(profile);
  const meta = store.meta;
  const v = key ? store.viewers.get(key) : undefined;
  const now = store.now();
  const mode = MODES.find((m) => m.id === profile.mode)!;
  const lang = LANGS.find((l) => l.id === profile.language)!;
  const focusStats =
    profile.mode === 'player' && profile.focus_player_id
      ? store.state?.players[profile.focus_player_id]
      : null;
  return (
    <div className={`viewer ${compact ? 'compact' : ''}`}>
      <div className="stage" data-hc={profile.high_contrast ? '1' : '0'}>
        <Pitch
          focusPlayerId={profile.mode === 'player' ? profile.focus_player_id : undefined}
          heat={focusStats ?? null}
          highContrast={profile.high_contrast}
          dim={profile.mode === 'player'}
        />
        {meta && v && <OverlayLayer overlays={[...v.overlays.values()]} now={now} meta={meta} />}
        <div className="stage-chip">
          <span>{mode.glyph}</span> {mode.label}
          {profile.mode === 'club' && meta && ` · ${meta[profile.favorite_team ?? 'home'].short}`}
          {profile.mode === 'metric' && ` · ${(profile.metric ?? 'ball_speed').replace('_', ' ')}`}
          <b>{lang.label}</b>
        </div>
        {store.status !== 'open' && store.sessionId && (
          <div className="stage-status">
            {store.status === 'connecting' ? 'Connecting to live feed…' : 'Reconnecting…'}
          </div>
        )}
      </div>
      {meta && <Insights profile={profile} state={store.state} meta={meta} />}
    </div>
  );
}
