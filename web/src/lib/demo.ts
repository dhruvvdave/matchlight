import type { ViewerProfile } from '@matchlight/schema';

const P = (p: Partial<ViewerProfile> & Pick<ViewerProfile, 'mode' | 'language'>): ViewerProfile => ({
  tts: false,
  high_contrast: false,
  ...p,
});

export interface DemoStep {
  /** Football minute at which the step fires (match clock). */
  at: number;
  caption: string;
  view?: 'broadcast' | 'split';
  main?: ViewerProfile;
  second?: ViewerProfile;
  tab?: 'feed' | 'ask' | 'trace';
  speed?: number;
  ask?: string;
  recap?: boolean;
}

/**
 * Scripted 90-second demo: the seeded comeback from 58' at 20x, switching personas and languages on cue,
 * then 60x to full-time and the automated recap. Deterministic seed => identical every run.
 */
export const DEMO = {
  scenario: 'late-comeback',
  startMinute: 59,
  speed: 20,
  steps: [
    {
      at: 0,
      caption:
        'Live synthetic match · 0–2 down at 59′ · Analyst view: xG, PPDA, momentum, evidence-backed cards',
      view: 'broadcast',
      main: P({ mode: 'analyst', language: 'en' }),
      tab: 'feed',
    },
    {
      at: 61,
      caption: 'Same event stream, different broadcasts → Analyst (EN) vs Casual fan (Español)',
      view: 'split',
      main: P({ mode: 'analyst', language: 'en' }),
      second: P({ mode: 'casual', language: 'es' }),
    },
    {
      at: 64,
      caption: 'Agent trace: Director → Stats → Explainer → Critic → Personalizer → Narrator',
      tab: 'trace',
    },
    {
      at: 68,
      caption: 'Player focus in Hindi (heatmap + running stats) · Club mode in Arabic, right-to-left',
      main: P({ mode: 'player', language: 'hi', focus_player_id: 'hba-11' }),
      second: P({ mode: 'club', language: 'ar', favorite_team: 'home' }),
      tab: 'feed',
    },
    {
      at: 74,
      caption: 'Single-metric mode: only ball speed · French',
      second: P({ mode: 'metric', language: 'fr', metric: 'ball_speed' }),
    },
    {
      at: 78,
      caption: 'Ask the match: answers grounded in the event store',
      view: 'broadcast',
      main: P({ mode: 'analyst', language: 'en' }),
      tab: 'ask',
      ask: 'Why did the momentum change?',
    },
    { at: 82, caption: 'Fast-forward 60× to full-time', speed: 60, tab: 'feed' },
    {
      at: 999,
      caption: 'Recap agent: article, 60-second script, timeline, ratings · export Markdown / JSON / audio',
      recap: true,
    },
  ] as DemoStep[],
};
