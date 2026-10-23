import { z } from 'zod';
import type { EventOf, Fact, Language, Moment, Recap, Side } from '@matchlight/schema';
import { formatMinute, otherSide } from '@matchlight/schema';
import type { StatsEngine } from '@matchlight/pipeline';
import { CriticAgent } from './critic.js';
import { fill } from './i18n/narrative.js';
import type { Blackboard } from './runtime/memory.js';
import type { LlmClient } from './runtime/llm.js';
import type { Tracer } from './runtime/trace.js';
import type { TranslatorAgent } from './translator.js';

const R = {
  en: {
    comeback: '{winner} complete a stunning comeback against {loser} ({score})',
    red: '{winner} punish {loser} after a red card ({score})',
    win: '{winner} beat {loser} {score}',
    draw: '{home} and {away} draw {score}',
    s_final: 'Full-time at {stadium}: {home} {score} {away}.',
    s_goals: 'Goals: {goals}.',
    s_none: 'No goals, but plenty of structure.',
    s_turn: 'The turning point came at {min}: {turning}',
    s_potm: '{potm} was the standout performer, rated {rating}.',
    s_nums: 'On the numbers: xG {hx} to {ax}, possession {hp}% to {ap}%.',
  },
  fr: {
    comeback: '{winner} signe une remontada face à {loser} ({score})',
    red: '{winner} punit {loser} après un carton rouge ({score})',
    win: '{winner} bat {loser} {score}',
    draw: '{home} et {away} se neutralisent {score}',
    s_final: 'Fin du match à {stadium} : {home} {score} {away}.',
    s_goals: 'Buts : {goals}.',
    s_none: 'Pas de but, mais beaucoup de rigueur tactique.',
    s_turn: 'Le tournant à la {min} : {turning}',
    s_potm: '{potm} a été le meilleur, avec une note de {rating}.',
    s_nums: 'En chiffres : xG {hx} contre {ax}, possession {hp} % contre {ap} %.',
  },
  es: {
    comeback: '{winner} firma una remontada épica ante {loser} ({score})',
    red: '{winner} castiga a {loser} tras la expulsión ({score})',
    win: '{winner} vence a {loser} {score}',
    draw: '{home} y {away} empatan {score}',
    s_final: 'Final en {stadium}: {home} {score} {away}.',
    s_goals: 'Goles: {goals}.',
    s_none: 'Sin goles, pero con mucho orden táctico.',
    s_turn: 'El punto de inflexión llegó en el {min}: {turning}',
    s_potm: '{potm} fue el mejor, con una nota de {rating}.',
    s_nums: 'En números: xG {hx} a {ax}, posesión {hp}% a {ap}%.',
  },
  hi: {
    comeback: '{winner} ने {loser} के ख़िलाफ़ शानदार वापसी की ({score})',
    red: 'लाल कार्ड के बाद {winner} ने {loser} को हराया ({score})',
    win: '{winner} ने {loser} को {score} से हराया',
    draw: '{home} और {away} का मैच {score} से बराबर',
    s_final: '{stadium} में मैच ख़त्म: {home} {score} {away}।',
    s_goals: 'गोल: {goals}।',
    s_none: 'कोई गोल नहीं, पर रणनीति भरपूर।',
    s_turn: 'मैच का निर्णायक पल {min} पर आया: {turning}',
    s_potm: '{potm} सबसे बेहतरीन रहे, रेटिंग {rating}।',
    s_nums: 'आँकड़े: xG {hx} बनाम {ax}, पज़ेशन {hp}% बनाम {ap}%।',
  },
  ar: {
    comeback: '{winner} يحقق عودة مذهلة أمام {loser} ({score})',
    red: '{winner} يعاقب {loser} بعد البطاقة الحمراء ({score})',
    win: '{winner} يتغلب على {loser} {score}',
    draw: 'تعادل {home} و{away} {score}',
    s_final: 'نهاية المباراة في {stadium}: {home} {score} {away}.',
    s_goals: 'الأهداف: {goals}.',
    s_none: 'لا أهداف، لكن الكثير من الانضباط التكتيكي.',
    s_turn: 'جاءت نقطة التحول عند {min}: {turning}',
    s_potm: '{potm} كان الأبرز بتقييم {rating}.',
    s_nums: 'بالأرقام: xG {hx} مقابل {ax}، استحواذ {hp}% مقابل {ap}%.',
  },
} satisfies Record<Language, Record<string, string>>;

