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
  view?: 'single' | 'compare';
  main?: ViewerProfile;
  second?: ViewerProfile;
  desk?: 'ask' | 'log' | null;
  speed?: number;
  ask?: string;
  recap?: boolean;
}

/**
 * Scripted 90-second demo: the seeded comeback from 59' at 20x, switching channels and languages on cue,
 * then 60x to full-time and the automated recap. Deterministic seed, so every run is identical.
 */
export const DEMO = {
  scenario: 'late-comeback',
  startMinute: 59,
  speed: 20,
  steps: [
    {
      at: 0,
      caption:
        'Harbourside are two goals down on the hour. The analyst channel draws the press and the passes on the pitch.',
      view: 'single',
      main: P({ mode: 'analyst', language: 'en' }),
      desk: null,
    },
    {
      at: 61,
      caption: 'Same match, two channels: the analyst in English and a fan in Spanish.',
      view: 'compare',
      main: P({ mode: 'analyst', language: 'en' }),
      second: P({ mode: 'casual', language: 'es' }),
    },
    {
      at: 64,
      caption: 'The agent log explains each step in plain words, including the claims the Critic throws out.',
      desk: 'log',
    },
    {
      at: 68,
      caption:
        'Follow one player in Hindi, or watch as a home fan in Arabic with the layout running right to left.',
      main: P({ mode: 'player', language: 'hi', focus_player_id: 'hba-11' }),
      second: P({ mode: 'club', language: 'ar', favorite_team: 'home' }),
      desk: null,
    },
    {
      at: 74,
      caption: 'The one-number channel tracks only ball speed, here in French.',
      second: P({ mode: 'metric', language: 'fr', metric: 'ball_speed' }),
    },
    {
      at: 78,
      caption: 'Ask the match a question. The answer comes from the event data and gets checked.',
      view: 'single',
      main: P({ mode: 'analyst', language: 'en' }),
      desk: 'ask',
      ask: 'Why did the momentum change?',
    },
    { at: 82, caption: 'Fast forward to full-time at sixty times speed.', speed: 60, desk: null },
    {
      at: 999,
      caption: 'The recap agent writes the report, a sixty-second script and the player ratings.',
      recap: true,
    },
  ] as DemoStep[],
};
