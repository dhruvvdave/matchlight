import type { MatchEvent, Moment, MomentKind, TrackedMetric, ViewerProfile } from '@matchlight/schema';
import type { StatsEngine } from '@matchlight/pipeline';
import type { Persona } from './i18n/narrative.js';

export type OverlayIntent =
  | 'key_card' // right-rail key moment card with evidence (analyst) or emotional body (casual)
  | 'hero_card' // big centre card (casual / club goals)
  | 'lower_third'
  | 'player_tag'
  | 'stat_badge'
  | 'pass_map';

export interface ProfilePlan {
  surface: boolean;
  feed: boolean;
  persona: Persona;
  /** Base overlay priority for this profile & moment. */
  priority: number;
  overlays: OverlayIntent[];
  /** Max numbers allowed in a narrative line (Critic-enforced persona constraint). */
  maxNumbers?: number;
  emphasis: 0 | 1 | 2 | 3;
  showEvidence: boolean;
  reason: string;
}

const NONE = (reason: string, persona: Persona = 'casual'): ProfilePlan => ({
  surface: false,
  feed: false,
  persona,
  priority: 0,
  overlays: [],
  emphasis: 0,
  showEvidence: false,
  reason,
});

/** Moment kinds each single-metric mode cares about. */
const METRIC_KINDS: Record<TrackedMetric, MomentKind[]> = {
  ball_speed: ['speed_flag', 'goal'],
  player_speed: ['speed_flag'],
  pass_difficulty: ['difficult_pass'],
  xg: ['goal', 'big_chance', 'save', 'xg_swing'],
  ppda: ['pressing_shift', 'tactical_shift'],
  momentum: ['momentum_swing', 'goal', 'red_card'],
  tempo: ['tempo_change', 'chaos_spike'],
};

/**
 * Personalization agent: profile -> content *selection* and *format*. The same moment yields
 * genuinely different experiences: what is surfaced at all, which overlays, how dense, which framing.
 */
export class PersonalizationAgent {
  constructor(private readonly stats: StatsEngine) {}

  involves(m: Moment, playerId: string | undefined): boolean {
    if (!playerId) return false;
    if (m.player_id === playerId) return true;
    return m.event_ids.some((id) => {
      const e = this.stats.byId.get(id) as
        | (MatchEvent & { assist_id?: string; recipient_id?: string; player_in_id?: string })
        | undefined;
      return (
        !!e &&
        (e.player_id === playerId ||
          e.assist_id === playerId ||
          e.recipient_id === playerId ||
          e.player_in_id === playerId)
      );
    });
  }