export const RECAP_SYSTEM = `You are the Recap agent. Write an end-of-match report for a fictional, synthetic football match.
Use ONLY the facts provided (numbers, names, minutes). Do not invent quotes, injuries, or history.
Return JSON {"headline": string, "article_md": string (3-5 short paragraphs of markdown, no tables), "script_60s": string (about 140 words, spoken style)}.`;

/** Recap agent: article (markdown), 60-second script, key-moments timeline and player ratings. */
export class RecapAgent {
  constructor(
    private readonly s: StatsEngine,
    private readonly memory: Blackboard,
    private readonly llm: LlmClient,
    private readonly critic: CriticAgent,
    private readonly translator: TranslatorAgent,
    private readonly tracer: Tracer,
  ) {}

  private story() {
    const s = this.s;
    const goals = s.events.filter((e): e is EventOf<'goal'> => e.type === 'goal');
    const { home, away } = s.score;
    const winner: Side | null = home > away ? 'home' : away > home ? 'away' : null;
    let maxDeficit = 0;
    if (winner)
      for (const g of goals) maxDeficit = Math.max(maxDeficit, g.score[otherSide(winner)] - g.score[winner]);
    const red = s.events.find((e) => e.type === 'card' && e.color !== 'yellow');
    const winnerGoal = winner ? goals.filter((g) => g.team === winner).at(-1) : undefined;
    const lateWinner = !!winnerGoal && winnerGoal.game_s >= 75 * 60;
    const kind =
      winner && red && red.team === otherSide(winner)
        ? 'red'
        : winner && (maxDeficit >= 2 || (maxDeficit >= 1 && lateWinner))
          ? 'comeback'
          : winner
            ? 'win'
            : 'draw';
    return { goals, winner, kind } as const;
  }

  facts(): Fact[] {
    const s = this.s;
    const snap = s.snapshot();
    const T = snap.teams;
    const F: Fact[] = [];
    const add = (
      label: string,
      value: string | number,
      text: string,
      params: Record<string, string | number> = {},
      event_ids: string[] = [],
    ) => F.push({ id: `recap.f${F.length + 1}`, label, value, text, event_ids, tkey: label, params });
    add('Score', `${s.score.home}-${s.score.away}`, `Final score ${s.score.home}-${s.score.away}`);
    for (const k of [
      'xg',
      'possession_pct',
      'shots',
      'shots_on_target',
      'passes',
      'pass_accuracy',
      'distance_km',
      'top_player_speed_kmh',
    ] as const) {
      add(k, `${T.home[k]}-${T.away[k]}`, `${k}: ${T.home[k]} vs ${T.away[k]}`, {
        h: T.home[k] ?? 0,
        a: T.away[k] ?? 0,
        hr: Math.round(T.home[k] ?? 0),
        ar: Math.round(T.away[k] ?? 0),
      });
    }
    add('ppda', `${T.home.ppda}-${T.away.ppda}`, `PPDA ${T.home.ppda} vs ${T.away.ppda}`, {
      h: T.home.ppda ?? 0,
      a: T.away.ppda ?? 0,
    });
    for (const g of this.story().goals)
      add(
        'Goal',
        formatMinute(g.game_s, g.period),
        `${s.playerName(g.player_id)} ${formatMinute(g.game_s, g.period)}`,
        { s: `${g.score.home}-${g.score.away}` },
        [g.id],
      );
    for (const p of Object.values(snap.players))
      if (p.minutes > 0)
        add('rating', p.rating, `${s.playerName(p.player_id)} ${p.rating}`, {
          g: p.goals,
          a: p.assists,
          km: Math.round(p.distance_m / 100) / 10,
          t: p.tackles + p.interceptions,
          kp: p.key_passes,
        });
    for (const m of this.memory.moments) add('Moment', m.minute_label, m.headline, {}, m.event_ids);
    for (const x of this.memory.explanations.values()) for (const f of x.facts) F.push(f);
    return F;
  }

