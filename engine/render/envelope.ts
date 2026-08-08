/**
 * The per-line visual envelope — `env in X hold Y out Z`, DESIGN.md §5.2.
 *
 * **[CITED recon-trance §9]** takes this one specifically for what it is NOT:
 * a piecewise-linear alpha trapezoid with a TRUE ABSENT TAIL, "unlike `fade
 * inout`'s whole-clock triangle". The difference is the whole point of porting
 * it. A whole-clock triangle stretches to fill whatever span it is given, so a
 * token is always fading in or out and never simply present; and it is never
 * absent either, so three lanes are permanently smeared over each other.
 *
 * The trapezoid instead says: ramp in over `inMs`, sit at full for `holdMs`,
 * ramp out over `outMs`, and then be GONE. Past `inMs + holdMs + outMs` the
 * value is exactly 0 — not 0.02, not "very small". That exact zero is what the
 * `.active` gate reads to decide whether the lane paints at all, and it is why
 * a lane can be silent inside a step it owns rather than only between steps.
 *
 * Everything here is in milliseconds and pure. There is no clock: the caller
 * says how far into the token it is, and the envelope answers.
 */

import { type Ease, clamp01, ease } from './ease.ts';

/**
 * `env in X hold Y out Z`, plus the ease each ramp runs under.
 *
 * The ramps ease independently because they do different jobs: a line that
 * arrives with `early` is present almost at once and then settles, while one
 * that leaves with `early` on its out-ramp lingers and then goes. §5.6 requires
 * every appearance and disappearance to be a cross-fade of ≥400ms, so the
 * shape of the ramp is a perceptual decision, not a formality.
 */
export interface Envelope {
  /** Ramp-in duration. Zero means "present immediately". */
  inMs: number;
  /** Full-value plateau between the ramps. */
  holdMs: number;
  /** Ramp-out duration. Zero means "gone the instant the hold ends". */
  outMs: number;
  /** Ease applied to the in-ramp's normalized progress. */
  inEase: Ease;
  /** Ease applied to the out-ramp's normalized progress. */
  outEase: Ease;
}

/**
 * The §5.6 floor: nothing appears or disappears faster than this.
 *
 * A hard number rather than a guideline because it is the one accessibility
 * constraint the render model can enforce by itself — M4 owns the reduced-motion
 * override, but no envelope built here may cut.
 */
export const MIN_CROSSFADE_MS = 400;

/**
 * A default envelope for a token of a given dwell.
 *
 * The ramps are a fixed 400ms each — the §5.6 floor — and the hold absorbs
 * whatever is left. That ordering matters: sizing the ramps as a FRACTION of
 * dwell would make them shrink exactly when the pacing tightens, so the frames
 * that most need a soft edge would get the hardest one.
 *
 * When the dwell is too short to carry both ramps and any hold, the ramps are
 * scaled down together and the hold goes to zero — a triangle, but a bounded
 * one that still ends in a true absent tail.
 */
export function defaultEnvelope(dwellMs: number): Envelope {
  const span = Math.max(0, dwellMs);
  const wanted = MIN_CROSSFADE_MS * 2;
  const ramp = span >= wanted ? MIN_CROSSFADE_MS : span / 2;
  return {
    inMs: ramp,
    holdMs: Math.max(0, span - ramp * 2),
    outMs: ramp,
    inEase: 'early',
    outEase: 'late',
    };
}

/** Total span the envelope occupies. Past this the value is exactly 0. */
export function envelopeSpanMs(env: Envelope): number {
  return Math.max(0, env.inMs) + Math.max(0, env.holdMs) + Math.max(0, env.outMs);
}

/**
 * The envelope's value in [0,1] at `tMs` into the token.
 *
 * Exactly 0 before the envelope starts and exactly 0 at or past its end. The
 * "at or past" is deliberate: an envelope's final instant is absence, not the
 * last sliver of the out-ramp, so two consecutive tokens never both paint.
 */
export function envelopeAt(env: Envelope, tMs: number): number {
  const inMs = Math.max(0, env.inMs);
  const holdMs = Math.max(0, env.holdMs);
  const outMs = Math.max(0, env.outMs);
  const span = inMs + holdMs + outMs;

  if (!Number.isFinite(tMs) || tMs < 0) return 0;
  if (span <= 0) return 0;
  if (tMs >= span) return 0;

  if (tMs < inMs) return ease(env.inEase, tMs / inMs);
  if (tMs < inMs + holdMs) return 1;

  // The out-ramp runs 1 -> 0. The ease is applied to elapsed progress and then
  // inverted, so `late` on the way out means the value lingers high and then
  // drops, mirroring what `late` means on the way in.
  const outProgress = (tMs - inMs - holdMs) / outMs;
  return 1 - ease(env.outEase, outProgress);
}

/**
 * Whether the envelope is sounding at `tMs` — the `.active` gate's envelope half.
 *
 * Separate from `envelopeAt(...) > 0` in intent even though it agrees with it:
 * a caller asking "should this lane exist in the DOM" is asking a structural
 * question, and reading it off a float comparison is how a lane ends up kept
 * around at zero opacity waiting to flash (§5.2).
 */
export function envelopeActive(env: Envelope, tMs: number): boolean {
  const span = envelopeSpanMs(env);
  return Number.isFinite(tMs) && tMs >= 0 && tMs < span && span > 0;
}

/**
 * Composite an envelope value against a lane's alpha ceiling.
 *
 * The stratification is a MULTIPLIER, never a floor: a side lane at its
 * envelope peak reaches 0.30 and no more (§5.2). Written once here so the
 * ceiling cannot be applied twice or skipped in one branch.
 */
export function compositeAlpha(envelopeValue: number, laneAlpha: number): number {
  return clamp01(envelopeValue) * clamp01(laneAlpha);
}
