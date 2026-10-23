import { z } from 'zod';
import type { EventOf, Explanation, Fact, Language, Moment, ViewerProfile } from '@matchlight/schema';
import type { StatsEngine } from '@matchlight/pipeline';
import { firstSentence } from './critic.js';
import { fill, pickTemplate, type NarrKey, type Persona } from './i18n/narrative.js';

export const NARRATOR_STYLE: Record<Persona, string> = {
  analyst:
    'Dense, tactical, precise. Use metrics (xG, PPDA, momentum) and name the mechanism. One or two sentences.',
  casual:
    'Plain English for a casual fan: emotion, energy, a vivid analogy if natural. At most ONE number. No jargon (no xG/PPDA).',
  for: "Speak to a fan of the team involved: 'we/us/your team' framing, warm and excited, but never misrepresent facts.",
  against:
    "Speak to a fan of the OTHER team: honest about the opponent's moment, supportive tone ('your side need a response').",
  player: 'Follow one player: frame the moment around them, mention their contribution specifically.',
};

export const NARRATOR_SYSTEM = (
  persona: Persona,
) => `You are the Narrator agent for a live football broadcast.
Style: ${NARRATOR_STYLE[persona]}
Use ONLY the claim and evidence provided: do not add numbers, names or events that are not in them.
Return JSON {"text": string} with a single commentary line (max 30 words), in English.`;

/** Which template key a moment maps to (some kinds branch on the underlying data). */
export function narrKey(m: Moment, s: StatsEngine, facts: Fact[]): NarrKey | null {
  const flag = m.flag_id ? s.flags.find((f) => f.id === m.flag_id) : undefined;
  switch (m.kind) {
    case 'goal':
      return 'goal';
    case 'big_chance': {
      const e = s.byId.get(m.event_ids[0]) as EventOf<'shot'> | undefined;
      return e?.outcome === 'woodwork' ? 'woodwork' : 'big_chance';
    }
    case 'save':
      return 'save';
    case 'card':
      return 'yellow';
    case 'red_card':
      return 'red';
    case 'substitution':
      return 'sub';
    case 'tactical_shift': {
      const p = facts.find((f) => f.tkey === 'press_setting');
      return p && typeof p.delta === 'number' && p.delta < 0 ? 'shift_down' : 'shift_up';
    }
    case 'momentum_swing':
      return 'momentum';
    case 'pressing_shift':
      return flag && flag.value > (flag.previous ?? 0) ? 'press_down' : 'press_up';
    case 'speed_flag':
      return flag?.kind === 'shot_speed'
        ? 'shot_speed'
        : flag?.kind === 'ball_speed'
          ? 'ball_speed'
          : 'top_speed';
    case 'difficult_pass':
      return 'difficult_pass';
    case 'xg_swing':
      return 'xg_swing';
    case 'possession_dominance':
      return 'possession';
    case 'tempo_change':
      return 'tempo';
    case 'chaos_spike':
      return 'chaos';
    case 'player_milestone':
      if (!flag) return null;
      if (flag.unit === 'goals') return flag.value >= 3 ? 'hattrick' : 'brace';
      if (flag.unit === 'passes') return 'passes50';
      if (flag.unit === 'km') return 'km10';
      return null;
    case 'period_summary':
      return s.status === 'full_time' ? 'full_time' : 'half_time';
  }
}