  async build(lang: Language, traceId: string): Promise<Recap> {
    return this.tracer.span('recap', 'build', traceId, async (h) => {
      const s = this.s;
      const snap = s.snapshot();
      const T = snap.teams;
      const st = this.story();
      const name = (side: Side) => s.teamName(side);
      const score = `${s.score.home}-${s.score.away}`;
      const winnerName = st.winner ? name(st.winner) : '';
      const loserName = st.winner ? name(otherSide(st.winner)) : '';
      const players = Object.values(snap.players)
        .filter((p) => p.minutes > 0)
        .sort((a, b) => b.rating - a.rating);
      const potm = players[0];
      const turning = this.turningPoint();
      const goalList = st.goals
        .map((g) => `${s.playerName(g.player_id)} ${formatMinute(g.game_s, g.period)}`)
        .join(', ');
      const P = {
        winner: winnerName,
        loser: loserName,
        home: s.meta.home.name,
        away: s.meta.away.name,
        score,
        stadium: s.meta.stadium,
        goals: goalList,
        min: turning?.minute_label ?? '',
        turning: turning ? this.turningText(turning) : '',
        potm: potm ? s.playerName(potm.player_id) : '',
        rating: potm?.rating.toFixed(1) ?? '',
        hx: T.home.xg.toFixed(2),
        ax: T.away.xg.toFixed(2),
        hp: Math.round(T.home.possession_pct),
        ap: Math.round(T.away.possession_pct),
      };
      const tl = (l: Language, k: keyof (typeof R)['en']) => fill(R[l][k], P);
      const headlineFor = (l: Language) =>
        tl(
          l,
          st.kind === 'comeback'
            ? 'comeback'
            : st.kind === 'red'
              ? 'red'
              : st.kind === 'win'
                ? 'win'
                : 'draw',
        );
      const scriptFor = (l: Language) =>
        [
          tl(l, 's_final'),
          st.goals.length ? tl(l, 's_goals') : tl(l, 's_none'),
          turning ? tl(l, 's_turn') : '',
          potm ? tl(l, 's_potm') : '',
          tl(l, 's_nums'),
        ]
          .filter(Boolean)
          .join(' ');

      const article = this.templateArticle(headlineFor('en'), P, st, turning, players.slice(0, 3));
      let headline = headlineFor(lang);
      let script = scriptFor(lang);
      let articleMd = article;
      let source: Recap['source'] = 'template';
      const facts = this.facts();
      const ctx = {
        facts,
        moment: {
          id: 'recap',
          kind: 'period_summary',
          ts: s.ts,
          minute_label: snap.minute_label,
          significance: 1,
          event_ids: [],
          headline: '',
          topic: 'recap',
        } as Moment,
        meta: s.meta,
        allowedPlayers: new Set(players.map((p) => p.player_id)),
        knownEventIds: (id: string) => s.byId.has(id),
      };

      if (this.llm.provider !== 'mock') {
        try {
          const res = await this.llm.complete({
            agent: 'recap',
            system: RECAP_SYSTEM,
            user: JSON.stringify({
              match: `${s.meta.home.name} v ${s.meta.away.name}`,
              stadium: s.meta.stadium,
              facts: facts.slice(0, 80).map((f) => f.text),
              template_article: article,
            }),
            schema: z.object({ headline: z.string(), article_md: z.string(), script_60s: z.string() }),
            schemaName: 'recap',
            temperature: 0.5,
            maxTokens: 900,
            timeoutMs: 20000,
            mock: () => ({ headline, article_md: articleMd, script_60s: script }),
          });
          const issues = this.critic.checkText(
            [res.data.headline, res.data.article_md, res.data.script_60s].join('\n'),
            ctx,
          );
          if (!issues.length) {
            headline = res.data.headline;
            articleMd = res.data.article_md;
            script = res.data.script_60s;
            source = 'llm';
            if (lang !== 'en' && this.translator.available) {
              const protect = players
                .map((p) => s.playerName(p.player_id))
                .concat([s.meta.home.name, s.meta.away.name]);
              headline = (await this.translator.translate(headline, lang, protect)).text;
              script = (await this.translator.translate(script, lang, protect)).text;
              articleMd = (await this.translator.translate(articleMd, lang, protect)).text;
            }
          } else {
            this.tracer.point(
              'critic',
              'recap rejected',
              traceId,
              `REJECTED recap: ${issues.map((i) => i.detail).join('; ')}`,
              { issues },
              'rejected',
              h.id,
            );
          }
        } catch (e) {
          this.tracer.point(
            'recap',
            'llm fallback',
            traceId,
            `LLM recap failed: ${(e as Error).message}`,
            undefined,
            'fallback',
            h.id,
          );
        }
      }
      const issues = this.critic.checkText(`${articleMd}\n${lang === 'en' ? script : ''}`, ctx);
      h.summary(
        `${source} recap: "${headline}" (${issues.length ? `${issues.length} grounding issue(s)` : 'grounded'})`,
      );
      h.set({ issues });
      return {
        match_id: s.meta.match_id,
        lang,
        generated_at_ts: s.ts,
        final_score: { ...s.score },
        headline,
        article_md: articleMd,
        script_60s: script,
        timeline: this.timeline(),
        player_ratings: players.map((p) => ({
          player_id: p.player_id,
          name: s.playerName(p.player_id),
          side: p.side,
          rating: p.rating,
          reason: this.reason(p),
        })),
        key_stats: [
          { label: 'xG', home: T.home.xg.toFixed(2), away: T.away.xg.toFixed(2) },
          {
            label: 'Possession',
            home: `${Math.round(T.home.possession_pct)}%`,
            away: `${Math.round(T.away.possession_pct)}%`,
          },
          {
            label: 'Shots (on target)',
            home: `${T.home.shots} (${T.home.shots_on_target})`,
            away: `${T.away.shots} (${T.away.shots_on_target})`,
          },
          {
            label: 'Passes (accuracy)',
            home: `${T.home.passes} (${Math.round(T.home.pass_accuracy)}%)`,
            away: `${T.away.passes} (${Math.round(T.away.pass_accuracy)}%)`,
          },
          { label: 'PPDA', home: `${T.home.ppda ?? '-'}`, away: `${T.away.ppda ?? '-'}` },
          {
            label: 'Distance (km)',
            home: T.home.distance_km.toFixed(1),
            away: T.away.distance_km.toFixed(1),
          },
          {
            label: 'Top speed (km/h)',
            home: T.home.top_player_speed_kmh.toFixed(1),
            away: T.away.top_player_speed_kmh.toFixed(1),
          },
          {
            label: 'Cards',
            home: `${T.home.yellow}Y ${T.home.red}R`,
            away: `${T.away.yellow}Y ${T.away.red}R`,
          },
        ],
        source,
        grounded: issues.length === 0,
      };
    });
  }

