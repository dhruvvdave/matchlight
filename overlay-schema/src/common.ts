import { z } from 'zod';

/** Schema version stamped on every machine-readable payload. Bump on breaking changes. */
export const SCHEMA_VERSION = '1.0.0';

/** Pitch is 105 x 68 metres. Coordinates are normalised so the HOME team always attacks towards x = 105. */
export const PITCH = { length: 105, width: 68 } as const;

export const Side = z.enum(['home', 'away']);
export type Side = z.infer<typeof Side>;

export const Language = z.enum(['en', 'fr', 'es', 'hi', 'ar']);
export type Language = z.infer<typeof Language>;
export const RTL_LANGUAGES: readonly Language[] = ['ar'];
export const languageDir = (lang: Language): 'ltr' | 'rtl' => (RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr');

export const Period = z.union([z.literal(1), z.literal(2)]);
export type Period = z.infer<typeof Period>;

export const X = z.number().min(0).max(PITCH.length);
export const Y = z.number().min(0).max(PITCH.width);

export const otherSide = (s: Side): Side => (s === 'home' ? 'away' : 'home');

/**
 * Format the football clock. `gameS` is the football clock in seconds (2nd half starts at 2700).
 * Stoppage time renders as 45+2' / 90+3'.
 */
export function formatMinute(gameS: number, period: Period): string {
  const regEnd = period === 1 ? 2700 : 5400;
  if (gameS >= regEnd) {
    const added = Math.floor((gameS - regEnd) / 60) + 1;
    return `${regEnd / 60}+${added}'`;
  }
  return `${Math.floor(gameS / 60) + 1}'`;
}

export function formatClock(gameS: number): string {
  const m = Math.floor(gameS / 60);
  const s = Math.floor(gameS % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
