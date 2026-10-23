import type {
  EventOf,
  Fact,
  Language,
  Moment,
  Overlay,
  OverlayOf,
  Side,
  TrackedMetric,
  ViewerProfile,
} from '@matchlight/schema';
import { languageDir } from '@matchlight/schema';
import { OverlayBuilder, label, type LabelKey, type StatsEngine } from '@matchlight/pipeline';
import { factText } from './i18n/facts.js';
import type { OverlayIntent, ProfilePlan } from './personalizer.js';

const ICON: Partial<Record<Moment['kind'], OverlayOf<'key_moment_card'>['content']['icon']>> = {
  goal: 'goal',
  big_chance: 'chance',
  save: 'save',
  card: 'card',
  red_card: 'card',
  substitution: 'sub',
  tactical_shift: 'tactic',
  momentum_swing: 'momentum',
  pressing_shift: 'tactic',
  speed_flag: 'speed',
  difficult_pass: 'pass',
  xg_swing: 'chance',
  player_milestone: 'info',
  period_summary: 'info',
};

const TITLE: Partial<Record<Moment['kind'], LabelKey>> = {
  goal: 'goal',
  big_chance: 'big_chance',
  save: 'save',
  card: 'yellow_card',
  red_card: 'red_card',
  substitution: 'substitution',
  tactical_shift: 'tactical_change',
  momentum_swing: 'momentum_swing',
  pressing_shift: 'pressing',
  speed_flag: 'top_speed',
  difficult_pass: 'pass_difficulty',
  xg_swing: 'xg',
  possession_dominance: 'possession',
  tempo_change: 'tempo',
  player_milestone: 'milestone',
};

/** Base on-screen durations (wall seconds at 1x); scaled to stream seconds by the orchestrator. */
export const BASE_DURATION: Record<OverlayIntent, number> = {
  key_card: 9,
  hero_card: 6,
  lower_third: 6,
  player_tag: 5,
  stat_badge: 6,
  pass_map: 9,
};

export interface RenderInput {
  moment: Moment;
  plan: ProfilePlan;
  facts: Fact[];
  line: string;
  confidence?: number;
  explanationId?: string;
  profile: ViewerProfile;
  /** Stream seconds per wall second of display (>= 1 when replaying faster than real time). */
  timeScale: number;
}

/** Renderer agent: plan + content -> schema-valid overlays via the pipeline's OverlayBuilder. */
export class RendererAgent {
  constructor(private readonly s: StatsEngine) {}

  private evIds(m: Moment, facts: Fact[]) {
    return [...new Set([...m.event_ids, ...facts.flatMap((f) => f.event_ids)])].slice(0, 12);
  }

