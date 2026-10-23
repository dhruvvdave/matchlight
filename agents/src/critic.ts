import type {
  CriticIssue,
  CriticVerdict,
  ExplanationDraft,
  Fact,
  MatchMeta,
  Moment,
} from '@matchlight/schema';
import { ExplanationDraft as DraftSchema } from '@matchlight/schema';

const UP = /\b(rose|rising|risen|increased?|increasing|up|climb(?:ed|ing)?|higher|more|surged?|jumped)\b/i;
const DOWN =
  /\b(dropped|drops?|dropping|fell|falls?|falling|decreased?|decreasing|down|lower|less|fewer|declined?|slumped)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Normalise Arabic-Indic / Eastern Arabic / Devanagari digits to ASCII so checks work in every language. */
export function normaliseDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

export interface GroundingContext {
  facts: Fact[];
  moment: Moment;
  meta: MatchMeta;
  /** Player ids that may legitimately be named (moment actor + players referenced by facts / cited events). */
  allowedPlayers: Set<string>;
  knownEventIds: (id: string) => boolean;
}

/**
 * Critic / Fact-check agent. Deterministic groundedness checks: every number, player name and
 * directional claim in a narrative must be supported by the Facts it was given. Anything else is
 * rejected and sent back for regeneration (or replaced by a template that is grounded by construction).
 */
export class CriticAgent {
  constructor(private readonly meta: MatchMeta) {}

