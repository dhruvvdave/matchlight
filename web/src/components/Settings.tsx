import type { Language, ScenarioInfo, TrackedMetric, ViewerProfile } from '@matchlight/schema';
import { t } from '../lib/i18n';
import { store } from '../lib/store';

export const LANGS: { id: Language; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'hi', name: 'हिन्दी' },
  { id: 'ar', name: 'العربية' },
];

const METRICS: TrackedMetric[] = [
  'ball_speed',
  'pass_difficulty',
  'player_speed',
  'xg',
  'ppda',
  'momentum',
  'tempo',
];

export function LanguageSelect({
  value,
  onChange,
  id,
}: {
  value: Language;
  onChange: (l: Language) => void;
  id: string;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {t(value, 'language')}
      </label>
      <select id={id} className="lang" value={value} onChange={(e) => onChange(e.target.value as Language)}>
        {LANGS.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </>
  );
}

/** Per-channel options that only make sense for some modes, plus viewing preferences and the match list. */
export function Settings({
  profile,
  onChange,
  scenarios,
  current,
  onPick,
  busy,
}: {
  profile: ViewerProfile;
  onChange: (p: ViewerProfile) => void;
  scenarios: ScenarioInfo[];
  current: string | null;
  onPick: (id: string) => void;
  busy: boolean;
}) {
  const lang = profile.language;
  const meta = store.meta;
  const onPitch = new Set(store.frame?.players.map((p) => p.id) ?? []);
  return (
    <div className="settings">
      {meta && (
        <fieldset>
          <legend>{t(lang, 'your_club')}</legend>
          {(['home', 'away'] as const).map((s) => (
            <label key={s} className="choice">
              <input
                type="radio"
                name="club"
                checked={(profile.favorite_team ?? 'home') === s}
                onChange={() => onChange({ ...profile, favorite_team: s })}
              />
              {meta[s].name}
            </label>
          ))}
        </fieldset>
      )}
      {meta && (
        <p className="field">
          <label htmlFor="follow">{t(lang, 'follow')}</label>
          <select
            id="follow"
            value={profile.focus_player_id ?? ''}
            onChange={(e) => onChange({ ...profile, focus_player_id: e.target.value, mode: 'player' })}
          >
            <option value="" disabled>
              {t(lang, 'pick_player')}
            </option>
            {(['home', 'away'] as const).map((s) => (
              <optgroup key={s} label={meta[s].name}>
                {meta[s].players
                  .filter((p) => onPitch.size === 0 || onPitch.has(p.id) || p.id === profile.focus_player_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number} {p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </p>
      )}
      <p className="field">
        <label htmlFor="metric">{t(lang, 'metric')}</label>
        <select
          id="metric"
          value={profile.metric ?? 'ball_speed'}
          onChange={(e) => onChange({ ...profile, metric: e.target.value as TrackedMetric, mode: 'metric' })}
        >
          {METRICS.map((m) => (
            <option key={m} value={m}>
              {t(lang, `metric_${m}` as 'metric_xg')}
            </option>
          ))}
        </select>
      </p>
      <label className="choice">
        <input
          type="checkbox"
          checked={profile.tts}
          onChange={(e) => onChange({ ...profile, tts: e.target.checked })}
        />
        {t(lang, 'read_aloud')}
      </label>
      <label className="choice">
        <input
          type="checkbox"
          checked={profile.high_contrast}
          onChange={(e) => onChange({ ...profile, high_contrast: e.target.checked })}
        />
        {t(lang, 'high_contrast')}
      </label>
      <fieldset className="matches">
        <legend>{t(lang, 'matches')}</legend>
        {scenarios.map((s) => (
          <button
            key={s.id}
            className={current === s.id ? 'match is-current' : 'match'}
            onClick={() => onPick(s.id)}
            disabled={busy}
            lang="en"
            dir="ltr"
          >
            <span className="match-title">{s.id === 'random' ? t(lang, 'new_match') : s.title}</span>
            {s.id !== 'random' && <span className="match-desc">{s.description}</span>}
          </button>
        ))}
      </fieldset>
      <p className="fineprint">{t(lang, 'synthetic')}</p>
    </div>
  );
}
