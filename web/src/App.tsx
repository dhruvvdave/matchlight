import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScenarioInfo, ViewerMode, ViewerProfile } from '@matchlight/schema';
import { normaliseProfile, profileKey } from '@matchlight/schema';
import { api, type ServerConfig } from './lib/api';
import { DEMO } from './lib/demo';
import { isRtl, t } from './lib/i18n';
import { store, useStore } from './lib/store';
import { configureTts, speak, stopSpeaking } from './lib/tts';
import { Ask } from './components/Ask';
import { Channel } from './components/Channels';
import { RecapModal } from './components/Recap';
import { CHANNELS, Scoreboard } from './components/Scoreboard';
import { LanguageSelect, Settings } from './components/Settings';
import { Timeline } from './components/Timeline';
import { Trace } from './components/Trace';

let booted = false;
const DEFAULT_PROFILE: ViewerProfile = { mode: 'analyst', language: 'en', tts: false, high_contrast: false };
const loadProfile = (): ViewerProfile => {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem('ml.profile') ?? '{}') };
  } catch {
    return DEFAULT_PROFILE;
  }
};

type Desk = 'ask' | 'log' | 'settings' | null;

export function App() {
  const s = useStore();
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenario, setScenario] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [main, setMain] = useState<ViewerProfile>(loadProfile);
  const [second, setSecond] = useState<ViewerProfile>({
    mode: 'casual',
    language: 'es',
    tts: false,
    high_contrast: false,
  });
  const [view, setView] = useState<'single' | 'compare'>('single');
  const [desk, setDesk] = useState<Desk>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [demo, setDemo] = useState<{ step: number; caption: string } | null>(null);
  const [kickoff, setKickoff] = useState(true);
  const lang = main.language;

  useEffect(() => {
    localStorage.setItem('ml.profile', JSON.stringify(main));
  }, [main]);
  useEffect(() => {
    const id = setTimeout(() => setKickoff(false), 2600);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }, [lang]);

  const start = useCallback(async (id: string, opts: { speed?: number; start_minute?: number } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSession({
        scenario: id,
        speed: opts.speed ?? 10,
        autoplay: true,
        start_minute: opts.start_minute ?? (id === 'random' ? 0 : 20),
      });
      setScenario(id);
      await store.connect(r.session_id, r.meta, r.clock);
    } catch (e) {
      setError(t(main.language, 'start_failed', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app opens inside a match already in progress.
  useEffect(() => {
    if (booted) return;
    booted = true;
    (async () => {
      try {
        const [c, sc] = await Promise.all([api.config(), api.scenarios()]);
        setCfg(c);
        configureTts(c.tts.startsWith('Azure'));
        setScenarios(sc);
        if (new URLSearchParams(location.search).get('demo') === '1') startDemoRef.current();
        else await start('late-comeback');
      } catch {
        setError(t(main.language, 'api_down'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useEffect(() => {
    store.onFeed = (key, item) => {
      if (!main.tts || key !== profileKey(normaliseProfile(main))) return;
      if (item.emphasis >= 2 || item.supersedes) speak(item.text, item.lang);
    };
    if (!main.tts) stopSpeaking();
  }, [main]);

  // Demo mode.
  const startDemo = useCallback(async () => {
    stopSpeaking();
    setRecapOpen(false);
    const first = DEMO.steps[0];
    setView(first.view ?? 'single');
    if (first.main) setMain(first.main);
    setDesk(null);
    setDemo({ step: 1, caption: first.caption });
    await start(DEMO.scenario, { speed: DEMO.speed, start_minute: DEMO.startMinute });
  }, [start]);
  const startDemoRef = useRef(startDemo);
  startDemoRef.current = startDemo;

  useEffect(() => {
    if (!demo || !s.state) return;
    const step = DEMO.steps[demo.step];
    if (!step) return;
    const minute = s.state.game_s / 60;
    const due = step.recap ? s.state.status === 'full_time' : minute >= step.at && s.state.status !== 'pre';
    if (!due) return;
    if (step.view) setView(step.view);
    if (step.main) setMain(step.main);
    if (step.second) setSecond(step.second);
    if (step.desk !== undefined) setDesk(step.desk);
    if (step.speed) void store.control('speed', step.speed);
    if (step.ask) void store.ask(step.ask, step.main ?? main);
    if (step.recap) setRecapOpen(true);
    setDemo({ step: demo.step + 1, caption: step.caption });
  }, [s.version, demo, main, s.state]);

  const setMode = (p: ViewerProfile, set: (p: ViewerProfile) => void) => (mode: ViewerMode) => {
    const next = { ...p, mode };
    if (mode === 'player' && !next.focus_player_id && s.meta)
      next.focus_player_id = s.meta.home.players.find((x) => x.position === 'ST' && x.starter)?.id;
    set(next);
  };
  const mainViewer = s.viewers.get(profileKey(normaliseProfile(main)));
  const toggle = (d: Desk) => setDesk(desk === d ? null : d);

  return (
    <div className={`app ${kickoff ? 'is-kickoff' : ''} ${main.high_contrast ? 'is-hc' : ''}`}>
      <a className="skip" href="#channel">
        {t(lang, 'commentary')}
      </a>
      <header className="top">
        <Scoreboard lang={lang} mode={main.mode} onMode={setMode(main, setMain)} />
        <LanguageSelect id="lang-main" value={lang} onChange={(l) => setMain({ ...main, language: l })} />
      </header>

      <main id="channel" className={view === 'compare' ? 'stage is-compare' : 'stage'}>
        {view === 'single' ? (
          <Channel profile={main} />
        ) : (
          [
            { p: main, set: setMain, id: 'a' },
            { p: second, set: setSecond, id: 'b' },
          ].map((x) => (
            <div className="pane" key={x.id} lang={x.p.language} dir={isRtl(x.p.language) ? 'rtl' : 'ltr'}>
              <div className="pane-tune">
                <nav className="channels channels-small" aria-label={t(x.p.language, 'channels')}>
                  {CHANNELS.map((c) => (
                    <button
                      key={c.mode}
                      aria-pressed={x.p.mode === c.mode}
                      onClick={() => setMode(x.p, x.set)(c.mode)}
                    >
                      {t(x.p.language, c.key)}
                    </button>
                  ))}
                </nav>
                <LanguageSelect
                  id={`lang-${x.id}`}
                  value={x.p.language}
                  onChange={(l) => x.set({ ...x.p, language: l })}
                />
              </div>
              <Channel profile={x.p} compact />
            </div>
          ))
        )}
      </main>

      {desk && (
        <aside
          className="desk"
          aria-label={t(lang, desk === 'ask' ? 'ask_tab' : desk === 'log' ? 'log_tab' : 'settings')}
        >
          <header className="desk-head">
            <h2>{t(lang, desk === 'ask' ? 'ask_tab' : desk === 'log' ? 'log_tab' : 'settings')}</h2>
            <button className="btn" onClick={() => setDesk(null)}>
              {t(lang, 'close')}
            </button>
          </header>
          {desk === 'ask' && <Ask profile={main} answers={mainViewer?.answers ?? []} />}
          {desk === 'log' && <Trace lang={lang} />}
          {desk === 'settings' && (
            <Settings
              profile={main}
              onChange={setMain}
              scenarios={scenarios}
              current={scenario}
              onPick={(id) => void start(id)}
              busy={busy}
            />
          )}
        </aside>
      )}

      <footer className="gallery">
        <Timeline lang={lang} />
        <div className="controls">
          <button
            className="btn"
            aria-pressed={view === 'compare'}
            onClick={() => setView(view === 'compare' ? 'single' : 'compare')}
          >
            {t(lang, view === 'compare' ? 'single' : 'compare')}
          </button>
          <button className="btn" aria-pressed={desk === 'ask'} onClick={() => toggle('ask')}>
            {t(lang, 'ask_tab')}
          </button>
          <button className="btn" aria-pressed={desk === 'log'} onClick={() => toggle('log')}>
            {t(lang, 'log_tab')}
          </button>
          <button className="btn" aria-pressed={desk === 'settings'} onClick={() => toggle('settings')}>
            {t(lang, 'settings')}
          </button>
          <button className="btn" onClick={() => setRecapOpen(true)} disabled={!s.meta}>
            {t(lang, 'open_recap')}
          </button>
          <button className="btn btn-primary" onClick={() => (demo ? setDemo(null) : void startDemo())}>
            {t(lang, demo ? 'stop_demo' : 'start_demo')}
          </button>
        </div>
      </footer>

      {demo && (
        <p className="caption" role="status" lang="en" dir="ltr">
          {demo.caption}
        </p>
      )}
      {(error || s.error) && (
        <div className="notice" role="alert">
          <p>{error ?? s.error}</p>
          <button
            className="btn"
            onClick={() => {
              setError(null);
              s.error = null;
            }}
          >
            {t(lang, 'dismiss')}
          </button>
        </div>
      )}
      {busy && <p className="notice notice-quiet">{t(lang, 'loading_match')}</p>}
      {recapOpen && s.sessionId && (
        <RecapModal
          lang={lang}
          onClose={() => setRecapOpen(false)}
          ttsAzure={!!cfg?.tts.startsWith('Azure')}
        />
      )}
    </div>
  );
}
