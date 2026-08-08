// CLEAN FIXTURE — this file must produce ZERO lint errors.
//
// A rule that rejects everything is as useless as one that rejects nothing.
// This is what legal engine code looks like: relative imports, time as a
// parameter, randomness from a seeded generator, locally-bound names that
// happen to collide with platform globals.

// @ts-nocheck

import { mulberry32 } from './rng';
import type { SessionPlan } from './types';

/** Time enters ONLY as a parameter. */
export function frameAt(plan: SessionPlan, elapsedMs: number): number {
  return elapsedMs % plan.totalMs;
}

/** Randomness enters ONLY as a seeded generator. */
export function pick<T>(items: readonly T[], seed: number): T {
  const rng = mulberry32(seed);
  return items[Math.floor(rng() * items.length)];
}

/** A local binding named after a global is not a platform reference. */
export function shadowed(): number {
  const performance = { now: () => 0 };
  const window = { width: 100 };
  return performance.now() + window.width;
}

/** A property named `document` on a plain object is not the DOM. */
export function propertyNames(): string {
  const record = { document: 'a', window: 'b', fetch: 'c' };
  return record.document + record.window + record.fetch;
}

/** `new Date(ms)` with an argument is a pure conversion, not a clock read. */
export function fromEpoch(ms: number): number {
  return new Date(ms).getUTCFullYear();
}
