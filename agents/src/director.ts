import type { Flag, MatchEvent, Moment, MomentKind, Side } from '@matchlight/schema';
import { formatMinute } from '@matchlight/schema';
import type { StatsEngine } from '@matchlight/pipeline';
import type { Blackboard } from './runtime/memory.js';

/** Base significance per moment kind (0..1). */
export const BASE_SIGNIFICANCE: Record<MomentKind, number> = {
  goal: 1,
  red_card: 0.95,
  big_chance: 0.72,
  save: 0.68,
  tactical_shift: 0.66,
  momentum_swing: 0.68,
  pressing_shift: 0.62,
  xg_swing: 0.6,
  period_summary: 0.6,
  player_milestone: 0.5,
  card: 0.42,
  substitution: 0.38,
  chaos_spike: 0.45,
  possession_dominance: 0.44,
  speed_flag: 0.45,
  tempo_change: 0.4,
  difficult_pass: 0.36,
};

/** Minimum stream seconds between two moments on the same topic. */
const TOPIC_COOLDOWN: Partial<Record<MomentKind, number>> = {
  momentum_swing: 420,
  pressing_shift: 600,
  xg_swing: 600,
  speed_flag: 240,
  difficult_pass: 200,
  possession_dominance: 900,
  tempo_change: 600,
  chaos_spike: 600,
  substitution: 30,
};

export const EXPLAIN_THRESHOLD = 0.55;
export const SURFACE_THRESHOLD = 0.3;
/** At most one non-urgent explained moment per this many stream seconds. */
export const EXPLAIN_SPACING = 40;

export interface DirectorDecision {
  moment: Moment;
  explain: boolean;
  /** Why the Director scored it this way (shown in the trace panel). */
  reasons: string[];
}

/**
 * Orchestrator / Director agent: turns raw events + interpreter flags into candidate "moments",
 * scores their significance in context (score state, game time, repetition), applies cooldowns and
 * decides which ones deserve an explanation.
 */
export class DirectorAgent {
  private seq = 0;
  readonly suppressed: { kind: MomentKind; reason: string; ts: number }[] = [];

  constructor(
    private readonly stats: StatsEngine,
    private readonly memory: Blackboard,
  ) {}

  consider(e: MatchEvent | null, flags: Flag[]): DirectorDecision[] {
    const cands: Omit<Moment, 'id' | 'significance' | 'minute_label'>[] = [];
    if (e) cands.push(...this.fromEvent(e));
    for (const f of flags) {
      const c = this.fromFlag(f);
      if (c) cands.push(c);
    }
    const out: DirectorDecision[] = [];
    for (const c of cands) {
      const reasons: string[] = [];
      let sig = BASE_SIGNIFICANCE[c.kind];
      const flag = c.flag_id ? this.stats.flags.find((f) => f.id === c.flag_id) : undefined;
      if (flag?.kind === 'ball_speed') sig = 0.3;
      if (flag?.kind === 'long_pass') sig = 0.32;
      if (flag?.kind === 'distance_milestone') sig = 0.34;
      if (flag?.kind === 'player_milestone' && flag.unit === 'goals') sig = 0.8;
      reasons.push(`base ${flag?.kind ?? c.kind}=${sig}`);
      const minute = this.stats.gameS / 60;
      const diff = Math.abs(this.stats.score.home - this.stats.score.away);
      if (minute >= 75 && diff <= 1 && c.kind !== 'period_summary') {
        sig += 0.08;
        reasons.push('+0.08 late & close');
      }
      if (c.kind === 'goal' && diff <= 1 && minute >= 80) reasons.push('late decisive goal');
      const count = this.memory.kindCounts.get(c.kind) ?? 0;
      if (count >= 3 && sig < 0.9) {
        const pen = Math.min(0.15, 0.03 * (count - 2));
        sig -= pen;
        reasons.push(`-${pen.toFixed(2)} repetition (${count} ${c.kind} already)`);
      }
      const last = this.memory.topicLastTs.get(c.topic);
      const cd = TOPIC_COOLDOWN[c.kind];
      if (cd !== undefined && last !== undefined && c.ts - last < cd) {
        this.suppressed.push({
          kind: c.kind,
          reason: `cooldown ${Math.round(c.ts - last)}s < ${cd}s`,
          ts: c.ts,
        });
        continue;
      }
      sig = Math.max(0, Math.min(1, sig));
      if (sig < SURFACE_THRESHOLD) {
        this.suppressed.push({
          kind: c.kind,
          reason: `significance ${sig.toFixed(2)} below ${SURFACE_THRESHOLD}`,
          ts: c.ts,
        });
        continue;
      }
      const moment: Moment = {
        ...c,
        id: `m${String(this.seq++).padStart(4, '0')}`,
        significance: Math.round(sig * 100) / 100,
        minute_label: formatMinute(this.stats.gameS, this.stats.period),
      };
      const spaced = c.ts - this.memory.lastExplainedTs >= EXPLAIN_SPACING;
      const explain = sig >= EXPLAIN_THRESHOLD && (spaced || sig >= 0.85);
      if (sig >= EXPLAIN_THRESHOLD && !explain) reasons.push(`no explanation: spacing < ${EXPLAIN_SPACING}s`);
      if (explain) this.memory.lastExplainedTs = c.ts;
      this.memory.remember(moment);
      out.push({ moment, explain, reasons });
    }
    return out;
  }

