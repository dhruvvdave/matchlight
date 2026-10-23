import type { OverlayRegion } from '@matchlight/schema';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Default slot rectangles, normalised inside the title-safe area. Mirrored horizontally for RTL. */
export const REGION_RECTS: Record<OverlayRegion, Rect> = {
  top_left: { x: 0, y: 0, w: 0.34, h: 0.08 },
  top_center: { x: 0.35, y: 0, w: 0.3, h: 0.08 },
  top_right: { x: 0.7, y: 0, w: 0.3, h: 0.14 },
  left_rail: { x: 0, y: 0.13, w: 0.26, h: 0.42 },
  right_rail: { x: 0.72, y: 0.18, w: 0.28, h: 0.46 },
  center: { x: 0.22, y: 0.26, w: 0.56, h: 0.4 },
  lower_third: { x: 0, y: 0.84, w: 0.6, h: 0.16 },
  pitch: { x: 0.45, y: 0.45, w: 0.12, h: 0.06 },
};

/** Max overlays that may share a region at once. */
export const REGION_CAPACITY: Record<OverlayRegion, number> = {
  top_left: 1,
  top_center: 1,
  top_right: 1,
  left_rail: 1,
  right_rail: 1,
  center: 1,
  lower_third: 1,
  pitch: 2,
};

export function placed(region: OverlayRegion, dir: 'ltr' | 'rtl', override?: Partial<Rect>): Rect {
  const r = { ...REGION_RECTS[region], ...override };
  if (dir === 'rtl' && region !== 'pitch' && region !== 'center' && region !== 'top_center')
    r.x = round(1 - r.x - r.w);
  return { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
}

const round = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