/** Template placeholders, all sourced from Facts (so template lines are grounded by construction). */
export function templateParams(m: Moment, s: StatsEngine, facts: Fact[]): Record<string, string | number> {
  const p: Record<string, string | number> = {
    min: m.minute_label,
    home: s.meta.home.name,
    away: s.meta.away.name,
    stadium: s.meta.stadium,
    score: `${s.score.home}-${s.score.away}`,
  };
  const flag = m.flag_id ? s.flags.find((f) => f.id === m.flag_id) : undefined;
  const team = m.team ?? flag?.team;
  if (team) p.team = s.teamName(team);
  if (m.player_id) p.player = s.playerName(m.player_id);
  const get = (k: string) => facts.find((f) => f.tkey === k)?.params ?? {};
  Object.assign(p, pick(get('shot_xg'), ['xg']));
  const yel = get('yellows');
  if (yel.n !== undefined) p.n = yel.n;
  const down = get('down_to');
  if (down.n !== undefined) p.n = down.n;
  Object.assign(p, pick(get('sub'), ['in', 'out']));
  const form = get('formation');
  if (form.from) Object.assign(p, { from: form.from, to: form.to });
  const mom = get('momentum_change');
  if (mom.from !== undefined) Object.assign(p, { from: mom.from, to: mom.to });
  const ppda = get('ppda_change');
  if (ppda.from !== undefined) Object.assign(p, { from: ppda.from, to: ppda.to });
  for (const k of ['top_speed', 'shot_speed', 'ball_speed'])
    if (get(k).speed !== undefined) p.speed = get(k).speed;
  Object.assign(p, pick(get('pass_difficulty'), ['d', 'len']));
  const xgw = get('xg_window_compare');
  if (xgw.now !== undefined) p.xg = xgw.now;
  const pw = get('possession_window');
  if (pw.pct !== undefined) p.poss = pw.pct;
  if (get('tempo').t !== undefined) p.tempo = get('tempo').t;
  if (get('control_low').c !== undefined) p.control = get('control_low').c;
  const txg = get('team_xg');
  if (txg.hx !== undefined) Object.assign(p, { hx: txg.hx, ax: txg.ax });
  return p;
}

const pick = (o: Record<string, string | number>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export interface NarrativeLine {
  text: string;
  lang: Language;
  key: NarrKey;
}

/** Narrator agent: persona-conditioned commentary (localised templates offline; LLM when configured). */
export class NarratorAgent {
  constructor(private readonly s: StatsEngine) {}

  personaFor(profile: ViewerProfile, planned: Persona): Persona {
    return planned ?? (profile.mode === 'analyst' || profile.mode === 'metric' ? 'analyst' : 'casual');
  }

  templateLine(
    m: Moment,
    facts: Fact[],
    persona: Persona,
    lang: Language,
    profile?: ViewerProfile,
  ): NarrativeLine | null {
    let key = narrKey(m, this.s, facts);
    if (!key) return null;
    if (key === 'full_time' && persona === 'for' && profile?.favorite_team) {
      const mine = this.s.score[profile.favorite_team];
      const theirs = this.s.score[profile.favorite_team === 'home' ? 'away' : 'home'];
      key = mine > theirs ? 'full_time_win' : mine < theirs ? 'full_time_loss' : 'full_time_draw';
    }
    const picked = pickTemplate(lang, key, persona, hash(m.id));
    if (!picked) return null;
    return {
      text: fill(picked.tpl, templateParams(m, this.s, facts))
        .replace(/\s+/g, ' ')
        .trim(),
      lang: picked.lang,
      key,
    };
  }

  /** LLM request pieces (the caller runs it through the LLM client so it gets traced + time-boxed). */
  llmRequest(m: Moment, x: Explanation, persona: Persona) {
    return {
      system: NARRATOR_SYSTEM(persona),
      user: JSON.stringify({
        minute: m.minute_label,
        team: m.team ? this.s.teamName(m.team) : null,
        player: m.player_id ? this.s.playerName(m.player_id) : null,
        claim: x.claim,
        evidence: x.evidence.map((e) => e.text),
      }),
      schema: z.object({ text: z.string().min(3).max(260) }),
      mock: () => ({ text: mockNarratorBrain(m, x, persona, this.s) }),
    };
  }
}

/** Offline stand-in for the LLM narrator: persona-shaped rephrasing of the grounded explanation. */
export function mockNarratorBrain(m: Moment, x: Explanation, persona: Persona, s: StatsEngine): string {
  const claim = x.claim.replace(/^Why it matters: /, '');
  const first = firstSentence(claim);
  const team = m.team ? s.teamName(m.team) : 'The game';
  switch (persona) {
    case 'analyst':
      return `${m.minute_label} ${claim.charAt(0).toUpperCase()}${claim.slice(1)}`.slice(0, 250);
    case 'casual':
      return stripExtraNumbers(`${team === 'The game' ? '' : `${team}: `}${first}`);
    case 'for':
      return stripExtraNumbers(`Your team: ${first}`);
    case 'against':
      return stripExtraNumbers(`Heads up: ${first}`);
    case 'player':
      return `${m.player_id ? s.playerName(m.player_id) : team} in focus. ${first}`;
  }
}

/** Keep at most one number (casual persona rule). */
function stripExtraNumbers(text: string): string {
  let seen = 0;
  return text
    .replace(/\s*\([^)]*\d[^)]*\)/g, (mm) => (seen++ === 0 ? mm : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
