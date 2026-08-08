/**
 * Channel geometry — DESIGN.md §5.3.
 *
 * The table in §5.3 is the whole of this file, expressed as data rather than as
 * branches inside a renderer. That matters for one specific reason: the three
 * lanes differ on SIX independent axes (position, scale, alpha, blur, split,
 * step offset), and a renderer that carries them as `if (lane === 'center')`
 * ends up with six places to keep in agreement instead of one row to read.
 *
 * The numbers are not decoration. **[CITED recon-trance §9]** `super_parallel`
 * proves that three full-alpha layers just show whichever drew last; the
 * stratification 1.0 / 0.30 / 0.30 is what makes the stack legible at all. And
 * **[CITED recon-hypnocli §2.2]** puts the sides at −9 dB with 0.21 reverb
 * against a dry 0 dB center — scale, alpha and blur are the visual analogues of
 * exactly that, which is why the center is unambiguously dominant rather than
 * merely first among equals.
 *
 * `offsetMs` lives here as documentation of the §5.3 default, but the value the
 * conductor actually uses is `SessionPlan.meta.laneOffsetsMs` — a plan carries
 * its own offsets so a session can be replayed exactly as it was planned. When
 * the two disagree, the plan wins.
 */

import type { LaneId, SplitMode } from '../types/frame.ts';
import { LANE_IDS } from '../types/frame.ts';

/**
 * Where a lane sits horizontally, as a fraction of the viewport width.
 *
 * A fraction rather than a pixel count because the renderer owns the viewport
 * and the engine may not measure one. §5.3 says "left third" / "screen center"
 * / "right third"; 0.5 is the center of a third.
 */
export type LanePosition = number;

/** One row of the §5.3 table. */
export interface LaneSpec {
  lane: LaneId;

  /** Horizontal anchor in [0,1] of the viewport. Left third, center, right third. */
  position: LanePosition;

  /** Center 1.0, sides 0.55. */
  scale: number;

  /**
   * The lane's alpha stratification ceiling — the value a fully-present lane
   * paints at. The envelope multiplies INTO this; it never exceeds it.
   */
  alpha: number;

  /** Center 0, sides slight. Renderer-defined units; the fixture pins 1.5. */
  blur: number;

  /** Center reads whole, sides seep one token at a time (§5.2). */
  split: SplitMode;

  /**
   * The §5.3 default step offset. The conductor prefers
   * `SessionPlan.meta.laneOffsetsMs`; this is the value that plan is built from.
   */
  offsetMs: number;

  /**
   * Whether this lane is the anchor held for the whole session.
   *
   * The sides fade in at head→middle and out at middle→tail — opening on three
   * lanes is overwhelming and closing on three is jarring (§5.3). The center is
   * the thread held the whole way, and that is a property of the lane rather
   * than a phase check scattered through the renderer.
   */
  anchor: boolean;
}

/**
 * The §5.3 table, frozen.
 *
 * Frozen because a module that mutates shared geometry turns "what does the
 * center look like" into a function of import order — the same reason
 * `DEFAULT_SESSION_OPTIONS` is frozen.
 */
export const CHANNEL_GEOMETRY: Record<LaneId, LaneSpec> = Object.freeze({
  left: Object.freeze({
    lane: 'left',
    position: 1 / 6,
    scale: 0.55,
    alpha: 0.3,
    blur: 1.5,
    split: 'WORD',
    offsetMs: 500,
    anchor: false,
  }),
  center: Object.freeze({
    lane: 'center',
    position: 0.5,
    scale: 1,
    alpha: 1,
    blur: 0,
    split: 'LINE',
    offsetMs: 1000,
    anchor: true,
  }),
  right: Object.freeze({
    lane: 'right',
    position: 5 / 6,
    scale: 0.55,
    alpha: 0.3,
    blur: 1.5,
    split: 'WORD',
    offsetMs: 0,
    anchor: false,
  }),
}) as Record<LaneId, LaneSpec>;

/** The geometry row for a lane. Total over `LaneId`, so there is no miss case. */
export function laneSpec(lane: LaneId): LaneSpec {
  return CHANNEL_GEOMETRY[lane];
}

/**
 * The lanes in paint order: sides first, center last.
 *
 * Painting the anchor last is the compositing half of the stratification claim.
 * With the center drawn first, two 0.30 layers accumulate over it and the
 * dominance the alpha ratio buys is spent again in the blend.
 */
export const PAINT_ORDER: readonly LaneId[] = Object.freeze(
  [...LANE_IDS].sort((a, b) => Number(CHANNEL_GEOMETRY[a].anchor) - Number(CHANNEL_GEOMETRY[b].anchor)),
) as readonly LaneId[];
