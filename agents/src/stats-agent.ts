import { z } from 'zod';
import type { EventOf, Fact, MatchEvent, Moment, Side } from '@matchlight/schema';
import { formatMinute, otherSide } from '@matchlight/schema';
import type { StatsEngine } from '@matchlight/pipeline';
import { defineTool, type Tool } from './runtime/tools.js';

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Stats / Interpreter agent. Owns the query tools over the live aggregates and turns a moment into
 * a set of atomic, verifiable Facts (each with event ids) that downstream agents must cite.
 */
export class StatsAgent {
  readonly tools: Tool[];
  readonly toolLog: { name: string; args: unknown }[] = [];

  constructor(private readonly s: StatsEngine) {
    const side = z.enum(['home', 'away']);
    this.tools = [
      defineTool({
        name: 'team_window',
        description:
          'Aggregates for one team between two match minutes: passes, accuracy, xG, xT, PPDA, high turnovers, possession %.',
        parameters: z.object({ team: side, from_minute: z.number(), to_minute: z.number() }),
        run: (a) => this.s.teamWindow(a.team, this.tsAtMinute(a.from_minute), this.tsAtMinute(a.to_minute)),
      }),
      defineTool({
        name: 'compare_windows',
        description:
          'Compare a team metric (ppda, xg, possession_pct, pass_accuracy, high_turnovers, shots) between a baseline window and a recent window (minutes).',
        parameters: z.object({
          team: side,
          metric: z.enum(['ppda', 'xg', 'possession_pct', 'pass_accuracy', 'high_turnovers', 'shots']),
          baseline: z.tuple([z.number(), z.number()]),
          recent: z.tuple([z.number(), z.number()]),
        }),
        run: (a) => {
          const b = this.s.teamWindow(a.team, this.tsAtMinute(a.baseline[0]), this.tsAtMinute(a.baseline[1]));
          const r = this.s.teamWindow(a.team, this.tsAtMinute(a.recent[0]), this.tsAtMinute(a.recent[1]));
          return { metric: a.metric, baseline: b[a.metric], recent: r[a.metric] };
        },
      }),
      defineTool({
        name: 'recent_events',
        description:
          'Recent events, optionally filtered by type and team. Returns id, minute, type, team, player.',
        parameters: z.object({
          types: z.array(z.string()).optional(),
          team: side.optional(),
          limit: z.number().max(20).default(8),
        }),
        run: (a) =>
          this.s.events
            .filter((e) => (!a.types || a.types.includes(e.type)) && (!a.team || e.team === a.team))
            .slice(-a.limit)
            .map((e) => ({
              id: e.id,
              minute: formatMinute(e.game_s, e.period),
              type: e.type,
              team: e.team,
              player: this.s.playerName(e.player_id),
            })),
      }),
      defineTool({
        name: 'player_snapshot',
        description: 'Live stats for one player (touches, passes, xG, distance, top speed, rating).',
        parameters: z.object({ player_id: z.string() }),
        run: (a) => {
          const p = this.s.playerStats(a.player_id);
          if (!p) return { error: 'unknown player' };
          const { heat: _heat, ...rest } = p;
          return { name: this.s.playerName(a.player_id), ...rest };
        },
      }),
      defineTool({
        name: 'recent_turnovers',
        description:
          'The last N ball wins with the winning team and whether they happened in the final third.',
        parameters: z.object({ n: z.number().max(12).default(6) }),
        run: (a) =>
          this.s.recentTurnovers(a.n).map((t) => ({ id: t.id, won_by: t.wonBy, final_third: t.ax > 70 })),
      }),
    ];
  }

  private tsAtMinute(minute: number): number {
    // Map football minutes to stream time using the events we've seen (handles 1st-half stoppage).
    const target = minute * 60;
    let best = 0;
    for (const e of this.s.events) {
      if (e.game_s <= target && ((minute <= 45 && e.period === 1) || (minute > 45 && e.period === 2)))
        best = e.ts;
    }
    if (minute > 45 && best === 0) return this.s.ts;
    return best;
  }