  /** Numbers the text is allowed to contain, derived from the facts (with sensible rounding variants). */
  allowedNumbers(facts: Fact[], extra: (string | number)[] = []): number[] {
    const nums: number[] = [];
    const push = (v: unknown) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        nums.push(v, Math.abs(v));
      } else if (typeof v === 'string') {
        for (const m of normaliseDigits(v).matchAll(/\d+(?:\.\d+)?/g)) nums.push(Number(m[0]));
      }
    };
    for (const f of facts) {
      push(f.value);
      push(f.previous);
      push(f.delta);
      for (const v of Object.values(f.params ?? {})) push(v);
      // The canonical fact text is generated from the data, so numbers in it are grounded too.
      push(f.text);
      if (typeof f.value === 'number' && typeof f.previous === 'number')
        push(Math.round((f.value - f.previous) * 10) / 10);
    }
    for (const v of extra) push(v);
    return nums;
  }

  /** Strip string tokens we know are legitimate (formations "4-3-3", scores "2-1", minute labels "45+2'"). */
  private stripKnownTokens(text: string, facts: Fact[], extra: string[]): string {
    const tokens = new Set<string>(extra);
    for (const f of facts) {
      if (typeof f.value === 'string') tokens.add(f.value);
      for (const v of Object.values(f.params ?? {})) if (typeof v === 'string') tokens.add(v);
    }
    let out = normaliseDigits(text);
    for (const t of [...tokens].filter((t) => /\d/.test(t)).sort((a, b) => b.length - a.length)) {
      // Token boundaries: never strip "1/1" out of "8.1/10".
      out = out.replace(new RegExp(`(?<![\\d.,/])${escapeRe(t)}(?![\\d/])`, 'g'), ' ');
    }
    return out;
  }

  extractNumbers(text: string): number[] {
    const out: number[] = [];
    for (const m of normaliseDigits(text).matchAll(/(?<![\w.])(\d+(?:[.,]\d+)?)(?![\w])/g)) {
      out.push(Number(m[1].replace(',', '.')));
    }
    // Spelled-out numbers only count when they quantify something ("three shots"), not "fizzes one across".
    const units =
      'goals?|shots?|minutes?|players?|men|passes|saves?|turnovers|chances|tackles|corners|cards|bookings|of';
    for (const w of text
      .toLowerCase()
      .matchAll(
        new RegExp(
          `\\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+(?:${units})\\b`,
          'g',
        ),
      )) {
      out.push(NUMBER_WORDS[w[1]]);
    }
    return out;
  }

  private numberSupported(n: number, allowed: number[]): boolean {
    return allowed.some(
      (a) =>
        Math.abs(n - a) < 0.006 ||
        n === Math.round(a) ||
        Math.abs(n - Math.round(a * 10) / 10) < 0.006 ||
        Math.abs(n - Math.round(a * 100)) < 0.006 ||
        Math.abs(n - (Math.round(a * 10) / 10) * 10) < 0.006,
    );
  }

  /** Player names (full, short, surname) mentioned in the text that are NOT allowed. */
  private unsupportedPlayers(text: string, allowed: Set<string>): string[] {
    const bad: string[] = [];
    for (const team of [this.meta.home, this.meta.away]) {
      for (const p of team.players) {
        if (allowed.has(p.id)) continue;
        const surname = p.name.split(' ').slice(1).join(' ');
        const re = new RegExp(`\\b${escapeRe(surname)}\\b`);
        if (re.test(text)) {
          // Surname shared with an allowed player? then it's ambiguous, not an error.
          const sharedWithAllowed = [...allowed].some((id) => {
            const ap = this.findPlayer(id);
            return ap && ap.name.split(' ').slice(1).join(' ') === surname;
          });
          if (!sharedWithAllowed) bad.push(p.short_name);
        }
      }
    }
    return [...new Set(bad)];
  }

  private findPlayer(id: string) {
    return this.meta.home.players.find((p) => p.id === id) ?? this.meta.away.players.find((p) => p.id === id);
  }

  checkText(
    text: string,
    ctx: GroundingContext,
    opts: { maxNumbers?: number; extraTokens?: string[] } = {},
  ): CriticIssue[] {
    const issues: CriticIssue[] = [];
    const extraTokens = [ctx.moment.minute_label, ...(opts.extraTokens ?? [])];
    const allowed = this.allowedNumbers(ctx.facts, [ctx.moment.minute_label]);
    const stripped = this.stripKnownTokens(text, ctx.facts, extraTokens);
    const nums = this.extractNumbers(stripped);
    for (const n of nums) {
      if (!this.numberSupported(n, allowed))
        issues.push({ code: 'unsupported_number', detail: `"${n}" is not backed by any fact` });
    }
    if (opts.maxNumbers !== undefined && nums.length > opts.maxNumbers) {
      issues.push({
        code: 'too_many_numbers',
        detail: `${nums.length} numbers > persona limit ${opts.maxNumbers}`,
      });
    }
    for (const name of this.unsupportedPlayers(text, ctx.allowedPlayers)) {
      issues.push({ code: 'unsupported_entity', detail: `mentions ${name}, who is not in the evidence` });
    }
    // Direction words must agree with the sign of each fact's delta when its metric is mentioned.
    for (const f of ctx.facts) {
      if (typeof f.delta !== 'number' || f.delta === 0) continue;
      const keyword = f.label.split(/[\s(]/)[0];
      if (keyword.length < 2) continue;
      const own = f.team ? [this.meta[f.team].name, this.meta[f.team].short] : [];
      const other = f.team
        ? [
            this.meta[f.team === 'home' ? 'away' : 'home'].name,
            this.meta[f.team === 'home' ? 'away' : 'home'].short,
          ]
        : [];
      for (const sentence of splitSentences(text)) {
        if (!new RegExp(`\\b${escapeRe(keyword)}\\b`, 'i').test(sentence)) continue;
        // A team-specific fact only constrains sentences about that team.
        if (f.team && other.some((t) => sentence.includes(t)) && !own.some((t) => sentence.includes(t)))
          continue;
        const local = sentence.slice(sentence.toLowerCase().indexOf(keyword.toLowerCase()));
        const clause = local.split(/[,;]| but | while /)[0];
        if (f.delta < 0 && UP.test(clause) && !DOWN.test(clause))
          issues.push({
            code: 'direction_mismatch',
            detail: `${f.label} fell (${f.delta}) but text says it rose`,
          });
        if (f.delta > 0 && DOWN.test(clause) && !UP.test(clause))
          issues.push({
            code: 'direction_mismatch',
            detail: `${f.label} rose (+${f.delta}) but text says it fell`,
          });
      }
    }
    return issues;
  }

  /** Validate an Explainer draft: schema, citations, numbers, entities, direction, calibrated confidence. */
  checkExplanation(raw: unknown, ctx: GroundingContext): CriticVerdict & { draft?: ExplanationDraft } {
    const parsed = DraftSchema.safeParse(raw);
    if (!parsed.success)
      return {
        ok: false,
        issues: [{ code: 'schema', detail: parsed.error.issues[0]?.message ?? 'invalid draft' }],
      };
    const d = parsed.data;
    const issues: CriticIssue[] = [];
    const factIds = new Set(ctx.facts.map((f) => f.id));
    if (!d.evidence.length) issues.push({ code: 'empty_evidence', detail: 'no evidence cited' });
    for (const ev of d.evidence)
      if (!factIds.has(ev.fact_id))
        issues.push({ code: 'unknown_fact', detail: `cites ${ev.fact_id}, which does not exist` });
    for (const id of d.event_ids)
      if (!ctx.knownEventIds(id))
        issues.push({ code: 'unknown_event', detail: `event ${id} not in the event store` });
    const text = [d.claim, ...d.evidence.map((e) => e.text)].join(' ');
    issues.push(...this.checkText(text, ctx));
    const maxConf = d.evidence.length >= 2 ? 0.95 : 0.85;
    if (d.confidence > maxConf)
      issues.push({
        code: 'overconfident',
        detail: `confidence ${d.confidence} > ${maxConf} for ${d.evidence.length} evidence item(s)`,
      });
    return { ok: issues.length === 0, issues, draft: d };
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sentence split that does not break on initials ("C. Uwakwe") or decimals. */
export function splitSentences(text: string): string[] {
  return text.split(/(?<=[^A-Z\s.][.!?;])\s+(?=\S)/).filter(Boolean);
}

export const firstSentence = (text: string) => splitSentences(text)[0] ?? text;
