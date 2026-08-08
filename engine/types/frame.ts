/**
 * The frame seam — DESIGN.md §3, §5.3, risk R7.
 *
 * This file is the reason M2 and M4 can be built at the same time by two people
 * who never speak. M2 exports `frameAt(plan, elapsedMs): FrameState`; M3
 * exports `renderChannel(...): ChannelFrame`; M4 consumes both. If either of
 * them owned these types the other would block on a definition it could not
 * write — which is exactly the failure the base design shipped: `FrameState`
 * was named "the seam that makes the two biggest modules parallelizable" and
 * never given a type in 1,299 lines.
 *
 * So both types live here, in M1, and both are frozen before either module
 * starts. `fixtures/frame.reference.json` is a hand-authored instance of
 * `FrameState`, which is what lets M4 be built and visually tuned before M2
 * computes a single step.
 */

/**
 * The three lanes — DESIGN.md §5.3.
 *
 * `right` leads, `left` follows at +500ms, `center` anchors at +1000ms. The
 * naming is spatial, not ordinal: the offsets are a separate fact carried on
 * `SessionPlan.laneOffsetsMs`.
 */
export type LaneId = 'left' | 'center' | 'right';

/**
 * Lane order for iteration, so every consumer walks them the same way and a
 * serialized frame has a stable key order.
 */
export const LANE_IDS: readonly LaneId[] = ['left', 'center', 'right'] as const;

/**
 * Three. Named because it appears in the adjacency-widening arithmetic as "the
 * number of distinct draws a step needs", where a bare `3` reads as a magic
 * number and would drift from the lane list if either changed.
 */
export const CHANNEL_COUNT = 3 as const;

/** Which phase of the session an elapsed time falls in — DESIGN.md §4.1. */
export type SessionPhase = 'head' | 'middle' | 'tail';

/**
 * The queue-drain split — DESIGN.md §5.2, lifted from trance's `change_text`.
 *
 * Each firing pops one token; a new line is pulled only when the queue empties.
 * With `WORD` a five-word mantra displays word-by-word over five firings; with
 * `LINE` the whole phrase is one token. Same mechanism, one flag.
 *
 * The center defaults to `LINE` — it is the anchor and you read it whole. The
 * sides default to `WORD` — they are peripheral, and they seep.
 */
export type SplitMode = 'WORD' | 'LINE';

/**
 * What one lane looks like at one instant.
 *
 * Produced by M3's `renderChannel`, carried inside `FrameState`, consumed by
 * M4. Everything here is a presentation fact; nothing here decides WHICH
 * mantra — that was settled by the planner before a frame was drawn
 * (DESIGN.md §3.1, "the timeline is the content register").
 */
export interface ChannelFrame {
  lane: LaneId;

  /**
   * The text to paint, already substituted and already split to the token this
   * firing shows. May be the empty string when the lane is between tokens.
   */
  text: string;

  /**
   * The raw template this token came from, unsubstituted. Carried so a renderer
   * can re-substitute without reaching back to the plan, and so a debug dump
   * can show what the corpus actually holds.
   */
  template: string;

  /** The record this lane is showing. Opaque; never reconstructed from text. */
  mantraId: string;

  /**
   * The `.active` gate — DESIGN.md §5.2. Every draw is AND-ed with this. When
   * false the lane paints NOTHING; it does not paint transparent text.
   *
   * This is separate from `alpha === 0` on purpose: a lane can be active and
   * momentarily transparent mid-cross-fade, and an inactive lane must not be
   * kept in the DOM waiting to flash.
   */
  active: boolean;

  /**
   * Composited opacity in [0,1] — the envelope's value at this instant, already
   * multiplied by the lane's stratification (center 1.0, sides 0.30).
   *
   * Alpha stratification is not decoration: three full-alpha layers just show
   * whichever drew last, and 1.0 / 0.30 / 0.30 is what makes the stack legible.
   */
  alpha: number;

  /** Center 1.0, sides 0.55 (§5.3). */
  scale: number;

  /** Center 0, sides slight. In renderer-defined units. */
  blur: number;

  /** How this lane is draining its queue this step. */
  split: SplitMode;

  /**
   * Milliseconds this token is being held beyond its natural dwell, from an
   * inline `[500]` / `[1.5s]` pause marker (§4.9). Zero when there is no hold.
   */
  holdMs: number;
}

/**
 * Everything the renderers need at one instant — the conductor's whole output.
 *
 * A `FrameState` is a plain value: no methods, no references back into the
 * plan, structurally cloneable. Tests call `frameAt` with
 * `elapsedMs = 0, 100, 200, ...`; the browser calls it from
 * `requestAnimationFrame`. Neither knows about the other.
 */
export interface FrameState {
  /** The clock reading this frame was computed for. */
  elapsedMs: number;

  /** Normalized session progress in [0,1], clamped. Drives the backdrop uniforms. */
  progress: number;

  /**
   * The plan step the CENTER lane is on. Sides may be on a neighbouring step,
   * because lanes free-run against their own offsets and drift and are never
   * re-synchronized (§4.9) — so this is the anchor's step, not a global one.
   */
  step: number;

  phase: SessionPhase;

  /** The theme shared by all three lanes at this step (§4.4). */
  theme: string;

  /** Keyed by lane so a consumer can address one without scanning. */
  channels: Record<LaneId, ChannelFrame>;

  /** Master fade in [0,1]: the threshold fade-in and the closing fade (§6.5, §6.6). */
  masterAlpha: number;

  /** What the bed should be doing. The engine never touches audio itself. */
  bed: BedFrame;

  /** True once the last token has drained and the tail has run out (§4.9). */
  ended: boolean;
}

/**
 * The bed's state at one instant — DESIGN.md §1.4.
 *
 * The engine describes; M6 implements. `pulseHz` is shared with the backdrop so
 * visuals and entrainment run off one clock (§5.5).
 */
export interface BedFrame {
  /** Whether the bed should be sounding at all. */
  active: boolean;
  /** Gain in dB, already faded. */
  gainDb: number;
  /** Isochronic pulse rate. Nothing in the field exceeds ~3Hz (§5.6). */
  pulseHz: number;
}