  /**
   * The moment that best explains the result: for a comeback, the winner's change shortly before their
   * first goal while trailing; otherwise a red card; otherwise the most significant tactical/momentum moment.
   */
  private turningPoint(): Moment | undefined {
    const kinds = ['tactical_shift', 'red_card', 'momentum_swing', 'pressing_shift', 'substitution'];
    const ms = this.memory.moments.filter((m) => kinds.includes(m.kind));
    const st = this.story();
    if (st.kind === 'comeback' && st.winner) {
      const w = st.winner;
      const firstFightback = st.goals.find((g) => g.team === w && g.score[w] <= g.score[otherSide(w)]);
      if (firstFightback) {
        const before = ms.filter(
          (m) => m.team === w && m.ts <= firstFightback.ts && m.ts >= firstFightback.ts - 15 * 60,
        );
        const pick =
          before.find((m) => m.kind === 'tactical_shift') ??
          before.find((m) => m.kind !== 'substitution') ??
          before[0];
        if (pick) return pick;
      }
    }
    const red = ms.find((m) => m.kind === 'red_card');
    if (red) return red;
    return [...ms]
      .filter((m) => m.kind !== 'substitution')
      .sort((a, b) => b.significance - a.significance || a.ts - b.ts)[0];
  }

  private turningText(m: Moment): string {
    const x = this.memory.explanationFor(m.id);
    return x ? x.claim.replace(/^Why it matters: /, '') : `${m.headline}.`;
  }