  call<T = unknown>(name: string, args: unknown): T {
    const tool = this.tools.find((t) => t.name === name)!;
    this.toolLog.push({ name, args });
    return tool.run(tool.parameters.parse(args)) as T;
  }

  /** Deterministic fact recipes per moment kind. */
  gather(m: Moment): Fact[] {
    this.toolLog.length = 0;
    const F = new FactSet(m.id);
    const s = this.s;
    const ev = (id?: string) => (id ? s.byId.get(id) : undefined);
    const team = m.team;
    const tname = (t: Side) => (t === 'home' ? s.meta.home.short : s.meta.away.short);
    const name = (id?: string) => s.playerName(id);
    const scoreFact = () =>
      F.add(
        'Score',
        `${s.score.home}-${s.score.away}`,
        [],
        `Score: ${tname('home')} ${s.score.home}-${s.score.away} ${tname('away')}`,
        'score',
        {
          home: tname('home'),
          away: tname('away'),
          hs: s.score.home,
          as: s.score.away,
        },
      );
    const mins = s.gameS / 60;
    const recentWin = (t: Side, w = 10) =>
      this.call<ReturnType<StatsEngine['teamWindow']>>('team_window', {
        team: t,
        from_minute: Math.max(0, mins - w),
        to_minute: mins + 1,
      });

    switch (m.kind) {
      case 'goal': {
        const goal = ev(m.event_ids[0]) as EventOf<'goal'> | undefined;
        const shot = ev(goal?.shot_event_id) as EventOf<'shot'> | undefined;
        scoreFact();
        if (shot) {
          const xg = s.derived.get(shot.id)?.xg ?? 0;
          F.add(
            'Shot xG',
            r2(xg),
            [shot.id],
            `Chance quality ${xg.toFixed(2)} xG (${shot.body_part.replace('_', ' ')}, ${shot.situation.replace('_', ' ')})`,
            'shot_xg',
            { xg: r2(xg) },
            { unit: 'xG' },
          );
          if (shot.assist_id)
            F.add(
              'Assist',
              name(shot.assist_id),
              [shot.id],
              `Assisted by ${name(shot.assist_id)}`,
              'assist',
              { player: name(shot.assist_id) },
              { player_id: shot.assist_id },
            );
        }
        const T = s.snapshot().teams;
        F.add(
          'xG total',
          `${T.home.xg.toFixed(2)}-${T.away.xg.toFixed(2)}`,
          [],
          `xG: ${tname('home')} ${T.home.xg.toFixed(2)} - ${T.away.xg.toFixed(2)} ${tname('away')}`,
          'team_xg',
          {
            home: tname('home'),
            away: tname('away'),
            hx: r2(T.home.xg),
            ax: r2(T.away.xg),
          },
        );
        if (team) {
          const w = recentWin(team, 10);
          if (w.shots > 1)
            F.add(
              'Shots last 10',
              w.shots,
              w.event_ids.shots,
              `${tname(team)}: ${w.shots} shots in the last 10 min (${w.xg.toFixed(2)} xG)`,
              'shots_window',
              { team: tname(team), n: w.shots, w: 10, xg: r2(w.xg) },
              { team },
            );
          this.addAfterEvent(F, team, m.ts, 25);
        }
        break;
      }
      case 'big_chance':
      case 'save': {
        const shot = ev(m.event_ids[0]) as EventOf<'shot'> | undefined;
        if (shot) {
          const xg = s.derived.get(shot.id)?.xg ?? 0;
          F.add(
            'Shot xG',
            r2(xg),
            [shot.id],
            `Chance quality ${xg.toFixed(2)} xG (${shot.body_part.replace('_', ' ')}, ${shot.situation.replace('_', ' ')})`,
            'shot_xg',
            { xg: r2(xg) },
            { unit: 'xG' },
          );
          F.add(
            'Outcome',
            shot.outcome,
            [shot.id],
            `Outcome: ${shot.outcome.replace('_', ' ')}`,
            `outcome_${shot.outcome}`,
            {},
          );
          if (shot.goalkeeper_id && shot.outcome === 'saved') {
            const sv = s.saves(shot.goalkeeper_id);
            F.add(
              'Saves',
              sv,
              [shot.id],
              `${name(shot.goalkeeper_id)}: ${sv} saves so far`,
              'saves',
              { player: name(shot.goalkeeper_id), n: sv },
              { player_id: shot.goalkeeper_id },
            );
          }
        }
        if (team) {
          const T = s.snapshot().teams[team];
          F.add(
            'Shots on target',
            T.shots_on_target,
            [],
            `${tname(team)}: ${T.shots_on_target} shots on target, ${T.xg.toFixed(2)} xG total`,
            'sot',
            { team: tname(team), n: T.shots_on_target, xg: r2(T.xg) },
            { team },
          );
        }
        scoreFact();
        break;
      }
      case 'card':
      case 'red_card': {
        const card = ev(m.event_ids[0]) as EventOf<'card'> | undefined;
        if (team && card) {
          const T = s.snapshot().teams[team];
          if (card.color === 'yellow')
            F.add(
              'Yellow cards',
              T.yellow,
              [card.id],
              `${tname(team)} have ${T.yellow} yellow card${T.yellow === 1 ? '' : 's'}`,
              'yellows',
              { team: tname(team), n: T.yellow },
              { team },
            );
          else {
            F.add(
              'Players on pitch',
              T.players_on_pitch,
              [card.id],
              `${tname(team)} down to ${T.players_on_pitch} players`,
              'down_to',
              { team: tname(team), n: T.players_on_pitch },
              { team },
            );
            const prev = s.events.find(
              (e) => e.type === 'card' && e.player_id === card.player_id && e.id !== card.id,
            );
            if (prev)
              F.add(
                'Earlier booking',
                formatMinute(prev.game_s, prev.period),
                [prev.id],
                `${name(card.player_id)} was already booked at ${formatMinute(prev.game_s, prev.period)}`,
                'earlier_booking',
                { player: name(card.player_id), min: formatMinute(prev.game_s, prev.period) },
                { player_id: card.player_id },
              );
          }
          F.add(
            'Fouls',
            T.fouls,
            [],
            `${tname(team)} fouls: ${T.fouls}`,
            'fouls',
            { team: tname(team), n: T.fouls },
            { team },
          );
        }
        scoreFact();
        break;
      }
      case 'substitution': {
        const sub = ev(m.event_ids[0]) as EventOf<'substitution'> | undefined;
        if (sub && team) {
          const out = s.playerStats(sub.player_id!);
          F.add(
            'Substitution',
            `${name(sub.player_in_id)} for ${name(sub.player_id)}`,
            [sub.id],
            `${name(sub.player_in_id)} replaces ${name(sub.player_id)}`,
            'sub',
            { in: name(sub.player_in_id), out: name(sub.player_id) },
            { team },
          );
          if (out)
            F.add(
              'Outgoing player',
              r1(out.distance_m / 1000),
              [sub.id],
              `${name(sub.player_id)} covered ${(out.distance_m / 1000).toFixed(1)} km, rating ${out.rating.toFixed(1)}`,
              'player_km_rating',
              { player: name(sub.player_id), km: r1(out.distance_m / 1000), rating: out.rating },
              { player_id: sub.player_id },
            );
          const ppda = s.ppdaWindow(team, s.ts - 600, s.ts);
          if (ppda !== null)
            F.add(
              'PPDA (10 min)',
              ppda,
              [],
              `${tname(team)} PPDA over the last 10 min: ${ppda.toFixed(1)}`,
              'ppda_now',
              { team: tname(team), v: ppda },
              { team },
            );
          scoreFact();
        }
        break;
      }
      case 'tactical_shift': {
        const sh = ev(m.event_ids[0]) as EventOf<'tactical_shift'> | undefined;
        if (sh && team) {
          F.add(
            'Formation',
            `${sh.formation_from} -> ${sh.formation_to}`,
            [sh.id],
            `${tname(team)} switch from ${sh.formation_from} to ${sh.formation_to}`,
            'formation',
            { team: tname(team), from: sh.formation_from, to: sh.formation_to },
            { team },
          );
          const pf = Math.round(sh.pressing_from * 100);
          const pt = Math.round(sh.pressing_to * 100);
          F.add(
            'Pressing setting',
            pt,
            [sh.id],
            `Pressing intensity set ${pf}% -> ${pt}%`,
            'press_setting',
            { from: pf, to: pt },
            { previous: pf, delta: pt - pf, team },
          );
          const ppda = s.ppdaWindow(team, s.ts - 600, s.ts);
          if (ppda !== null)
            F.add(
              'PPDA (10 min)',
              ppda,
              [],
              `${tname(team)} PPDA over the last 10 min: ${ppda.toFixed(1)}`,
              'ppda_now',
              { team: tname(team), v: ppda },
              { team },
            );
          scoreFact();
        }
        break;
      }
      case 'momentum_swing':
      case 'pressing_shift':
      case 'xg_swing':
      case 'possession_dominance':
      case 'tempo_change':
      case 'chaos_spike':
      case 'speed_flag':
      case 'difficult_pass':
      case 'player_milestone':
        this.flagFacts(F, m);
        break;
      case 'period_summary': {
        scoreFact();
        const T = s.snapshot().teams;
        F.add(
          'xG total',
          `${T.home.xg.toFixed(2)}-${T.away.xg.toFixed(2)}`,
          [],
          `xG: ${tname('home')} ${T.home.xg.toFixed(2)} - ${T.away.xg.toFixed(2)} ${tname('away')}`,
          'team_xg',
          { home: tname('home'), away: tname('away'), hx: r2(T.home.xg), ax: r2(T.away.xg) },
        );
        F.add(
          'Possession',
          `${Math.round(T.home.possession_pct)}-${Math.round(T.away.possession_pct)}`,
          [],
          `Possession: ${tname('home')} ${Math.round(T.home.possession_pct)}% - ${Math.round(T.away.possession_pct)}% ${tname('away')}`,
          'possession_total',
          {
            home: tname('home'),
            away: tname('away'),
            hp: Math.round(T.home.possession_pct),
            ap: Math.round(T.away.possession_pct),
          },
        );
        F.add(
          'Shots',
          `${T.home.shots}-${T.away.shots}`,
          [],
          `Shots: ${tname('home')} ${T.home.shots} - ${T.away.shots} ${tname('away')}`,
          'shots_total',
          { home: tname('home'), away: tname('away'), hs: T.home.shots, as: T.away.shots },
        );
        break;
      }
    }
    return F.facts;
  }

