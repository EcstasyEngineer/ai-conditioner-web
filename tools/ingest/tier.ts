/**
 * Tiering — CORPUS_SPEC.md §5.3.
 *
 * Ported from conditioner `utils/scoring.py:15-28`. Boundaries are
 * lower-inclusive / upper-exclusive: 20-44 basic, 45-74 light, 75-109
 * moderate, 110-149 deep, 150+ extreme. Tier is DERIVED, never stored.
 */

import type { Tier } from './types.ts';

const TIER_BASIC_MAX = 45;
const TIER_LIGHT_MAX = 75;
const TIER_MODERATE_MAX = 110;
const TIER_DEEP_MAX = 150;

export const TIER_ORDER: readonly Tier[] = [
  'basic',
  'light',
  'moderate',
  'deep',
  'extreme',
] as const;

export function getTier(points: number): Tier {
  if (points >= TIER_MODERATE_MAX) {
    return points >= TIER_DEEP_MAX ? 'extreme' : 'deep';
  }
  if (points >= TIER_LIGHT_MAX) return 'moderate';
  if (points >= TIER_BASIC_MAX) return 'light';
  return 'basic';
}

export function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIER_ORDER as readonly string[]).includes(v);
}
