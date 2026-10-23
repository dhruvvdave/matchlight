import type { Language, ScenarioInfo, TrackedMetric, ViewerMode, ViewerProfile } from '@matchlight/schema';
import { store } from '../lib/store';

export const MODES: { id: ViewerMode; label: string; hint: string; glyph: string }[] = [
  { id: 'analyst', label: 'Analyst', hint: 'xG · xT · PPDA · tactics', glyph: '∑' },
  { id: 'casual', label: 'Casual fan', hint: 'Plain words, big moments', glyph: '♥' },
  { id: 'club', label: 'My club', hint: '“Your team” framing, still honest', glyph: '⚑' },
  { id: 'player', label: 'Player focus', hint: 'Follow one player all match', glyph: '◎' },
  { id: 'metric', label: 'One metric', hint: 'Track a single number', glyph: '#' },
];

export const LANGS: { id: Language; label: string; name: string }[] = [
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'fr', label: 'FR', name: 'Français' },
  { id: 'es', label: 'ES', name: 'Español' },
  { id: 'hi', label: 'हि', name: 'हिन्दी' },
  { id: 'ar', label: 'ع', name: 'العربية' },
];

const METRICS: { id: TrackedMetric; label: string }[] = [
  { id: 'ball_speed', label: 'Ball speed' },
  { id: 'pass_difficulty', label: 'Pass difficulty' },
  { id: 'player_speed', label: 'Player top speed' },
  { id: 'xg', label: 'xG' },
  { id: 'ppda', label: 'PPDA (pressing)' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'tempo', label: 'Tempo' },
];

export function ProfileEditor({
  profile,
  onChange,
  compact,
}: {
  profile: ViewerProfile;
  onChange: (p: ViewerProfile) => void;
  compact?: boolean;
}) {
  const meta = store.meta;
  const onPitch = new Set(store.frame?.players.map((p) => p.id) ?? []);
  const players = meta
    ? [...meta.home.players, ...meta.away.players].filter(
        (p) => onPitch.size === 0 || onPitch.has(p.id) || p.id === profile.focus_player_id,
      )
    : [];
  return (
    <div className={`profile-editor ${compact ? 'compact' : ''}`}>
      <div className="modes" role="radiogroup" aria-label="Viewer mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={profile.mode === m.id}
            className={`mode ${profile.mode === m.id ? 'on' : ''}`}
            onClick={() => onChange({ ...profile, mode: m.id })}
          >
            <span className="mode-glyph">{m.glyph}</span>
            <span className="mode-label">{m.label}</span>
            {!compact && <span className="mode-hint">{m.hint}</span>}
          </button>
        ))}
      </div>
      {profile.mode === 'club' && meta && (
        <div className="opt-row">
          <label>Your club</label>
          <div className="seg">
            {(['home', 'away'] as const).map((s) => (
              <button
                key={s}
                className={(profile.favorite_team ?? 'home') === s ? 'on' : ''}
                onClick={() => onChange({ ...profile, favorite_team: s })}
                style={{ ['--team' as string]: meta[s].colors.primary }}
              >
                {meta[s].name}
              </button>
            ))}
          </div>
        </div>
      )}
      {profile.mode === 'player' && meta && (
        <div className="opt-row">
          <label htmlFor="player-select">Follow</label>
          <select
            id="player-select"
            value={profile.focus_player_id ?? ''}
            onChange={(e) => onChange({ ...profile, focus_player_id: e.target.value })}
          >
            <option value="" disabled>
              Choose a player…
            </option>
            {(['home', 'away'] as const).map((s) => (
              <optgroup key={s} label={meta[s].name}>
                {players
                  .filter((p) => p.side === s)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.number} {p.short_name} · {p.position}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      {profile.mode === 'metric' && (
        <div className="opt-row">
          <label htmlFor="metric-select">Metric</label>
          <select
            id="metric-select"
            value={profile.metric ?? 'ball_speed'}
            onChange={(e) => onChange({ ...profile, metric: e.target.value as TrackedMetric })}
          >
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="opt-row">
        <label>Language</label>
        <div className="seg langs" role="radiogroup" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={profile.language === l.id}
              title={l.name}
              className={profile.language === l.id ? 'on' : ''}
              onClick={() => onChange({ ...profile, language: l.id })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      {!compact && (
        <div className="toggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={profile.tts}
              onChange={(e) => onChange({ ...profile, tts: e.target.checked })}
            />
            <span>Read commentary aloud (TTS)</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={profile.high_contrast}
              onChange={(e) => onChange({ ...profile, high_contrast: e.target.checked })}
            />
            <span>High-contrast overlays</span>
          </label>
        </div>
      )}
    </div>
  );
}

export function ScenarioPicker({
  scenarios,
  current,
  onPick,
  busy,
}: {
  scenarios: ScenarioInfo[];
  current: string | null;
  onPick: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="scenarios">
      <h3>Matches</h3>
      {scenarios.map((s) => (
        <button
          key={s.id}
          className={`scenario ${current === s.id ? 'on' : ''} ${s.id === 'random' ? 'random' : ''}`}
          onClick={() => onPick(s.id)}
          disabled={busy}
        >
          <span className="sc-title">
            {s.id === 'random' ? '⟳ ' : ''}
            {s.title}
          </span>
          <span className="sc-desc">{s.description}</span>
        </button>
      ))}
    </div>
  );
}
