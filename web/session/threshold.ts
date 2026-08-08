/**
 * The threshold — DESIGN.md §6.5.
 *
 * ```
 * Begin -> screen darkens (800ms) -> bed fades in (2s) -> field appears (2s)
 *       -> first center line cross-fades in
 * ```
 *
 * §6.5's claim is that the 3-6 seconds between Begin and the first line are 0%
 * of the value and 100% of the abandonment, and its mechanic is that **there is
 * nothing to wait for**: the plan is computed, the pool filtered, the first
 * variants resolved, the fonts loaded and the shader compiled while the user is
 * still reading their sample on the setup screen. **So there is no spinner, and
 * this file contains no loading state at all.** It is a pure function of
 * elapsed time onto three opacities. If anything here ever had to await
 * something, the fix would be upstream on the setup screen, not a spinner here.
 *
 * WHY A VALUE AND NOT A CSS ANIMATION. The threshold's phases have to compose
 * with the session clock — a user who backgrounds the tab 400ms into the
 * darken must return to a threshold that resumes, not one that finished in the
 * background while the session sat still. Driving it from the same accumulated
 * `elapsedMs` as everything else makes that automatic. A CSS animation runs off
 * the compositor's own clock and would desynchronize the moment the session
 * paused.
 *
 * The stages OVERLAP on purpose. The bed starts fading in while the darkening
 * finishes, and the field while the bed finishes; §5.6 wants every appearance
 * to be a cross-fade of ≥400ms and nothing in the sequence to land as a step.
 * The numbers below are §6.5's, read as start times rather than as a queue.
 */

import { ease } from '../../engine/render/ease.ts';

/** §6.5's timings. Exported so a test asserts the spec's numbers, not a copy. */
export const THRESHOLD_DARKEN_MS = 800;
export const THRESHOLD_BED_MS = 2000;
export const THRESHOLD_FIELD_MS = 2000;

/**
 * When the first center line is allowed to appear.
 *
 * Darken, then bed, then field: 800 + 2000 + 2000 = 4800ms. The text's own
 * cross-fade runs on top of this, which is what puts the first line inside
 * §6.5's 0:00-0:06 window rather than at its edge.
 */
export const THRESHOLD_TOTAL_MS = THRESHOLD_DARKEN_MS + THRESHOLD_BED_MS + THRESHOLD_FIELD_MS;

/**
 * The reduced-motion threshold (§5.6, C9).
 *
 * Shortened but NOT removed. A session that begins by cutting straight to three
 * lanes of text is the jarring open the threshold exists to prevent, and a user
 * who asked for less motion did not ask to be startled. Each stage collapses to
 * the 200ms cross-fade C9 specifies.
 */
export const REDUCED_THRESHOLD_STAGE_MS = 200;

/** The three opacities the threshold drives, at one instant. */
export interface ThresholdState {
  /**
   * How dark the screen is, in [0,1]. 1 is fully darkened.
   *
   * This runs FIRST and alone: the 800ms of darkening is the beat that says
   * "we have started" before anything else moves, and it is what makes the
   * bed's arrival feel like it emerged rather than switched on.
   */
  darken: number;
  /** Bed gain envelope in [0,1]. Multiplies the bed's own target gain. */
  bed: number;
  /** Backdrop opacity in [0,1]. */
  field: number;
  /**
   * Text master multiplier in [0,1].
   *
   * Zero until the field has arrived: the first center line cross-fades in
   * against a field that is already there, never onto a black screen.
   */
  text: number;
  /** True once the whole sequence has run. */
  complete: boolean;
}

export interface ThresholdOptions {
  /** Collapse each stage to 200ms (§5.6). */
  reducedMotion?: boolean;
}

/** One stage's start and duration, resolved for the active motion setting. */
interface Stage {
  startMs: number;
  durationMs: number;
}

interface ThresholdSchedule {
  darken: Stage;
  bed: Stage;
  field: Stage;
  totalMs: number;
}

/**
 * Resolve §6.5's timings for the active motion setting.
 *
 * Stages start when the PREVIOUS one starts plus its duration, which is what
 * makes the sequence read as one gesture: the ramps butt against each other,
 * and each easing's shape carries the overlap that keeps them from stepping.
 */
export function thresholdSchedule(options: ThresholdOptions = {}): ThresholdSchedule {
  if (options.reducedMotion) {
    const d = REDUCED_THRESHOLD_STAGE_MS;
    return {
      darken: { startMs: 0, durationMs: d },
      bed: { startMs: d, durationMs: d },
      field: { startMs: d * 2, durationMs: d },
      totalMs: d * 3,
    };
  }
  return {
    darken: { startMs: 0, durationMs: THRESHOLD_DARKEN_MS },
    bed: { startMs: THRESHOLD_DARKEN_MS, durationMs: THRESHOLD_BED_MS },
    field: { startMs: THRESHOLD_DARKEN_MS + THRESHOLD_BED_MS, durationMs: THRESHOLD_FIELD_MS },
    totalMs: THRESHOLD_TOTAL_MS,
  };
}

function stageProgress(stage: Stage, elapsedMs: number): number {
  if (elapsedMs <= stage.startMs) return 0;
  if (stage.durationMs <= 0) return 1;
  const p = (elapsedMs - stage.startMs) / stage.durationMs;
  return p >= 1 ? 1 : p;
}

/**
 * The threshold at one instant. Pure; called from the rAF loop every frame.
 *
 * Each stage carries its own ease, chosen for what it does rather than for
 * uniformity:
 *
 *   darken  `early` — the screen commits to darkening immediately and settles,
 *           so Begin has a response inside one frame and never feels ignored.
 *   bed     `linear` — a gain ramp that is eased is a gain ramp that swells,
 *           and the bed should arrive without a shape of its own.
 *   field   `early` — the field is present before it is finished, so the first
 *           line has something to land against rather than appearing over black.
 */
export function thresholdAt(elapsedMs: number, options: ThresholdOptions = {}): ThresholdState {
  const schedule = thresholdSchedule(options);
  const t = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;

  const darken = ease('early', stageProgress(schedule.darken, t));
  const bed = stageProgress(schedule.bed, t);
  const field = ease('early', stageProgress(schedule.field, t));

  // The text gate opens only once the field has fully arrived. Not eased: this
  // is a gate, and the cross-fade the first line gets is its own envelope's.
  const text = t >= schedule.totalMs ? 1 : 0;

  return { darken, bed, field, text, complete: t >= schedule.totalMs };
}