  render(b: OverlayBuilder, r: RenderInput): Overlay[] {
    const { moment: m, plan, facts, profile } = r;
    const lang = profile.language;
    const out: Overlay[] = [];
    const ids = this.evIds(m, facts);
    const ts = m.ts;
    const dur = (i: OverlayIntent) => Math.round(BASE_DURATION[i] * r.timeScale * 10) / 10;
    const titleKey = TITLE[m.kind] ?? 'key_moment';
    const flag = m.flag_id ? this.s.flags.find((f) => f.id === m.flag_id) : undefined;
    const name = m.player_id ? this.s.playerName(m.player_id) : undefined;
    const team: Side | undefined = m.team ?? flag?.team;
    for (const intent of plan.overlays) {
      const common = {
        start_ts: ts,
        duration: dur(intent),
        priority:
          plan.priority +
          (intent === 'hero_card' ? 10 : intent === 'key_card' ? 5 : intent === 'player_tag' ? -15 : 0),
        source_event_ids: ids,
        explanation_id: r.explanationId,
        aria_label: `${label(lang, titleKey)} ${m.minute_label}: ${r.line}`,
      };
      switch (intent) {
        case 'key_card':
        case 'hero_card': {
          const evidence = plan.showEvidence ? facts.slice(0, 3).map((f) => factText(f, lang)) : [];
          out.push(
            b.keyMomentCard(
              { ...common, debounce_key: `card:${m.topic}` },
              {
                title: `${label(lang, titleKey)} · ${m.minute_label}`,
                body: r.line,
                evidence,
                confidence: plan.showEvidence ? r.confidence : undefined,
                icon: ICON[m.kind] ?? 'info',
                team,
              },
              intent === 'hero_card' ? 'center' : 'right_rail',
            ),
          );
          break;
        }
        case 'lower_third': {
          const sub = m.event_ids.map((id) => this.s.byId.get(id)).find((e) => e?.type === 'substitution') as
            | EventOf<'substitution'>
            | undefined;
          const title =
            m.kind === 'substitution' && sub
              ? `${label(lang, 'on')}: ${this.s.playerName(sub.player_in_id)} · ${label(lang, 'off')}: ${this.s.playerName(sub.player_id)}`
              : `${label(lang, titleKey)}${name ? ` · ${name}` : ''}`;
          out.push(
            b.lowerThird(
              { ...common, debounce_key: `lt:${m.topic}` },
              {
                title,
                subtitle: `${team ? this.s.teamName(team) : `${this.s.meta.home.short} ${this.s.score.home}-${this.s.score.away} ${this.s.meta.away.short}`} · ${m.minute_label}`,
                team,
              },
            ),
          );
          break;
        }
        case 'player_tag': {
          if (!m.player_id || !team) break;
          const pl = this.s.player(m.player_id);
          const ev = this.s.byId.get(m.event_ids[0]);
          const badge = this.badgeValue(m, facts, lang);
          out.push(
            b.playerTag(
              { ...common, debounce_key: `tag:${m.player_id}` },
              {
                player_id: m.player_id,
                name: name!,
                number: pl?.number ?? 0,
                team: pl?.side ?? team,
                label: badge?.label,
                value: badge?.display,
              },
              ev?.x !== undefined && ev.y !== undefined ? { x: ev.x, y: ev.y } : undefined,
            ),
          );
          break;
        }
        case 'stat_badge': {
          const badge = this.badgeValue(m, facts, lang);
          if (!badge) break;
          const key = profile.mode === 'metric' ? 'persist:metric' : `badge:${badge.metric}`;
          out.push(b.statBadge({ ...common, debounce_key: key }, { ...badge, team, player_id: m.player_id }));
          break;
        }
        case 'pass_map': {
          if (!team) break;
          const pm = this.passMap(m, team, lang);
          if (pm.passes.length) out.push(b.passMap({ ...common, debounce_key: `passmap:${team}` }, pm));
          break;
        }
      }
    }
    return out;
  }

  badgeValue(
    m: Moment,
    facts: Fact[],
    lang: Language,
  ): Omit<OverlayOf<'stat_badge'>['content'], 'team' | 'player_id'> | null {
    const f = (k: string) => facts.find((x) => x.tkey === k);
    const flag = m.flag_id ? this.s.flags.find((x) => x.id === m.flag_id) : undefined;
    const num = (v: number, d = 1) => v.toFixed(d);
    switch (m.kind) {
      case 'speed_flag': {
        if (!flag) return null;
        const metric =
          flag.kind === 'top_speed'
            ? 'player_speed'
            : flag.kind === 'shot_speed'
              ? 'shot_speed'
              : 'ball_speed';
        const lk: LabelKey =
          metric === 'player_speed' ? 'top_speed' : metric === 'shot_speed' ? 'shot_speed' : 'ball_speed';
        return {
          metric,
          label: label(lang, lk),
          value: flag.value,
          display: `${num(flag.value)} km/h`,
          unit: 'km/h',
          trend: 'up',
        };
      }
      case 'difficult_pass': {
        const d = f('pass_difficulty');
        if (!d) return null;
        return {
          metric: 'pass_difficulty',
          label: label(lang, 'pass_difficulty'),
          value: Number(d.value),
          display: `${num(Number(d.value))}/10`,
          unit: '/10',
        };
      }
      case 'pressing_shift': {
        const p = f('ppda_change');
        if (!p) return null;
        const series = this.s
          .getSeries()
          [p.team === 'away' ? 'ppda_away' : 'ppda_home'].slice(-15)
          .map((x) => x.v);
        return {
          metric: 'ppda',
          label: `${label(lang, 'ppda')} (${label(lang, 'last_10')})`,
          value: Number(p.value),
          display: num(Number(p.value)),
          unit: 'PPDA',
          trend: (p.delta ?? 0) < 0 ? 'down' : 'up',
          series,
        };
      }
      case 'xg_swing': {
        const x = f('xg_window_compare');
        if (!x) return null;
        return {
          metric: 'xg',
          label: `${label(lang, 'xg')} (${label(lang, 'last_10')})`,
          value: Number(x.value),
          display: num(Number(x.value), 2),
          unit: 'xG',
          trend: 'up',
        };
      }
      case 'big_chance':
      case 'save':
      case 'goal': {
        const x = f('shot_xg');
        if (!x) return null;
        return {
          metric: 'xg',
          label: label(lang, 'xg'),
          value: Number(x.value),
          display: num(Number(x.value), 2),
          unit: 'xG',
        };
      }
      case 'possession_dominance': {
        const x = f('possession_window');
        if (!x) return null;
        return {
          metric: 'possession',
          label: `${label(lang, 'possession')} (${label(lang, 'last_10')})`,
          value: Number(x.value),
          display: `${x.value}%`,
          unit: '%',
        };
      }
      case 'tempo_change': {
        const x = f('tempo');
        if (!x) return null;
        return {
          metric: 'tempo',
          label: label(lang, 'tempo'),
          value: Number(x.value),
          display: `${x.value}/min`,
          unit: 'actions/min',
          trend: 'up',
        };
      }
      case 'momentum_swing': {
        const x = f('momentum_change');
        if (!x) return null;
        return {
          metric: 'momentum',
          label: label(lang, 'momentum'),
          value: Number(x.value),
          display: String(Math.round(Number(x.value))),
          unit: 'index',
        };
      }
      default:
        return null;
    }
  }