  /** "Preceded by X at 61'" — the most recent sub / tactical shift / red card for `team` within `windowMin`. */
  private addAfterEvent(F: FactSet, team: Side, ts: number, windowMin: number) {
    const s = this.s;
    const tname = (t: Side) => (t === 'home' ? s.meta.home.short : s.meta.away.short);
    const prior = [...s.events]
      .reverse()
      .find(
        (e) =>
          e.ts < ts &&
          e.ts >= ts - windowMin * 60 &&
          ((e.type === 'tactical_shift' && e.team === team) ||
            (e.type === 'substitution' && e.team === team) ||
            (e.type === 'card' && e.color !== 'yellow' && e.team === otherSide(team))),
      ) as MatchEvent | undefined;
    if (!prior) return;
    const what =
      prior.type === 'tactical_shift'
        ? 'tactical switch'
        : prior.type === 'substitution'
          ? 'substitution'
          : 'opponent red card';
    const min = formatMinute(prior.game_s, prior.period);
    F.add(
      'Preceded by',
      `${what} ${min}`,
      [prior.id],
      `Came after the ${min} ${what} by ${prior.type === 'card' ? tname(otherSide(team)) : tname(team)}`,
      `after_${prior.type}`,
      { min, team: prior.type === 'card' ? tname(otherSide(team)) : tname(team) },
      { team },
    );
  }

