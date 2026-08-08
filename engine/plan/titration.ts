/**
 * The intensity curve — DESIGN.md §4.5.
 *
 * Gaussian ships. `dsm` — a trajectory/state-model scheduler — LOST TO IT ON
 * EVERY SEED in a 30-rater, 6-dimension blind study, at a fraction of the
 * annotation cost. That is the most valuable negative result in the reference
 * ecosystem, and re-deriving it would cost another rater study, so this module
 * ports the winner verbatim and does not reinvent a trajectory model.
 *
 * MEASURED by executing `titration.py:267-277`:
 *
 *   p      = min(step / max(length - 1, 1), 1.0)
 *   target = iMin + (iMax - iMin) * exp(-((p - peak)^2) / (2 * width^2))
 *
 * THE BELL SURVIVES; THE MAPPING ONTO A TIER DOES NOT. The line that used to
 * follow this one selected the "nearest tier by |tier - target|", rounding a
 * real curve onto a ladder derived from `base_points` — a field that MEASURED
 * reproduces the batch filename on 2,461/2,461 generated records. The curve is
 * now carried RAW on the tick as `intensity` and drives pacing (§4.9), which is
 * a measured effect. Nothing rounds it, and asserting unimodality on the raw
 * value is strictly sharper than on five rungs: rounding hid every wobble
 * smaller than a band.
 *
 * Progress clamping is retained though hypnoapp does not need cap-invariance,
 * because it costs nothing and keeps the schedule well-defined at
 * `step >= length`, which the conductor reaches during the tail.
 */

import type { BellOptions, TitrationMode } from '../types/config.ts';

/** Normalized progress through a session of `length` steps, clamped to [0,1]. */
export function progressAt(step: number, length: number): number {
  const p = step / Math.max(length - 1, 1);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * The gaussian, normalized to peak at exactly 1.
 *
 * Shared by all three schedules — intensity, pacing and the person mix — which
 * is the point of R19's fix being expressible as config: the three differ only
 * in their `peak`, so offsetting one is a number, not a new function.
 */
export function bell(p: number, options: BellOptions): number {
  const d = p - options.peak;
  return Math.exp(-(d * d) / (2 * options.width * options.width));
}

/**
 * The curve's value at a step, in [0,1].
 *
 * `linear` is kept as the monotone alternative named in §4.5, and it is a
 * genuine monotone ramp rather than a bell in disguise — its job is to be the
 * comparison case when a sitting asks whether the arc is doing anything.
 */
export function intensityAt(
  step: number,
  length: number,
  mode: TitrationMode,
  options: BellOptions,
): number {
  const p = progressAt(step, length);
  return mode === 'linear' ? p : bell(p, options);
}

/**
 * Round to six decimals.
 *
 * A plan is compared byte-for-byte against a committed fixture, so an IEEE tail
 * of `0.13533528323661267` would make the comparison a test of the host's
 * printf rather than of the schedule. Six decimals is far finer than any
 * consumer resolves — the value drives a dwell in whole milliseconds and a
 * shader uniform — and it makes the serialized plan stable across engines.
 */
export function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