  private passMap(m: Moment, team: Side, lang: Language): OverlayOf<'pass_map'>['content'] {
    const s = this.s;
    const from = m.ts - (m.kind === 'difficult_pass' ? 25 : 300);
    let passes = s.events.filter(
      (e): e is EventOf<'pass'> => e.type === 'pass' && e.ts >= from && e.ts <= m.ts,
    );
    let title = label(lang, 'pass_map');
    if (m.kind === 'pressing_shift') {
      // The press in action: the opponent's passes under it, misplaced ones highlighted.
      passes = passes.filter((p) => p.team !== team);
      title = `${label(lang, 'pressing')} · ${s.teamName(team)}`;
    } else {
      passes = passes.filter((p) => p.team === team);
      if (m.kind === 'xg_swing')
        passes = passes.filter((p) => (team === 'home' ? p.end_x > 70 : p.end_x < 35));
    }
    return {
      title,
      team: m.kind === 'pressing_shift' ? (team === 'home' ? 'away' : 'home') : team,
      player_id: m.kind === 'difficult_pass' ? m.player_id : undefined,
      passes: passes.slice(-16).map((p) => ({
        x: p.x ?? 0,
        y: p.y ?? 0,
        end_x: p.end_x,
        end_y: p.end_y,
        complete: p.outcome === 'complete',
        difficulty: s.derived.get(p.id)?.difficulty ?? 0,
      })),
    };
  }

  /** Persistent momentum bar (updated in place via its debounce key). */
  momentumBar(b: OverlayBuilder, profile: ViewerProfile, ts: number, timeScale: number): Overlay {
    const lang = profile.language;
    const series = this.s
      .getSeries()
      .momentum.slice(-20)
      .map((p) => p.v);
    const v = this.s.momentum();
    const fav = profile.mode === 'club' ? profile.favorite_team : undefined;
    const homeLabel = fav === 'home' ? label(lang, 'your_team') : this.s.meta.home.short;
    const awayLabel = fav === 'away' ? label(lang, 'your_team') : this.s.meta.away.short;
    return b.momentumBar(
      {
        start_ts: ts,
        duration: Math.round(75 * timeScale),
        priority: 20,
        debounce_key: 'persist:momentum',
        source_event_ids: this.s.events.slice(-1).map((e) => e.id),
        aria_label: `${label(lang, 'momentum')}: ${v > 0 ? this.s.meta.home.name : this.s.meta.away.name} ${Math.abs(Math.round(v))}`,
      },
      {
        value: Math.max(-100, Math.min(100, v)),
        home_label: homeLabel,
        away_label: awayLabel,
        home_color: this.s.meta.home.colors.primary,
        away_color: this.s.meta.away.colors.primary,
        series,
      },
    );
  }

