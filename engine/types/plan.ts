/**
 * The session plan — DESIGN.md §3, §5.1.
 *
 * hypnoapp materializes the WHOLE session before a pixel is drawn. That is the
 * biggest departure from both reference systems, which decide incrementally,
 * and it is what the visual medium buys: with a chosen dwell instead of an
 * unknown spoken line duration, five pieces of hypnocli's machinery (the
 * equalization pass, the `cap = tit_mid*2` headroom, the cap-invariance
 * contracts, the split seed streams) evaporate.
 *
 * Three properties are load-bearing and they are properties of THIS TYPE:
 *
 *   - A `SessionPlan` is a serializable value. Diffable, snapshot-testable,
 *     dumpable to a file, replayable. Every scheduling test asserts on a plan,
 *     never on a rendered frame.
 *   - It carries content BY VALUE. `TripletTick` holds the text, so trance's
 *     content-addressing gap (`Op::Text` carries no content field) is dissolved
 *     rather than worked around.
 *   - It holds no functions and no references into the corpus, so it survives
 *     `JSON.stringify` unchanged.
 */

import type { Person } from './record.ts';
import type { LaneId, SessionPhase, SplitMode } from './frame.ts';
import type { Diagnostic } from './diagnostic.ts';
import type { BedOptions, LaneOffsets, TripletMode } from './config.ts';

/** What one lane shows at one step — DESIGN.md §5.1. */
export interface LaneContent {
  /** Opaque id. The only reference key back to the corpus. */
  mantraId: string;
  /** Which variant this lane renders. The center is always `second`. */
  person: Person;
  /**
   * The RAW TEMPLATE for that person, straight from the sidecar. Substitution
   * happens in the renderer at display time (§2.4), so a rename re-renders
   * content already in flight.
   */
  text: string;
  /** How this lane drains the text. Center `LINE`, sides `WORD` (§5.2). */
  split: SplitMode;
}

/**
 * One step of the session — the unit the whole engine output is an array of.
 *
 * That the plan is an array of these is the point: inspectable, diffable,
 * snapshot-testable, and a reviewer can read a session as text before anyone
 * renders a pixel.
 */
export interface TripletTick {
  step: number;

  /** One theme, shared across all three lanes (§4.4). */
  theme: string;

  /**
   * The titration curve's value at this step, in [0,1] — DESIGN.md §4.5.
   *
   * The gaussian bell SURVIVES the deletion of the intensity axis; what died is
   * the mapping from this number onto a tier ("nearest tier by |tier - target|"),
   * because tier was derived from `base_points` and `base_points` reproduced the
   * batch filename. The curve is kept raw and drives pacing, which is a real
   * measured effect, rather than being rounded onto a fabricated ladder.
   */
  intensity: number;

  /** Varies per step; the pacing bell is phase-offset from the intensity bell (§4.9). */
  dwellMs: number;

  phase: SessionPhase;

  /** The anchor. `person` is always `second` and never titrates (§4.6). */
  center: LaneContent;
  left: LaneContent;
  right: LaneContent;
}

/** Everything about a plan that is not a tick — DESIGN.md §5.1. */
export interface SessionPlanMeta {
  /**
   * Schema tag, so a plan read from disk can be rejected rather than
   * misinterpreted by a later version.
   */
  schema: 'hypnoapp.plan.v1';

  /** The seed the plan was generated from. `(config, seed)` reproduces it exactly. */
  seed: number;

  /** `ticks.length`. Denormalized so a consumer can size buffers without the array. */
  length: number;

  /** Bookend arithmetic: `head + middle + tail === length` for every length in 1..500. */
  head: number;
  middle: number;
  tail: number;

  mode: TripletMode;

  /** Sum of every `dwellMs`, plus the quiet tail and the closing fade (§4.9). */
  totalMs: number;

  /** Sum of every `dwellMs` alone — when the last token stops. */
  contentMs: number;

  /** Quiet after the last line. A session never stops abruptly. */
  tailQuietMs: number;
  tailFadeMs: number;

  /** Per-lane offsets within a step. Sides lead; the center arrives last (§4.9). */
  laneOffsetsMs: LaneOffsets;

  /**
   * Per-lane multiplier on `dwellMs`, seeded, near 1.0. Channels free-run and
   * are never re-synchronized after their start offsets; drift is intended
   * texture, not a defect. Exactly 1.0 for every lane when `driftPct` is 0.
   */
  laneDrift: Record<LaneId, number>;

  /** The names the plan was validated against. Substitution still happens at display. */
  subjectName: string;
  operatorName: string;
}

/**
 * The materialized session.
 *
 * `{ meta, ticks, bed, diagnostics }` and nothing else — DESIGN.md §5.1.
 */
export interface SessionPlan {
  meta: SessionPlanMeta;
  ticks: TripletTick[];
  bed: BedOptions;
  /** Typed degradation record (§4.10). Empty is the healthy case, not the only one. */
  diagnostics: Diagnostic[];
}

/**
 * Why a session could not be planned — DESIGN.md §2.6, §4.2, §6.3.
 *
 * "Starve" is stronger in hypnoapp than in conditioner. conditioner skips one
 * delivery; hypnoapp is building a 20-minute continuous session, so a starving
 * slot cannot be skipped silently 400 times. The engine has the whole session in
 * hand at plan time, so:
 *
 *   any consent filter that would starve a step is a HARD PLANNING ERROR,
 *   surfaced in the form before the session begins, never at runtime.
 *
 * `fix` is not optional and is not prose-for-its-own-sake: §6.3's
 * reject-don't-repair doctrine requires a message naming the SPECIFIC fix
 * ("drop `sluttiness` from your exclusions or re-enable operator mantras first"), and a
 * required field is how that survives a refactor.
 */
export interface PlanError {
  kind: PlanErrorKind;
  /** What went wrong, in one sentence, for a log or a dump. */
  message: string;
  /** What the user can change to make it plannable. Shown in the form verbatim. */
  fix: string;
  /** The step the failure attaches to, when it is positional. */
  step?: number;
  /** The lane, when only one starved. */
  lane?: LaneId;
  /** The theme, when the failure is a property of one block. */
  theme?: string;
}

export type PlanErrorKind =
  /** Consent filters left nothing at all. The empty-pool case. */
  | 'empty-pool'
  /** No themes enrolled. Allowed as a config state; simply not plannable. */
  | 'no-themes'
  /** A theme cannot field `CHANNEL_COUNT` distinct candidates (§4.3). */
  | 'theme-cannot-serve-triplet'
  /** An induction or emergence theme names a block the corpus does not have (§4.2). */
  | 'unknown-bookend-theme'
  /** No induction themes, or none survived the filters. The head has nothing to play. */
  | 'no-induction-content'
  /** No emergence themes, or none survived. The tail has nothing to play. */
  | 'no-emergence-content'
  /** A theme is designated both induction and emergence — a silent-drop trap (§4.2). */
  | 'bookend-theme-conflict'
  /** A theme appears in both `themes` and `excludedThemes` (§6.3). */
  | 'theme-enrolled-and-excluded'
  /** `SessionOptions` failed validation — `width <= 0`, `peak` outside [0,1], etc. */
  | 'invalid-options'
  /** `targetDurationMs` yields a length below 1. */
  | 'duration-too-short';
