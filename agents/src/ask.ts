import { z } from 'zod';
import type { AskAnswer, Fact, Language, Moment, PlayerStats } from '@matchlight/schema';
import { formatMinute, languageDir } from '@matchlight/schema';
import type { StatsEngine } from '@matchlight/pipeline';
import { CriticAgent } from './critic.js';
import type { Blackboard } from './runtime/memory.js';
import type { LlmClient } from './runtime/llm.js';
import type { Tracer } from './runtime/trace.js';
import { defineTool, type Tool } from './runtime/tools.js';
import type { TranslatorAgent } from './translator.js';

type Leader = { metric: keyof PlayerStats | 'saves'; label: string; unit?: string; words: RegExp };
const LEADERS: Leader[] = [
  {
    metric: 'top_speed_kmh',
    label: 'top speed',
    unit: 'km/h',
    words: /fastest|top speed|quickest|speed|vitesse|velocidad|रफ़्तार|سرعة/i,
  },
  {
    metric: 'distance_m',
    label: 'distance covered',
    unit: 'm',
    words: /ran (the )?most|distance|covered|km|work ?rate/i,
  },
  { metric: 'shots', label: 'shots', words: /most shots|shots/i },
  { metric: 'goals', label: 'goals', words: /top scorer|most goals|scored most/i },
  { metric: 'passes_completed', label: 'completed passes', words: /most passes|passes|passing/i },
  { metric: 'tackles', label: 'tackles', words: /tackle/i },
  { metric: 'touches', label: 'touches', words: /touches|on the ball/i },
  { metric: 'key_passes', label: 'key passes', words: /key pass|creat/i },
  {
    metric: 'rating',
    label: 'rating',
    words: /best player|man of the match|player of the match|rating|standout|mvp/i,
  },
  {
    metric: 'hardest_pass',
    label: 'hardest completed pass (difficulty 0-1)',
    words: /hardest pass|difficult pass|best pass/i,
  },
];

export const ASK_SYSTEM = `You answer questions about a live, synthetic football match using ONLY tool results.
Call tools to look things up. Never guess. Keep answers to 1-3 sentences.
Return JSON {"answer": string}. Every number and name in the answer must come from a tool result.`;

/** "Ask the match": grounded Q&A over the event store and live aggregates. */
export class AskAgent {
  readonly tools: Tool[];
  private seq = 0;

  constructor(
    private readonly s: StatsEngine,
    private readonly memory: Blackboard,
    private readonly llm: LlmClient,
    private readonly critic: CriticAgent,
    private readonly translator: TranslatorAgent,
    private readonly tracer: Tracer,
    statsTools: Tool[],
  ) {
    this.tools = [
      ...statsTools,
      defineTool({
        name: 'leaderboard',
        description:
          'Top players for a metric (top_speed_kmh, distance_m, shots, goals, passes_completed, tackles, touches, key_passes, rating, xg).',
        parameters: z.object({ metric: z.string(), n: z.number().max(5).default(3) }),
        run: (a) =>
          this.leaders(a.metric as keyof PlayerStats, a.n).map((p) => ({
            player: this.s.playerName(p.player_id),
            team: this.s.teamName(p.side),
            value: p[a.metric as keyof PlayerStats],
          })),
      }),
      defineTool({
        name: 'events_in_minute',
        description: 'Key events (goals, shots, cards, subs, tactical shifts) in a given match minute range.',
        parameters: z.object({ from_minute: z.number(), to_minute: z.number() }),
        run: (a) => this.eventsBetween(a.from_minute, a.to_minute),
      }),
      defineTool({
        name: 'match_summary',
        description: 'Current score, minute and team totals (xG, possession, shots, PPDA).',
        parameters: z.object({}),
        run: () => {
          const snap = this.s.snapshot();
          return {
            minute: snap.minute_label,
            score: snap.score,
            home: this.s.meta.home.name,
            away: this.s.meta.away.name,
            teams: { home: pickTeam(snap.teams.home), away: pickTeam(snap.teams.away) },
          };
        },
      }),
    ];
  }

  private leaders(metric: keyof PlayerStats | 'saves', n: number): PlayerStats[] {
    const snap = this.s.snapshot();
    const list = Object.values(snap.players).filter((p) => p.minutes > 0 || p.touches > 0);
    const val = (p: PlayerStats) =>
      metric === 'saves' ? this.s.saves(p.player_id) : Number(p[metric as keyof PlayerStats] ?? 0);
    return list.sort((a, b) => val(b) - val(a)).slice(0, n);
  }