  private templateArticle(
    headline: string,
    P: Record<string, string | number>,
    st: ReturnType<RecapAgent['story']>,
    turning: Moment | undefined,
    top: { player_id: string; rating: number }[],
  ): string {
    const s = this.s;
    const firstHalf = st.goals.filter((g) => g.period === 1);
    const secondHalf = st.goals.filter((g) => g.period === 2);
    const gl = (gs: typeof st.goals) =>
      gs
        .map(
          (g) => `${s.playerName(g.player_id)} (${formatMinute(g.game_s, g.period)}, ${s.teamName(g.team!)})`,
        )
        .join(', ');
    const ht = s.events.find((e) => e.type === 'period_end' && e.period === 1) as
      | EventOf<'period_end'>
      | undefined;
    const lines = [
      `# ${headline}`,
      '',
      `*${s.meta.competition} · ${s.meta.stadium} · synthetic match data*`,
      '',
      `**${P.home} ${P.score} ${P.away}.** ${st.kind === 'comeback' ? `${P.winner} came from behind to win.` : st.kind === 'red' ? `A red card changed everything.` : st.kind === 'draw' ? 'Neither side could find a winner.' : `${P.winner} took the points.`}`,
      '',
      `**First half.** ${firstHalf.length ? `Goals from ${gl(firstHalf)}.` : 'No goals before the break.'}${ht ? ` It was ${ht.score.home}-${ht.score.away} at half-time.` : ''}`,
      '',
      turning ? `**Turning point (${turning.minute_label}).** ${this.turningText(turning)}` : '',
      '',
      `**Second half.** ${secondHalf.length ? `Goals from ${gl(secondHalf)}.` : 'The second half stayed goalless.'}`,
      '',
      `**By the numbers.** xG ${P.hx}-${P.ax}; possession ${P.hp}%-${P.ap}%.`,
      '',
      `**Top performers.** ${top.map((p) => `${s.playerName(p.player_id)} (${p.rating.toFixed(1)})`).join(', ')}.`,
    ];
    return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  }

  private timeline(): Recap['timeline'] {
    const s = this.s;
    const items: Recap['timeline'] = [];
    for (const e of s.events) {
      if (e.type === 'goal')
        items.push({
          ts: e.ts,
          minute_label: formatMinute(e.game_s, e.period),
          kind: 'goal',
          title: `Goal: ${s.playerName(e.player_id)} (${e.score.home}-${e.score.away})`,
          team: e.team,
          event_ids: [e.id],
        });
      if (e.type === 'card' && e.color !== 'yellow')
        items.push({
          ts: e.ts,
          minute_label: formatMinute(e.game_s, e.period),
          kind: 'red_card',
          title: `Red card: ${s.playerName(e.player_id)}`,
          team: e.team,
          event_ids: [e.id],
        });
    }
    for (const m of this.memory.moments) {
      if (m.significance >= 0.62 && !['goal', 'red_card', 'period_summary'].includes(m.kind))
        items.push({
          ts: m.ts,
          minute_label: m.minute_label,
          kind: m.kind,
          title: m.headline,
          team: m.team,
          event_ids: m.event_ids,
        });
    }
    return items.sort((a, b) => a.ts - b.ts);
  }

  private reason(p: {
    goals: number;
    assists: number;
    key_passes: number;
    tackles: number;
    interceptions: number;
    distance_m: number;
    top_speed_kmh: number;
    passes_completed: number;
    player_id: string;
  }): string {
    const parts: string[] = [];
    if (p.goals) parts.push(`${p.goals} goal${p.goals > 1 ? 's' : ''}`);
    if (p.assists) parts.push(`${p.assists} assist${p.assists > 1 ? 's' : ''}`);
    const saves = this.s.saves(p.player_id);
    if (saves) parts.push(`${saves} saves`);
    if (p.key_passes >= 2) parts.push(`${p.key_passes} key passes`);
    if (p.tackles + p.interceptions >= 6) parts.push(`${p.tackles + p.interceptions} ball wins`);
    if (!parts.length) parts.push(`${p.passes_completed} passes, ${(p.distance_m / 1000).toFixed(1)} km`);
    return parts.join(', ');
  }

  toMarkdown(r: Recap): string {
    const s = this.s;
    const rows = r.key_stats.map((k) => `| ${k.label} | ${k.home} | ${k.away} |`).join('\n');
    const ratings = r.player_ratings
      .slice(0, 22)
      .map(
        (p) =>
          `| ${p.name} | ${p.side === 'home' ? s.meta.home.short : s.meta.away.short} | ${p.rating.toFixed(1)} | ${p.reason} |`,
      )
      .join('\n');
    const tl = r.timeline.map((t) => `- **${t.minute_label}** ${t.title}`).join('\n');
    return `${r.article_md}\n\n## Key stats\n\n| | ${s.meta.home.short} | ${s.meta.away.short} |\n|---|---|---|\n${rows}\n\n## Key moments\n\n${tl}\n\n## Player ratings\n\n| Player | Team | Rating | Why |\n|---|---|---|---|\n${ratings}\n\n## 60-second script\n\n${r.script_60s}\n\n---\n*Generated by Matchlight from synthetic data (${r.source}, ${r.grounded ? 'Critic: grounded' : 'Critic: issues flagged'}).*\n`;
  }
}
