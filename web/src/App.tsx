import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScenarioInfo, ViewerProfile } from '@matchlight/schema';
import { normaliseProfile, profileKey } from '@matchlight/schema';
import { api, type ServerConfig } from './lib/api';
import { DEMO } from './lib/demo';
import { store, useStore } from './lib/store';
import { configureTts, speak, stopSpeaking } from './lib/tts';
import { Ask } from './components/Ask';
import { Feed } from './components/Feed';
import { ProfileEditor, ScenarioPicker } from './components/ProfilePanel';
import { RecapModal } from './components/Recap';
import { Timeline } from './components/Timeline';
import { TopBar } from './components/TopBar';
import { Trace } from './components/Trace';
import { Stage } from './components/Viewer';

let booted = false;
const DEFAULT_PROFILE: ViewerProfile = { mode: 'analyst', language: 'en', tts: false, high_contrast: false };
const loadProfile = (): ViewerProfile => {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem('ml.profile') ?? '{}') };
  } catch {
    return DEFAULT_PROFILE;
  }
};

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
  const [view, setView] = useState<'broadcast' | 'split'>('broadcast');
  const [tab, setTab] = useState<'feed' | 'ask' | 'trace'>('feed');
  const [recapOpen, setRecapOpen] = useState(false);
  const [demo, setDemo] = useState<{ step: number; caption: string } | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'none' | 'left' | 'right'>('none');

  useEffect(() => {
    localStorage.setItem('ml.profile', JSON.stringify(main));
  }, [main]);

  const start = useCallback(async (id: string, opts: { speed?: number; start_minute?: number } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createSession({
        scenario: id,
        speed: opts.speed ?? 10,
        autoplay: true,
        start_minute: opts.start_minute,
      });
      setScenario(id);
      await store.connect(r.session_id, r.meta, r.clock);
    } catch (e) {
      setError(`Could not start the match: ${(e as Error).message}. Is the API running (npm run dev)?`);
    } finally {
      setBusy(false);
    }
  }, []);

  // Boot: config, scenarios, and a live match so the screen is never empty.
  useEffect(() => {
    if (booted) return;
    booted = true;
    (async () => {
      try {
        const [c, sc] = await Promise.all([api.config(), api.scenarios()]);
        setCfg(c);
        configureTts(c.tts.startsWith('Azure'));
        setScenarios(sc);
        const auto = new URLSearchParams(location.search).get('demo') === '1';
        if (auto) startDemoRef.current();
        else await start('late-comeback');
      } catch (e) {
        setError(`API unreachable (${(e as Error).message}). Start it with "npm run dev".`);
      }
    })();
  }, [start]);

  // TTS for the main viewer: speak key moments.
  useEffect(() => {
    store.onFeed = (key, item) => {
      if (!main.tts || key !== profileKey(normaliseProfile(main))) return;
      if (item.emphasis >= 2 || item.supersedes) speak(item.text, item.lang);
    };
    if (!main.tts) stopSpeaking();
  }, [main]);

  // ── Demo mode ──
  const startDemo = useCallback(async () => {
    stopSpeaking();
    setRecapOpen(false);
    const first = DEMO.steps[0];
    setView(first.view ?? 'broadcast');
    if (first.main) setMain(first.main);
    setTab(first.tab ?? 'feed');
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
    if (step.tab) setTab(step.tab);
    if (step.speed) void store.control('speed', step.speed);
    if (step.ask) void store.ask(step.ask, step.main ?? main);
    if (step.recap) setRecapOpen(true);
    setDemo({ step: demo.step + 1, caption: step.caption });
  }, [s.version, demo, main, s.state]);

  const mainKey = profileKey(normaliseProfile(main));
  const mainViewer = s.viewers.get(mainKey);
  const secondViewer = s.viewers.get(profileKey(normaliseProfile(second)));
  const ttsAzure = !!cfg?.tts.startsWith('Azure');

  return (
    <div className={`app ${main.high_contrast ? 'hc' : ''}`}>
      <TopBar
        onRecap={() => setRecapOpen(true)}
        onDemo={() => (demo ? setDemo(null) : void startDemo())}
        demoActive={!!demo}
        view={view}
        setView={setView}
      />
      <div className="mobile-tabs">
        <button onClick={() => setMobilePanel(mobilePanel === 'left' ? 'none' : 'left')}>
          Profile & matches
        </button>
        <button onClick={() => setMobilePanel(mobilePanel === 'right' ? 'none' : 'right')}>Commentary</button>
      </div>
      <main className={`layout view-${view} mp-${mobilePanel}`}>
        <aside className="left panel">
          <section>
            <h3>Viewer profile</h3>
            <ProfileEditor profile={main} onChange={setMain} />
          </section>
          <ScenarioPicker
            scenarios={scenarios}
            current={scenario}
            onPick={(id) => void start(id)}
            busy={busy}
          />
          {cfg && (
            <section className="stack">
              <h3>Running on</h3>
              <dl>
                <dt>LLM</dt>
                <dd>{cfg.llm}</dd>
                <dt>Language</dt>
                <dd>{cfg.translator}</dd>
                <dt>Speech</dt>
                <dd>{cfg.tts}</dd>
                <dt>Push</dt>
                <dd>{cfg.transport}</dd>
                <dt>State</dt>
                <dd>{cfg.store}</dd>
              </dl>
            </section>
          )}
        </aside>
        <section className="center">
          {view === 'broadcast' ? (
            <Stage profile={main} />
          ) : (
            <div className="split">
              {[
                { p: main, set: setMain, v: mainViewer },
                { p: second, set: setSecond, v: secondViewer },
              ].map((x, i) => (
                <div className="split-pane" key={i}>
                  <ProfileEditor profile={x.p} onChange={x.set} compact />
                  <Stage profile={x.p} compact />
                  <Feed items={x.v?.feed ?? []} compact label={`Commentary pane ${i + 1}`} />
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="right panel">
          <div className="tabs" role="tablist">
            {(['feed', 'ask', 'trace'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'on' : ''}
                onClick={() => setTab(t)}
              >
                {t === 'feed' ? 'Commentary' : t === 'ask' ? 'Ask the match' : 'Agent trace'}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'feed' && <Feed items={mainViewer?.feed ?? []} label="Live commentary" />}
            {tab === 'ask' && <Ask profile={main} answers={mainViewer?.answers ?? []} />}
            {tab === 'trace' && <Trace />}
          </div>
        </aside>
      </main>
      <Timeline />
      {demo && (
        <div className="demo-caption" role="status">
          <span className="demo-badge">DEMO</span>
          {demo.caption}
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {busy && <div className="toast">Simulating match…</div>}
      {recapOpen && s.sessionId && (
        <RecapModal lang={main.language} onClose={() => setRecapOpen(false)} ttsAzure={ttsAzure} />
      )}
    </div>
  );
}