  private flagFacts(F: FactSet, m: Moment) {
    const s = this.s;
    const flag = s.flags.find((f) => f.id === m.flag_id);
    if (!flag) return;
    const team = flag.team;
    const tname = (t: Side) => (t === 'home' ? s.meta.home.short : s.meta.away.short);
    const name = (id?: string) => s.playerName(id);
    const mins = s.gameS / 60;
    switch (flag.kind) {
      case 'momentum_swing': {
        const fav = flag.value >= 0 ? 'home' : 'away';
        F.add(
          'Momentum index',
          r1(flag.value),
          flag.event_ids,
          `Momentum index ${Math.round(flag.previous ?? 0)} -> ${Math.round(flag.value)} in 5 min (positive = ${tname('home')})`,
          'momentum_change',
          { from: Math.round(flag.previous ?? 0), to: Math.round(flag.value), home: tname('home'), w: 5 },
          { previous: r1(flag.previous ?? 0), delta: r1(flag.value - (flag.previous ?? 0)), team: fav },
        );
        for (const t of ['home', 'away'] as const) {
          const w = this.call<ReturnType<StatsEngine['teamWindow']>>('team_window', {
            team: t,
            from_minute: Math.max(0, mins - 5),
            to_minute: mins + 1,
          });
          F.add(
            `Shots last 5 (${t})`,
            w.shots,
            w.event_ids.shots,
            `${tname(t)}: ${w.shots} shots in the last 5 min (${w.xg.toFixed(2)} xG)`,
            'shots_window',
            { team: tname(t), n: w.shots, w: 5, xg: r2(w.xg) },
            { team: t },
          );
        }
        this.turnoverFact(F, flag.team ?? fav);
        if (flag.team) this.addAfterEvent(F, flag.team, flag.ts, 15);
        break;
      }
      case 'ppda_shift': {
        const t = team!;
        const harder = flag.value < (flag.previous ?? 0);
        F.add(
          'PPDA',
          flag.value,
          flag.event_ids,
          `${tname(t)} PPDA ${flag.previous?.toFixed(1)} -> ${flag.value.toFixed(1)} (10-min rolling)`,
          'ppda_change',
          { team: tname(t), from: r1(flag.previous ?? 0), to: r1(flag.value), w: 10 },
          { previous: flag.previous, delta: r1(flag.value - (flag.previous ?? 0)), team: t, unit: 'PPDA' },
        );
        if (harder) this.turnoverFact(F, t);
        else {
          const opp = otherSide(t);
          const w = this.call<ReturnType<StatsEngine['teamWindow']>>('team_window', {
            team: opp,
            from_minute: Math.max(0, mins - 10),
            to_minute: mins + 1,
          });
          if (w.pass_accuracy !== null)
            F.add(
              'Opponent pass accuracy',
              w.pass_accuracy,
              [],
              `${tname(opp)} complete ${Math.round(w.pass_accuracy)}% of passes in the last 10 min`,
              'pass_acc_window',
              { team: tname(opp), pct: Math.round(w.pass_accuracy) },
              { team: opp },
            );
        }
        this.addAfterEvent(F, t, flag.ts, 15);
        break;
      }
      case 'xg_swing': {
        const t = team!;
        const cmp = this.call<{ baseline: number; recent: number }>('compare_windows', {
          team: t,
          metric: 'xg',
          baseline: [Math.max(0, mins - 20), Math.max(0, mins - 10)],
          recent: [Math.max(0, mins - 10), mins + 1],
        });
        F.add(
          'xG last 10',
          r2(cmp.recent),
          flag.event_ids,
          `${tname(t)} xG in the last 10 min: ${cmp.recent.toFixed(2)} (previous 10 min: ${cmp.baseline.toFixed(2)})`,
          'xg_window_compare',
          { team: tname(t), now: r2(cmp.recent), prev: r2(cmp.baseline), w: 10 },
          { previous: r2(cmp.baseline), delta: r2(cmp.recent - cmp.baseline), team: t, unit: 'xG' },
        );
        const w = this.call<ReturnType<StatsEngine['teamWindow']>>('team_window', {
          team: t,
          from_minute: Math.max(0, mins - 10),
          to_minute: mins + 1,
        });
        F.add(
          'Shots last 10',
          w.shots,
          w.event_ids.shots,
          `${tname(t)}: ${w.shots} shots in the last 10 min`,
          'shots_window_plain',
          { team: tname(t), n: w.shots, w: 10 },
          { team: t },
        );
        this.addAfterEvent(F, t, flag.ts, 20);
        break;
      }
      case 'possession_dominance': {
        const t = team!;
        F.add(
          'Possession (10 min)',
          Math.round(flag.value),
          flag.event_ids,
          `${tname(t)} have ${Math.round(flag.value)}% possession over the last 10 min`,
          'possession_window',
          { team: tname(t), pct: Math.round(flag.value), w: 10 },
          { team: t, unit: '%' },
        );
        const w = this.call<ReturnType<StatsEngine['teamWindow']>>('team_window', {
          team: t,
          from_minute: Math.max(0, mins - 10),
          to_minute: mins + 1,
        });
        F.add(
          'Passes (10 min)',
          w.passes_completed,
          [],
          `${tname(t)}: ${w.passes_completed} completed passes in that spell`,
          'passes_window',
          { team: tname(t), n: w.passes_completed },
          { team: t },
        );
        break;
      }
      case 'tempo_spike':
        F.add(
          'Tempo',
          r1(flag.value),
          flag.event_ids,
          `Tempo ${flag.value.toFixed(1)} actions/min vs match average ${flag.previous?.toFixed(1)}`,
          'tempo',
          { t: r1(flag.value), avg: r1(flag.previous ?? 0) },
          { previous: flag.previous, delta: r1(flag.value - (flag.previous ?? 0)) },
        );
        F.add('Control index', s.control(), [], `Control index ${Math.round(s.control())}/100`, 'control', {
          c: Math.round(s.control()),
          scale: 100,
        });
        break;
      case 'chaos_spike': {
        F.add(
          'Control index',
          Math.round(flag.value),
          flag.event_ids,
          `Control index down to ${Math.round(flag.value)}/100 (end-to-end)`,
          'control_low',
          { c: Math.round(flag.value), scale: 100, w: 5 },
        );
        const tos = s.recentTurnovers(20).filter((t) => t.ts >= s.ts - 300);
        F.add(
          'Turnovers (5 min)',
          tos.length,
          tos.map((t) => t.id).slice(-5),
          `${tos.length} turnovers in the last 5 min`,
          'turnovers_5',
          { n: tos.length },
        );
        break;
      }
      case 'top_speed': {
        const p = s.playerStats(flag.player_id!);
        F.add(
          'Top speed',
          flag.value,
          flag.event_ids,
          `${name(flag.player_id)} hit ${flag.value.toFixed(1)} km/h (previous match high ${flag.previous?.toFixed(1)})`,
          'top_speed',
          { player: name(flag.player_id), speed: r1(flag.value), prev: r1(flag.previous ?? 0) },
          { player_id: flag.player_id, previous: flag.previous, unit: 'km/h', team },
        );
        if (p)
          F.add(
            'Sprints',
            p.sprints,
            [],
            `${name(flag.player_id)}: ${p.sprints} sprints, ${(p.distance_m / 1000).toFixed(1)} km covered`,
            'sprints_km',
            { player: name(flag.player_id), n: p.sprints, km: r1(p.distance_m / 1000) },
            { player_id: flag.player_id },
          );
        break;
      }
      case 'shot_speed':
      case 'ball_speed': {
        const e = s.byId.get(flag.event_ids[0]);
        F.add(
          flag.kind === 'shot_speed' ? 'Shot speed' : 'Ball speed',
          flag.value,
          flag.event_ids,
          `${flag.kind === 'shot_speed' ? 'Shot' : 'Pass'} by ${name(flag.player_id)} travelled at ${Math.round(flag.value)} km/h`,
          flag.kind,
          { player: name(flag.player_id), speed: Math.round(flag.value) },
          { player_id: flag.player_id, unit: 'km/h', team },
        );
        const T = team ? s.snapshot().teams[team] : undefined;
        if (T && e)
          F.add(
            'Team top ball speed',
            T.top_ball_speed_kmh,
            [],
            `${tname(team!)} fastest ball of the match: ${Math.round(T.top_ball_speed_kmh)} km/h`,
            'team_top_ball',
            { team: tname(team!), speed: Math.round(T.top_ball_speed_kmh) },
            { team },
          );
        break;
      }
      case 'difficult_pass':
      case 'long_pass': {
        const e = s.byId.get(flag.event_ids[0]) as EventOf<'pass'> | undefined;
        if (!e) break;
        const d = s.derived.get(e.id)?.difficulty ?? 0;
        F.add(
          'Pass difficulty',
          r1(d * 10),
          [e.id],
          `Pass difficulty ${(d * 10).toFixed(1)}/10: ${Math.round(e.length_m)} m ${e.pass_kind.replace('_', ' ')} pass${e.under_pressure ? ' under pressure' : ''}`,
          'pass_difficulty',
          { d: r1(d * 10), len: Math.round(e.length_m), kind: e.pass_kind, scale: 10 },
          { player_id: e.player_id, team, unit: '/10' },
        );
        const p = s.playerStats(e.player_id!);
        if (p)
          F.add(
            'Passing',
            `${p.passes_completed}/${p.passes}`,
            [],
            `${name(e.player_id)}: ${p.passes_completed}/${p.passes} passes completed`,
            'player_passes',
            { player: name(e.player_id), c: p.passes_completed, n: p.passes },
            { player_id: e.player_id },
          );
        if (e.recipient_id)
          F.add(
            'Receiver',
            name(e.recipient_id),
            [e.id],
            `Found ${name(e.recipient_id)}`,
            'receiver',
            { player: name(e.recipient_id) },
            { player_id: e.recipient_id },
          );
        break;
      }
      case 'player_milestone':
      case 'distance_milestone': {
        const p = s.playerStats(flag.player_id!);
        F.add(
          'Milestone',
          flag.value,
          flag.event_ids,
          flag.label,
          `milestone_${flag.unit}`,
          { player: name(flag.player_id), n: flag.value },
          { player_id: flag.player_id, unit: flag.unit },
        );
        if (p)
          F.add(
            'Player rating',
            p.rating,
            [],
            `${name(flag.player_id)}: live rating ${p.rating.toFixed(1)}, ${p.touches} touches`,
            'player_rating',
            { player: name(flag.player_id), rating: p.rating, touches: p.touches },
            { player_id: flag.player_id },
          );
        break;
      }
      default:
        F.add(flag.kind, flag.value, flag.event_ids, flag.label, 'generic', { v: flag.value });
    }
  }