  private eventsBetween(from: number, to: number) {
    return this.s.events
      .filter(
        (e) =>
          e.game_s >= (from - 1) * 60 &&
          e.game_s < to * 60 &&
          ['goal', 'shot', 'card', 'substitution', 'tactical_shift', 'save'].includes(e.type),
      )
      .map((e) => ({
        id: e.id,
        minute: formatMinute(e.game_s, e.period),
        type: e.type,
        team: e.team ? this.s.teamName(e.team) : undefined,
        player: e.player_id ? this.s.playerName(e.player_id) : undefined,
        outcome: 'outcome' in e ? e.outcome : 'color' in e ? e.color : undefined,
      }));
  }

  async answer(question: string, lang: Language, traceId: string): Promise<AskAnswer> {
    return this.tracer.span('ask', 'answer', traceId, async (h) => {
      const q = question.trim().slice(0, 300);
      let res = this.rules(q);
      let source: AskAnswer['source'] = 'template';
      if (this.llm.provider !== 'mock') {
        try {
          const toolFacts: Fact[] = [];
          const out = await this.llm.complete({
            agent: 'ask',
            system: ASK_SYSTEM,
            user: q,
            schema: z.object({ answer: z.string() }),
            schemaName: 'answer',
            tools: this.tools,
            timeoutMs: 12000,
            mock: () => ({ answer: res.answer }),
            onToolCall: (name, args, result) => {
              toolFacts.push({
                id: `ask.t${toolFacts.length}`,
                label: name,
                value: JSON.stringify(result).slice(0, 4000),
                event_ids: [],
                text: name,
              });
              this.tracer.point(
                'ask',
                `tool:${name}`,
                traceId,
                `${name}(${JSON.stringify(args).slice(0, 80)})`,
                undefined,
                'ok',
                h.id,
              );
            },
          });
          const ctx = this.ctx([...toolFacts, ...res.facts]);
          const issues = this.critic.checkText(out.data.answer, ctx);
          if (!issues.length && toolFacts.length) {
            res = { ...res, answer: out.data.answer, facts: [...res.facts, ...toolFacts] };
            source = 'llm';
          } else
            this.tracer.point(
              'critic',
              'answer check',
              traceId,
              issues.length
                ? `REJECTED answer: ${issues.map((i) => i.detail).join('; ')}`
                : 'no tool evidence, using rule-based answer',
              { issues },
              'rejected',
              h.id,
            );
        } catch (e) {
          this.tracer.point(
            'ask',
            'llm fallback',
            traceId,
            `LLM failed: ${(e as Error).message}`,
            undefined,
            'fallback',
            h.id,
          );
        }
      }
      let answer = res.answer;
      if (lang !== 'en' && this.translator.available) {
        try {
          answer = (await this.translator.translate(answer, lang, this.names())).text;
        } catch {
          /* keep English */
        }
      }
      const grounded = this.critic.checkText(res.answer, this.ctx(res.facts)).length === 0;
      h.summary(`[${res.intent}] ${answer.slice(0, 100)}`);
      h.status(grounded ? 'ok' : 'rejected');
      return {
        id: `a${this.seq++}`,
        question: q,
        answer,
        lang: lang !== 'en' && this.translator.available ? lang : 'en',
        dir: languageDir(lang !== 'en' && this.translator.available ? lang : 'en'),
        facts: res.facts.filter((f) => !f.id.startsWith('ask.t')),
        event_ids: [...new Set(res.facts.flatMap((f) => f.event_ids))].slice(0, 20),
        grounded,
        source,
        intent: res.intent,
      };
    });
  }

  private names(): string[] {
    return [...this.s.meta.home.players, ...this.s.meta.away.players]
      .map((p) => p.short_name)
      .concat([this.s.meta.home.name, this.s.meta.away.name]);
  }

  private ctx(facts: Fact[]) {
    const allowed = new Set<string>();
    for (const t of [this.s.meta.home, this.s.meta.away])
      for (const p of t.players)
        if (facts.some((f) => JSON.stringify(f).includes(p.short_name) || f.player_id === p.id))
          allowed.add(p.id);
    const moment: Moment = {
      id: 'ask',
      kind: 'period_summary',
      ts: this.s.ts,
      minute_label: formatMinute(this.s.gameS, this.s.period),
      significance: 0,
      event_ids: [],
      headline: '',
      topic: 'ask',
    };
    return {
      facts,
      moment,
      meta: this.s.meta,
      allowedPlayers: allowed,
      knownEventIds: (id: string) => this.s.byId.has(id),
    };
  }

