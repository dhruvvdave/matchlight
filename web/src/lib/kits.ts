import type { MatchMeta, Side } from '@matchlight/schema';

export type KitPattern = 'plain' | 'hoops' | 'halves' | 'sash' | 'pinstripe' | 'band';

export interface Kit {
  base: string;
  trim: string;
  pattern: KitPattern;
  /** Readable text colour on the base. */
  ink: string;
}

/**
 * Presentation kits for the fictional clubs. Chosen so no combination copies a real club:
 * unusual pairings (teal with a salmon sash, plum and sand halves) and patterns as part of identity.
 */
const KITS: Record<string, Kit> = {
  hba: { base: '#1F8A86', trim: '#F4A38B', pattern: 'sash', ink: '#06201F' },
  ivr: { base: '#6E2F63', trim: '#E2CF9F', pattern: 'halves', ink: '#FFF6E6' },
  kvf: { base: '#6B7A2A', trim: '#E9B949', pattern: 'hoops', ink: '#13170A' },
  lkt: { base: '#B7A4DE', trim: '#2D2B38', pattern: 'pinstripe', ink: '#1C1A26' },
  cpb: { base: '#B4673A', trim: '#3E4A52', pattern: 'band', ink: '#1C0F07' },
  smm: { base: '#9ED3C6', trim: '#1E3A5F', pattern: 'hoops', ink: '#0D1F27' },
  glt: { base: '#D9C86A', trim: '#4B2E5A', pattern: 'sash', ink: '#1F1A05' },
  sth: { base: '#5D7387', trim: '#F1E6D2', pattern: 'pinstripe', ink: '#FFFFFF' },
  emb: { base: '#8E3B46', trim: '#9CC9C0', pattern: 'band', ink: '#FFF4F2' },
  qsp: { base: '#3F6B4C', trim: '#E68F7A', pattern: 'halves', ink: '#F4FFF6' },
};

const FALLBACK: Record<Side, Kit> = {
  home: { base: '#1F8A86', trim: '#F4A38B', pattern: 'plain', ink: '#06201F' },
  away: { base: '#6E2F63', trim: '#E2CF9F', pattern: 'plain', ink: '#FFF6E6' },
};

export function kit(meta: MatchMeta | null, side: Side): Kit {
  if (!meta) return FALLBACK[side];
  return KITS[meta[side].id] ?? FALLBACK[side];
}