  private fromEvent(e: MatchEvent): Omit<Moment, 'id' | 'significance' | 'minute_label'>[] {
    const base = { ts: e.ts, team: e.team, player_id: e.player_id, event_ids: [e.id] };
    const name = this.stats.playerName(e.player_id);
    switch (e.type) {
      case 'goal': {
        return [
          {
            ...base,
            kind: 'goal',
            event_ids: [e.id, e.shot_event_id],
            headline: `Goal: ${name} (${e.score.home}-${e.score.away})`,
            topic: `goal:${e.id}`,
          },
        ];
      }
      case 'shot': {
        if (e.outcome === 'goal') return [];
        const xg = this.stats.derived.get(e.id)?.xg ?? 0;
        if (xg >= 0.28 || e.outcome === 'woodwork') {
          const kind: MomentKind = e.outcome === 'saved' ? 'save' : 'big_chance';
          return [
            {
              ...base,
              kind,
              headline: `${kind === 'save' ? 'Big save' : 'Big chance'}: ${name} (${xg.toFixed(2)} xG)`,
              topic: `chance:${e.id}`,
            },
          ];
        }
        return [];
      }
      case 'card':
        return [
          {
            ...base,
            kind: e.color === 'yellow' ? 'card' : 'red_card',
            headline: `${e.color === 'yellow' ? 'Yellow' : 'Red'} card: ${name}`,
            topic: `card:${e.id}`,
          },
        ];
      case 'substitution':
        return [
          {
            ...base,
            kind: 'substitution',
            headline: `Sub: ${this.stats.playerName(e.player_in_id)} on for ${name}`,
            topic: `sub:${e.team}:${Math.floor(e.ts / 60)}`,
          },
        ];
      case 'tactical_shift':
        return [
          {
            ...base,
            player_id: undefined,
            kind: 'tactical_shift',
            headline: `${this.stats.teamName(e.team!)}: ${e.formation_from} -> ${e.formation_to}`,
            topic: `shift:${e.id}`,
          },
        ];
      case 'period_end':
        return [
          {
            ...base,
            team: undefined,
            kind: 'period_summary',
            headline: e.period === 1 ? 'Half-time' : 'Full-time',
            topic: `period:${e.period}`,
          },
        ];
      default:
        return [];
    }
  }

  private fromFlag(f: Flag): Omit<Moment, 'id' | 'significance' | 'minute_label'> | null {
    const map: Partial<Record<Flag['kind'], MomentKind>> = {
      top_speed: 'speed_flag',
      shot_speed: 'speed_flag',
      ball_speed: 'speed_flag',
      difficult_pass: 'difficult_pass',
      long_pass: 'difficult_pass',
      ppda_shift: 'pressing_shift',
      momentum_swing: 'momentum_swing',
      xg_swing: 'xg_swing',
      tempo_spike: 'tempo_change',
      chaos_spike: 'chaos_spike',
      possession_dominance: 'possession_dominance',
      player_milestone: 'player_milestone',
      distance_milestone: 'player_milestone',
    };
    const kind = map[f.kind];
    if (!kind) return null;
    const team: Side | undefined = f.team;
    return {
      kind,
      ts: f.ts,
      team,
      player_id: f.player_id,
      event_ids: f.event_ids,
      headline: f.label,
      flag_id: f.id,
      topic: `${kind}:${f.kind === 'ball_speed' || f.kind === 'shot_speed' ? f.kind : (team ?? 'all')}${kind === 'player_milestone' ? `:${f.player_id}:${f.value}` : ''}`,
    };
  }
}