  plan(m: Moment, p: ViewerProfile): ProfilePlan {
    const sig = m.significance;
    const big = m.kind === 'goal' || m.kind === 'red_card' || m.kind === 'period_summary';
    switch (p.mode) {
      case 'analyst': {
        if (sig < 0.35) return NONE(`analyst: significance ${sig} < 0.35`, 'analyst');
        const overlays: OverlayIntent[] = ['key_card'];
        if (
          [
            'speed_flag',
            'difficult_pass',
            'pressing_shift',
            'xg_swing',
            'possession_dominance',
            'tempo_change',
            'chaos_spike',
            'big_chance',
            'save',
          ].includes(m.kind)
        )
          overlays.push('stat_badge');
        if (['difficult_pass', 'pressing_shift', 'xg_swing'].includes(m.kind)) overlays.push('pass_map');
        if (m.player_id && ['goal', 'speed_flag', 'difficult_pass', 'big_chance', 'save'].includes(m.kind))
          overlays.push('player_tag');
        if (['card', 'substitution', 'red_card'].includes(m.kind))
          overlays.splice(
            0,
            overlays.length,
            'lower_third',
            ...(m.kind === 'red_card' ? (['key_card'] as OverlayIntent[]) : []),
          );
        return {
          surface: true,
          feed: true,
          persona: 'analyst',
          priority: 40 + sig * 55,
          overlays,
          emphasis: big ? 3 : sig > 0.6 ? 2 : 1,
          showEvidence: true,
          reason: 'analyst: dense tactical coverage',
        };
      }
      case 'casual': {
        const fun = m.kind === 'speed_flag' && sig >= 0.4;
        if (sig < 0.6 && !fun && m.kind !== 'card')
          return NONE(`casual: ${m.kind} too technical / low significance (${sig})`);
        const overlays: OverlayIntent[] = big
          ? ['hero_card', 'lower_third']
          : m.kind === 'card' || m.kind === 'substitution'
            ? ['lower_third']
            : fun
              ? ['player_tag', 'stat_badge']
              : ['key_card'];
        return {
          surface: true,
          feed: true,
          persona: 'casual',
          priority: 45 + sig * 50,
          overlays,
          maxNumbers: 1,
          emphasis: big ? 3 : 1,
          showEvidence: false,
          reason: 'casual: emotion first, minimal numbers',
        };
      }
      case 'club': {
        const fav = p.favorite_team ?? 'home';
        const mine = m.team === fav;
        const theirs = m.team !== undefined && m.team !== fav;
        const adj = sig + (mine ? 0.15 : 0);
        if (adj < 0.5 && !big)
          return NONE(
            `club: not about your team / low significance (${adj.toFixed(2)})`,
            mine ? 'for' : 'against',
          );
        const persona: Persona = mine ? 'for' : theirs ? 'against' : 'casual';
        const overlays: OverlayIntent[] =
          big && mine ? ['hero_card', 'lower_third'] : big ? ['key_card', 'lower_third'] : ['key_card'];
        if (mine && m.player_id && m.kind !== 'substitution') overlays.push('player_tag');
        return {
          surface: true,
          feed: true,
          persona,
          priority: 40 + adj * 55,
          overlays,
          maxNumbers: 2,
          emphasis: big ? 3 : mine ? 2 : 1,
          showEvidence: false,
          reason: mine ? 'club: your team, boosted' : 'club: opponent moment, reported honestly',
        };
      }
      case 'player': {
        const involved = this.involves(m, p.focus_player_id);
        const actor = m.player_id === p.focus_player_id;
        if (!involved && !(big && sig >= 0.9)) return NONE('player focus: player not involved');
        const overlays: OverlayIntent[] = involved ? ['player_tag', 'key_card'] : ['lower_third'];
        if (involved && ['speed_flag', 'difficult_pass'].includes(m.kind)) overlays.push('stat_badge');
        return {
          surface: true,
          feed: true,
          persona: actor ? 'player' : 'casual',
          priority: 50 + sig * 45,
          overlays,
          maxNumbers: 3,
          emphasis: involved ? 2 : 1,
          showEvidence: involved,
          reason: involved ? 'player focus: involved' : 'player focus: major match event',
        };
      }
      case 'metric': {
        const metric = p.metric ?? 'ball_speed';
        const relevant = METRIC_KINDS[metric].includes(m.kind) && this.metricMatches(m, metric);
        if (!relevant && !(m.kind === 'goal'))
          return NONE(`metric mode (${metric}): not relevant`, 'analyst');
        if (!relevant)
          return {
            surface: true,
            feed: true,
            persona: 'casual',
            priority: 50,
            overlays: ['lower_third'],
            maxNumbers: 1,
            emphasis: 1,
            showEvidence: false,
            reason: 'metric mode: goals always shown',
          };
        return {
          surface: true,
          feed: true,
          persona: 'analyst',
          priority: 55 + sig * 40,
          overlays: ['stat_badge'],
          emphasis: 2,
          showEvidence: false,
          reason: `metric mode: ${metric}`,
        };
      }
    }
  }

  private metricMatches(m: Moment, metric: TrackedMetric): boolean {
    if (m.kind !== 'speed_flag') return true;
    const flag = this.stats.flags.find((f) => f.id === m.flag_id);
    if (!flag) return false;
    if (metric === 'player_speed') return flag.kind === 'top_speed';
    if (metric === 'ball_speed') return flag.kind === 'ball_speed' || flag.kind === 'shot_speed';
    return false;
  }
}
