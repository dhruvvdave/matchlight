import type { Language, MatchMeta, Overlay, OverlayOf, OverlayRegion, Side } from '@matchlight/schema';
import { SCHEMA_VERSION, languageDir, PITCH } from '@matchlight/schema';
import { placed } from './regions.js';

export interface RenderContext {
  meta: MatchMeta;
  profileKey: string;
  language: Language;
  highContrast: boolean;
}

type Common = {
  start_ts: number;
  duration: number;
  priority: number;
  debounce_key: string;
  source_event_ids: string[];
  explanation_id?: string;
  aria_label: string;
};

/**
 * Stage 4 (RENDER): builds schema-valid, broadcast-ready overlay JSON. Pure + deterministic:
 * ids are derived from a per-profile counter so replaying a seed yields identical output.
 */
export class OverlayBuilder {
  private seq = 0;
  constructor(readonly ctx: RenderContext) {}

  private base<K extends Overlay['kind']>(
    kind: K,
    region: OverlayRegion,
    c: Common,
    rect?: { x?: number; y?: number; w?: number; h?: number },
  ) {
    const dir = languageDir(this.ctx.language);
    return {
      id: `${this.ctx.profileKey}:${kind}:${String(this.seq++).padStart(4, '0')}`,
      schema_version: SCHEMA_VERSION,
      match_id: this.ctx.meta.match_id,
      profile_key: this.ctx.profileKey,
      kind,
      region,
      position: placed(region, dir, rect),
      language: this.ctx.language,
      dir,
      theme: this.ctx.highContrast ? ('high_contrast' as const) : ('broadcast' as const),
      start_ts: Math.round(c.start_ts * 10) / 10,
      duration: c.duration,
      priority: Math.max(0, Math.min(100, Math.round(c.priority))),
      debounce_key: c.debounce_key,
      source_event_ids: c.source_event_ids,
      explanation_id: c.explanation_id,
      aria_label: c.aria_label,
    };
  }

  teamColor(side: Side): string {
    return (side === 'home' ? this.ctx.meta.home : this.ctx.meta.away).colors.primary;
  }

  lowerThird(c: Common, content: OverlayOf<'lower_third'>['content']): OverlayOf<'lower_third'> {
    return clean({
      ...this.base('lower_third', 'lower_third', c),
      content: {
        ...content,
        accent: content.accent ?? (content.team ? this.teamColor(content.team) : undefined),
      },
    });
  }

  playerTag(
    c: Common,
    content: OverlayOf<'player_tag'>['content'],
    at?: { x: number; y: number },
  ): OverlayOf<'player_tag'> {
    // Anchor near the player's pitch location (graphics engines re-anchor live via player_id).
    const rect = at
      ? { x: clamp01(at.x / PITCH.length - 0.06), y: clamp01(1 - at.y / PITCH.width - 0.08) }
      : undefined;
    return clean({ ...this.base('player_tag', 'pitch', c, rect), content });
  }

  statBadge(
    c: Common,
    content: OverlayOf<'stat_badge'>['content'],
    region: OverlayRegion = 'top_right',
  ): OverlayOf<'stat_badge'> {
    return clean({ ...this.base('stat_badge', region, c), content });
  }

  momentumBar(c: Common, content: OverlayOf<'momentum_bar'>['content']): OverlayOf<'momentum_bar'> {
    return clean({ ...this.base('momentum_bar', 'top_left', c), content });
  }

  passMap(c: Common, content: OverlayOf<'pass_map'>['content']): OverlayOf<'pass_map'> {
    return clean({ ...this.base('pass_map', 'left_rail', c), content });
  }

  keyMomentCard(
    c: Common,
    content: OverlayOf<'key_moment_card'>['content'],
    region: OverlayRegion = 'right_rail',
  ): OverlayOf<'key_moment_card'> {
    return clean({ ...this.base('key_moment_card', region, c), content });
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(0.88, v));

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  const c = (o as { content?: Record<string, unknown> }).content;
  if (c) for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return o;
}