  /** Deterministic intent router used offline (and as the grounded fallback). */
  rules(q: string): { answer: string; facts: Fact[]; intent: string } {
    const s = this.s;
    const snap = s.snapshot();
    const T = snap.teams;
    const facts: Fact[] = [];
    const fact = (
      label: string,
      value: string | number,
      text: string,
      event_ids: string[] = [],
      player_id?: string,
    ) => {
      const f: Fact = {
        id: `ask.f${facts.length + 1}`,
        label,
        value,
        text,
        event_ids,
        ...(player_id ? { player_id } : {}),
      };
      facts.push(f);
      return f;
    };
    const lower = q.toLowerCase();
    const H = s.meta.home.name;
    const A = s.meta.away.name;

    // Minute-specific question: "what happened at 61'", "minute 73"
    const mm = lower.match(/(?:minute|min|at|in the)\s*(\d{1,3})|(\d{1,3})(?:'|th|st|nd|rd|\s*min)/);
    if (mm && /happen|what|minute|min|'/.test(lower)) {
      const minute = Number(mm[1] ?? mm[2]);
      const evs = this.eventsBetween(minute - 1, minute + 2);
      if (!evs.length) {
        fact('minute', minute, `Minute ${minute}`);
        return {
          answer: `Nothing major around ${minute}': no goals, shots, cards or changes in that window.`,
          facts,
          intent: 'minute',
        };
      }
      const desc = evs.slice(0, 5).map((e) => {
        fact(e.type, e.minute, `${e.minute} ${e.type} ${e.player ?? ''}`, [e.id]);
        return `${e.minute} ${e.type.replace('_', ' ')}${e.player ? ` by ${e.player}` : ''}${e.outcome ? ` (${e.outcome.replace('_', ' ')})` : ''}`;
      });
      return { answer: `Around ${minute}': ${desc.join('; ')}.`, facts, intent: 'minute' };
    }
    if (/why|turn|change|swing|shift/.test(lower) && /momentum|game|match|turn|press/.test(lower)) {
      const wanted = /press/.test(lower)
        ? ['pressing_shift']
        : /momentum/.test(lower)
          ? ['momentum_swing']
          : [];
      const kinds = [...wanted, 'momentum_swing', 'pressing_shift', 'tactical_shift', 'red_card'];
      const recent = [...this.memory.moments].reverse();
      const m = recent.find((x) => wanted.includes(x.kind)) ?? recent.find((x) => kinds.includes(x.kind));
      const x = m ? this.memory.explanationFor(m.id) : undefined;
      if (m && x) {
        facts.push(...x.facts);
        fact('minute', m.minute_label, m.minute_label, m.event_ids);
        return {
          answer: `${m.minute_label}: ${x.claim.replace(/^Why it matters: /, '')}`,
          facts,
          intent: 'why',
        };
      }
      fact('momentum', snap.momentum, `Momentum ${snap.momentum}`);
      return {
        answer: `No decisive swing yet. Momentum index is ${Math.round(snap.momentum)} (positive favours ${H}).`,
        facts,
        intent: 'why',
      };
    }
    if (/score|result|winning|who.*lead|how.*going/.test(lower)) {
      fact('score', `${snap.score.home}-${snap.score.away}`, `Score ${snap.score.home}-${snap.score.away}`);
      return {
        answer: `${snap.minute_label}: ${H} ${snap.score.home}-${snap.score.away} ${A}.`,
        facts,
        intent: 'score',
      };
    }
    if (/\bxg\b|expected goals|chances/.test(lower)) {
      fact('xg', `${T.home.xg}-${T.away.xg}`, `xG ${T.home.xg} - ${T.away.xg}`);
      return {
        answer: `xG: ${H} ${T.home.xg.toFixed(2)}, ${A} ${T.away.xg.toFixed(2)} (from ${T.home.shots} and ${T.away.shots} shots).`,
        facts: [...facts, fact('shots', `${T.home.shots}-${T.away.shots}`, 'shots')],
        intent: 'xg',
      };
    }
    if (/possession|ball more|keep.*ball/.test(lower)) {
      fact('possession', `${T.home.possession_pct}-${T.away.possession_pct}`, 'possession');
      return {
        answer: `Possession: ${H} ${Math.round(T.home.possession_pct)}%, ${A} ${Math.round(T.away.possession_pct)}%.`,
        facts,
        intent: 'possession',
      };
    }
    if (/ppda|press/.test(lower)) {
      fact('ppda', `${T.home.ppda}-${T.away.ppda}`, 'ppda', [], undefined);
      fact('ppda_10', `${T.home.ppda_10}-${T.away.ppda_10}`, 'ppda 10');
      return {
        answer: `PPDA (lower = more intense press): ${H} ${T.home.ppda ?? '-'} overall, ${T.home.ppda_10 ?? '-'} in the last 10 min; ${A} ${T.away.ppda ?? '-'} overall, ${T.away.ppda_10 ?? '-'} in the last 10 min.`,
        facts,
        intent: 'ppda',
      };
    }
    const howMany = lower.match(/how many (shots|corners|fouls|cards|yellow cards|offsides|passes|goals)/);
    if (howMany) {
      const key = howMany[1];
      const v = (side: 'home' | 'away') => {
        const t = T[side];
        return key === 'shots'
          ? t.shots
          : key === 'corners'
            ? t.corners
            : key === 'fouls'
              ? t.fouls
              : key.includes('card')
                ? t.yellow + t.red
                : key === 'offsides'
                  ? t.offsides
                  : key === 'passes'
                    ? t.passes
                    : t.goals;
      };
      fact(key, `${v('home')}-${v('away')}`, key);
      return {
        answer: `${key.charAt(0).toUpperCase() + key.slice(1)}: ${H} ${v('home')}, ${A} ${v('away')}.`,
        facts,
        intent: 'count',
      };
    }
    for (const L of LEADERS) {
      if (!L.words.test(lower)) continue;
      const top = this.leaders(L.metric, 3);
      const fmt = (p: PlayerStats) => {
        const raw = L.metric === 'saves' ? s.saves(p.player_id) : Number(p[L.metric as keyof PlayerStats]);
        const v =
          L.metric === 'distance_m'
            ? `${(raw / 1000).toFixed(1)} km`
            : L.metric === 'hardest_pass'
              ? `${(raw * 10).toFixed(1)}/10`
              : `${raw}${L.unit ? ` ${L.unit}` : ''}`;
        fact(
          L.label,
          L.metric === 'distance_m' ? Math.round(raw / 100) / 10 : raw,
          `${s.playerName(p.player_id)} ${v}`,
          [],
          p.player_id,
        );
        return `${s.playerName(p.player_id)} (${s.teamName(p.side)}) ${v}`;
      };
      const list = top.map(fmt);
      return {
        answer: `Most ${L.label}: ${list[0]}. Next: ${list.slice(1).join(', ')}.`,
        facts,
        intent: `leader:${String(L.metric)}`,
      };
    }
    // Player name mentioned?
    for (const t of [s.meta.home, s.meta.away]) {
      for (const p of t.players) {
        const surname = p.name.split(' ').slice(1).join(' ').toLowerCase();
        if (surname && lower.includes(surname)) {
          const ps = snap.players[p.id];
          if (!ps) {
            fact('player', p.short_name, p.short_name, [], p.id);
            return { answer: `${p.short_name} (${t.short}) hasn't featured yet.`, facts, intent: 'player' };
          }
          fact('player', ps.rating, `${p.short_name} rating`, [], p.id);
          fact('touches', ps.touches, 'touches', [], p.id);
          fact('passes', `${ps.passes_completed}/${ps.passes}`, 'passes', [], p.id);
          fact('km', Math.round(ps.distance_m / 100) / 10, 'km', [], p.id);
          fact('speed', ps.top_speed_kmh, 'top speed', [], p.id);
          fact('xg', ps.xg, 'xg', [], p.id);
          fact('goals', ps.goals, 'goals', [], p.id);
          return {
            answer: `${p.short_name} (${t.short}, #${p.number}): rating ${ps.rating.toFixed(1)}, ${ps.touches} touches, ${ps.passes_completed}/${ps.passes} passes, ${(ps.distance_m / 1000).toFixed(1)} km, top speed ${ps.top_speed_kmh.toFixed(1)} km/h${ps.goals ? `, ${ps.goals} goal${ps.goals > 1 ? 's' : ''}` : ''}${ps.xg ? `, ${ps.xg.toFixed(2)} xG` : ''}.`,
            facts: [...facts, fact('number', p.number, 'shirt', [], p.id)],
            intent: 'player',
          };
        }
      }
    }
    return {
      answer:
        'Try asking: "who is the fastest player?", "what happened at 61\'?", "why did the momentum change?", "how many shots?", "what is the xG?" or a player\'s surname.',
      facts,
      intent: 'help',
    };
  }
}

const pickTeam = (t: {
  xg: number;
  possession_pct: number;
  shots: number;
  shots_on_target: number;
  ppda: number | null;
  passes: number;
  pass_accuracy: number;
}) => ({
  xg: t.xg,
  possession_pct: t.possession_pct,
  shots: t.shots,
  shots_on_target: t.shots_on_target,
  ppda: t.ppda,
  passes: t.passes,
  pass_accuracy: t.pass_accuracy,
});