  /** Pinned single-metric badge, refreshed on every relevant event. */
  metricBadge(
    b: OverlayBuilder,
    profile: ViewerProfile,
    ts: number,
    timeScale: number,
    eventId?: string,
  ): Overlay | null {
    const metric: TrackedMetric = profile.metric ?? 'ball_speed';
    const lang = profile.language;
    const s = this.s;
    const T = s.snapshot().teams;
    let content: OverlayOf<'stat_badge'>['content'] | null = null;
    const last = eventId ? s.byId.get(eventId) : undefined;
    switch (metric) {
      case 'ball_speed': {
        if (!last || (last.type !== 'pass' && last.type !== 'shot')) return null;
        const series = s.events
          .filter((e) => e.type === 'pass' || e.type === 'shot')
          .slice(-24)
          .map((e) => (e as EventOf<'pass'>).ball_speed_kmh);
        content = {
          metric: 'ball_speed',
          label: label(lang, 'ball_speed'),
          value: last.ball_speed_kmh,
          display: `${Math.round(last.ball_speed_kmh)} km/h`,
          unit: 'km/h',
          team: last.team,
          player_id: last.player_id,
          series,
        };
        break;
      }
      case 'pass_difficulty': {
        if (!last || last.type !== 'pass') return null;
        const d = s.derived.get(last.id)?.difficulty ?? 0;
        const series = s.events
          .filter((e) => e.type === 'pass')
          .slice(-24)
          .map((e) => Math.round((s.derived.get(e.id)?.difficulty ?? 0) * 100) / 10);
        content = {
          metric: 'pass_difficulty',
          label: label(lang, 'pass_difficulty'),
          value: Math.round(d * 100) / 10,
          display: `${(d * 10).toFixed(1)}/10`,
          unit: '/10',
          team: last.team,
          player_id: last.player_id,
          series,
        };
        break;
      }
      case 'player_speed': {
        const top = Math.max(T.home.top_player_speed_kmh, T.away.top_player_speed_kmh);
        content = {
          metric: 'player_speed',
          label: label(lang, 'top_speed'),
          value: top,
          display: `${top.toFixed(1)} km/h`,
          unit: 'km/h',
        };
        break;
      }
      case 'xg':
        content = {
          metric: 'xg',
          label: label(lang, 'xg'),
          value: T.home.xg,
          display: `${T.home.xg.toFixed(2)} - ${T.away.xg.toFixed(2)}`,
          unit: 'xG',
          series: s
            .getSeries()
            .xg_home.slice(-20)
            .map((p) => p.v),
        };
        break;
      case 'ppda': {
        const h = T.home.ppda_10 ?? 0;
        const a = T.away.ppda_10 ?? 0;
        content = {
          metric: 'ppda',
          label: `${label(lang, 'ppda')} (${label(lang, 'last_10')})`,
          value: h,
          display: `${h.toFixed(1)} | ${a.toFixed(1)}`,
          unit: 'PPDA',
          series: s
            .getSeries()
            .ppda_home.slice(-20)
            .map((p) => p.v),
        };
        break;
      }
      case 'momentum': {
        const v = s.momentum();
        content = {
          metric: 'momentum',
          label: label(lang, 'momentum'),
          value: v,
          display: `${v > 0 ? s.meta.home.short : s.meta.away.short} ${Math.abs(Math.round(v))}`,
          unit: 'index',
          series: s
            .getSeries()
            .momentum.slice(-20)
            .map((p) => p.v),
        };
        break;
      }
      case 'tempo': {
        const t = s.tempo();
        content = {
          metric: 'tempo',
          label: label(lang, 'tempo'),
          value: t,
          display: `${t.toFixed(1)}/min`,
          unit: 'actions/min',
          series: s
            .getSeries()
            .tempo.slice(-20)
            .map((p) => p.v),
        };
        break;
      }
    }
    if (!content) return null;
    for (const k of Object.keys(content) as (keyof typeof content)[])
      if (content[k] === undefined) delete content[k];
    return b.statBadge(
      {
        start_ts: ts,
        duration: Math.round(60 * timeScale),
        priority: 30,
        debounce_key: 'persist:metric',
        source_event_ids: eventId ? [eventId] : [],
        aria_label: `${content.label}: ${content.display}`,
      },
      content,
    );
  }

  get dir() {
    return languageDir;
  }
}