  /** "3 of the last 4 turnovers were won in the final third by X". */
  private turnoverFact(F: FactSet, team: Side) {
    const s = this.s;
    const tname = (t: Side) => (t === 'home' ? s.meta.home.short : s.meta.away.short);
    const last = this.call<{ id: string; won_by: Side; final_third: boolean }[]>('recent_turnovers', {
      n: 4,
    });
    if (last.length < 3) return;
    const high = last.filter((t) => t.won_by === team && t.final_third);
    if (high.length === 0) return;
    F.add(
      'High turnovers',
      high.length,
      high.map((t) => t.id),
      `${high.length} of the last ${last.length} turnovers were won by ${tname(team)} in the final third`,
      'high_turnovers',
      { n: high.length, m: last.length, team: tname(team) },
      { team },
    );
  }
}

class FactSet {
  readonly facts: Fact[] = [];
  constructor(private readonly prefix: string) {}
  add(
    label: string,
    value: number | string,
    event_ids: string[],
    text: string,
    tkey: string,
    params: Record<string, string | number>,
    extra: Partial<Pick<Fact, 'unit' | 'previous' | 'delta' | 'team' | 'player_id'>> = {},
  ): Fact {
    const f: Fact = {
      id: `${this.prefix}.f${this.facts.length + 1}`,
      label,
      value,
      event_ids,
      text,
      tkey,
      params,
    };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (f as Record<string, unknown>)[k] = v;
    this.facts.push(f);
    return f;
  }
}
