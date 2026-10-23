import { describe, expect, it } from 'vitest';
import type { Fact, Moment } from '@matchlight/schema';
import { CriticAgent, splitSentences } from '@matchlight/agents';
import { sim } from './helpers.js';

const meta = sim('late-comeback', undefined, false).meta;
const critic = new CriticAgent(meta);
const scorer = meta.home.players[9];
const bystander = meta.away.players[4];

const facts: Fact[] = [
  {
    id: 'm1.f1',
    label: 'PPDA',
    value: 6.1,
    previous: 11.2,
    delta: -5.1,
    team: 'home',
    event_ids: ['e00010'],
    text: 'HBA PPDA 11.2 -> 6.1',
    tkey: 'ppda_change',
    params: { team: 'HBA', from: 11.2, to: 6.1, w: 10 },
  },
  {
    id: 'm1.f2',
    label: 'High turnovers',
    value: 3,
    event_ids: ['e00011'],
    text: '3 of the last 4 turnovers were won by HBA in the final third',
    tkey: 'high_turnovers',
    params: { n: 3, m: 4, team: 'HBA' },
  },
  {
    id: 'm1.f3',
    label: 'Preceded by',
    value: "substitution 61'",
    event_ids: ['e00009'],
    text: "Came after the 61' substitution",
    tkey: 'after_substitution',
    params: { min: "61'", team: 'HBA' },
  },
];
const moment: Moment = {
  id: 'm1',
  kind: 'pressing_shift',
  ts: 3800,
  minute_label: "64'",
  team: 'home',
  player_id: scorer.id,
  significance: 0.7,
  event_ids: ['e00012'],
  headline: 'press',
  topic: 'pressing_shift:home',
};
const ctx = {
  facts,
  moment,
  meta,
  allowedPlayers: new Set([scorer.id]),
  knownEventIds: (id: string) => /^e000\d\d$/.test(id),
};

describe('Critic (groundedness)', () => {
  it('accepts a claim whose numbers, names and directions are all backed by facts', () => {
    const v = critic.checkExplanation(
      {
        claim: `Pressure shifted: PPDA dropped 11.2 -> 6.1 after the 61' sub; 3 of the last 4 turnovers were in the final third. ${scorer.short_name} leads the press.`,
        evidence: [
          { fact_id: 'm1.f1', text: 'PPDA 11.2 -> 6.1' },
          { fact_id: 'm1.f2', text: '3 of 4 turnovers high' },
        ],
        confidence: 0.82,
        event_ids: ['e00010', 'e00011'],
      },
      ctx,
    );
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('rejects a fabricated number', () => {
    const v = critic.checkExplanation(
      {
        claim: 'PPDA dropped 11.2 -> 2.7 in ten minutes.',
        evidence: [{ fact_id: 'm1.f1', text: 'x' }],
        confidence: 0.7,
        event_ids: [],
      },
      ctx,
    );
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'unsupported_number' && i.detail.includes('2.7'))).toBe(true);
  });

  it('rejects a player who is not in the evidence', () => {
    const v = critic.checkExplanation(
      {
        claim: `${bystander.short_name} orchestrated the press, PPDA 6.1.`,
        evidence: [{ fact_id: 'm1.f1', text: 'x' }],
        confidence: 0.7,
        event_ids: [],
      },
      ctx,
    );
    expect(v.issues.map((i) => i.code)).toContain('unsupported_entity');
  });

  it('rejects a direction word that contradicts the data', () => {
    const v = critic.checkExplanation(
      {
        claim: 'PPDA rose to 6.1 as the press eased.',
        evidence: [{ fact_id: 'm1.f1', text: 'x' }],
        confidence: 0.7,
        event_ids: [],
      },
      ctx,
    );
    expect(v.issues.map((i) => i.code)).toContain('direction_mismatch');
  });

  it('rejects unknown fact / event citations, schema violations and overconfidence', () => {
    expect(
      critic
        .checkExplanation(
          {
            claim: 'Something happened here.',
            evidence: [{ fact_id: 'nope', text: 'x' }],
            confidence: 0.7,
            event_ids: ['zzz'],
          },
          ctx,
        )
        .issues.map((i) => i.code),
    ).toEqual(expect.arrayContaining(['unknown_fact', 'unknown_event']));
    expect(critic.checkExplanation({ claim: 'short' }, ctx).issues[0].code).toBe('schema');
    expect(
      critic
        .checkExplanation(
          {
            claim: 'PPDA fell to 6.1 here.',
            evidence: [{ fact_id: 'm1.f1', text: 'x' }],
            confidence: 0.99,
            event_ids: [],
          },
          ctx,
        )
        .issues.map((i) => i.code),
    ).toContain('overconfident');
  });

  it('enforces persona number limits and handles RTL / non-Latin digits', () => {
    expect(
      critic
        .checkText('PPDA 6.1 and 3 high turnovers after 61 minutes', ctx, { maxNumbers: 1 })
        .map((i) => i.code),
    ).toContain('too_many_numbers');
    // Arabic-Indic digits normalise to ASCII before checking.
    expect(critic.checkText('الضغط PPDA ٦٫١', ctx)).toEqual([]);
    expect(critic.checkText('PPDA ٩', ctx).map((i) => i.code)).toContain('unsupported_number');
  });

  it('does not split sentences on initials', () => {
    expect(splitSentences('C. Uwakwe scores. It is 0-1.')).toEqual(['C. Uwakwe scores.', 'It is 0-1.']);
  });
});
