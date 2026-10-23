import { describe, expect, it } from 'vitest';
import { FeedItem, Overlay, type GroupMessage, type ViewerProfile } from '@matchlight/schema';
import { NARRATIVE, glossaryHits, applyDynamicDictionary } from '@matchlight/agents';
import { runPipeline } from './pipeline-run.js';

const profiles: ViewerProfile[] = [
  { mode: 'analyst', language: 'en', tts: false, high_contrast: false },
  { mode: 'casual', language: 'fr', tts: false, high_contrast: false },
  { mode: 'club', language: 'en', favorite_team: 'away', tts: false, high_contrast: false },
  { mode: 'player', language: 'ar', focus_player_id: 'hba-11', tts: false, high_contrast: false },
  { mode: 'metric', language: 'es', metric: 'ball_speed', tts: false, high_contrast: false },
];

const byKind = <K extends GroupMessage['kind']>(msgs: GroupMessage[], k: K) =>
  msgs.filter((m): m is Extract<GroupMessage, { kind: K }> => m.kind === k);

describe('multi-agent orchestration (seeded comeback, mock LLM)', async () => {
  const { orch, msgs, keys } = await runPipeline('late-comeback', profiles);

  it('every overlay and feed item is schema-valid', () => {
    for (const m of byKind(msgs, 'overlay')) expect(Overlay.safeParse(m.overlay).success).toBe(true);
    for (const m of byKind(msgs, 'feed')) expect(FeedItem.safeParse(m.item).success).toBe(true);
  });

  it('same event stream -> genuinely different outputs per profile', () => {
    const feeds = keys.map((k) => orch.feed(k));
    const [analyst, casual, club, player, metric] = feeds;
    // Analyst sees far more than casual; casual sees only big moments.
    expect(analyst.length).toBeGreaterThan(casual.length * 1.5);
    expect(casual.every((f) => f.lang === 'fr')).toBe(true);
    expect(player.every((f) => f.lang === 'ar' && f.dir === 'rtl')).toBe(true);
    expect(metric.every((f) => f.lang === 'es')).toBe(true);
    // Club mode frames moments for the away fan ("your team" / "your side").
    expect(club.some((f) => /\b(we|us|your team|your side)\b/i.test(f.text))).toBe(true);
    // Player mode follows its player with periodic updates.
    expect(player.filter((f) => f.kind === 'stat' || f.kind === 'recap').length).toBeGreaterThan(5);
    // Overlay kinds differ by profile.
    const kinds = (k: string) =>
      new Set(
        byKind(msgs, 'overlay')
          .filter((m) => m.profile_key === k)
          .map((m) => m.overlay.kind),
      );
    expect(kinds(keys[0]).has('pass_map')).toBe(true);
    expect([...kinds(keys[4])].every((k) => ['stat_badge', 'lower_third'].includes(k))).toBe(true);
    expect(kinds(keys[4]).has('stat_badge')).toBe(true);
    expect(kinds(keys[1]).has('pass_map')).toBe(false);
  });

  it('casual lines respect the one-number persona rule; analyst lines carry metrics', () => {
    const casual = orch.feed(keys[1]).filter((f) => f.kind !== 'system');
    const numbers = (t: string) => (t.replace(/\d+-\d+/g, '').match(/\d+(?:\.\d+)?/g) ?? []).length;
    expect(casual.every((f) => numbers(f.text) <= 1)).toBe(true);
    expect(orch.feed(keys[0]).some((f) => /xG|PPDA/.test(f.text))).toBe(true);
  });

  it('the Critic catches injected hallucinations and the Explainer regenerates', () => {
    const spans = byKind(msgs, 'trace').flatMap((m) => m.spans);
    const rejected = spans.filter((s) => s.agent === 'critic' && s.status === 'rejected');
    expect(rejected.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.agent === 'explainer' && s.op.startsWith('redraft'))).toBe(true);
    // Every published explanation is grounded.
    for (const x of byKind(msgs, 'explanation')) expect(x.explanation.critic.grounded).toBe(true);
  });

  it('all agents appear in the trace', () => {
    const agents = new Set(byKind(msgs, 'trace').flatMap((m) => m.spans.map((s) => s.agent)));
    for (const a of ['director', 'stats', 'explainer', 'critic', 'personalizer', 'recap'])
      expect(agents.has(a as never)).toBe(true);
  });

  it('LLM narratives supersede template lines (async path)', () => {
    const analyst = orch.feed(keys[0]);
    const upgraded = analyst.filter((f) => f.supersedes);
    expect(upgraded.length).toBeGreaterThan(3);
    for (const u of upgraded) expect(analyst.some((f) => f.id === u.supersedes)).toBe(true);
  });

  it('meets the fast-path latency budget (< 1.5 s event -> overlay)', () => {
    const lat = orch.latency();
    expect(lat.fast_path.count).toBeGreaterThan(20);
    expect(lat.fast_path.max).toBeLessThan(1500);
  });

  it('builds a grounded recap with timeline and ratings', () => {
    const recaps = byKind(msgs, 'recap').map((m) => m.recap);
    const en = recaps.find((r) => r.lang === 'en')!;
    expect(en.final_score).toEqual({ home: 3, away: 2 });
    expect(en.headline.toLowerCase()).toContain('comeback');
    expect(en.grounded).toBe(true);
    expect(en.timeline.filter((t) => t.kind === 'goal')).toHaveLength(5);
    expect(en.player_ratings.length).toBeGreaterThan(22);
    expect(recaps.map((r) => r.lang).sort()).toEqual(['ar', 'en', 'es', 'fr']);
  });

  it('answers grounded "ask the match" questions', async () => {
    const p = profiles[0];
    const a1 = await orch.ask('Who is the fastest player?', p);
    expect(a1.intent).toBe('leader:top_speed_kmh');
    expect(a1.grounded).toBe(true);
    const a2 = await orch.ask("What happened at 64'?", p);
    expect(a2.intent).toBe('minute');
    expect(a2.answer).toMatch(/goal/);
    const a3 = await orch.ask('Why did the momentum change?', p);
    expect(a3.intent).toBe('why');
    expect(a3.grounded).toBe(true);
  });
});

describe('localisation assets', () => {
  it('every narrative key has English analyst or casual coverage and other languages fall back safely', () => {
    for (const [key, personas] of Object.entries(NARRATIVE.en))
      expect(Object.keys(personas!).length, key).toBeGreaterThan(0);
    for (const lang of ['fr', 'es', 'hi', 'ar'] as const) {
      expect(Object.keys(NARRATIVE[lang]).length).toBeGreaterThan(25);
    }
  });

  it('glossary pins football terms via Azure Translator dynamic dictionary markup', () => {
    expect(glossaryHits('A nutmeg, then high press and a through ball')).toEqual(
      expect.arrayContaining(['nutmeg', 'high press', 'through ball']),
    );
    expect(applyDynamicDictionary('Brilliant pressing', 'es')).toBe(
      'Brilliant <mstrans:dictionary translation="presión">pressing</mstrans:dictionary>',
    );
  });
});
