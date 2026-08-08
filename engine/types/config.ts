/**
 * What a user chose, and what the engine was tuned to — DESIGN.md §2.6, §4, §6.1.
 *
 * The split is load-bearing and is not a stylistic one:
 *
 *   `UserConfig`     what a person selected on the setup screen. Consent lives
 *                    here. Every field is something a user can see and change.
 *   `SessionOptions` how the engine is tuned. Every number the base design
 *                    would have written as a module constant is a field here
 *                    instead, so a bad sitting is a config change rather than
 *                    an engine rebuild (DESIGN.md §4.6, risk R11).
 *
 * Both are plain serializable data. A session is reproducible from
 * `(corpus, config, options, seed)` and nothing else.
 */

/** DESIGN.md §4.7. `parallel` is the default; both are acceptance-tested paths. */
export type TripletMode = 'parallel' | 'unison';

/**
 * DESIGN.md §4.5. Gaussian ships as the default; `linear` is kept as the
 * monotone alternative. `arc`, `random`, `tier_gate` and `dsm` are deliberately
 * absent — `dsm` lost to gaussian on every seed in a 30-rater blind study, and
 * re-deriving that result would cost another rater study.
 */
export type TitrationMode = 'gaussian' | 'linear';

/** The names substituted into `{subject}` and `{operator}` at display time. */
export interface Names {
  subject: string;
  operator: string;
}

/**
 * The user's choices — DESIGN.md §6.1.
 *
 * Consent boundaries (§2.6) are `themes`, `excludedThemes` and
 * `allowOperator`. They are NEVER silently relaxed: if they empty the pool,
 * the slot starves and that is a hard planning error surfaced before playback.
 * `blocklist` is a preference and IS relaxed as a last resort rather than
 * starving. The ordering is normative.
 */
export interface UserConfig {
  /**
   * Enrolled themes. An empty list is ALLOWED (§6.3): it is visible and simply
   * blocks Start. The guard targets the silent trap, not the obvious one.
   */
  themes: string[];

  /**
   * Excluded themes — "yucks". A separate, unbounded list, checked against a
   * mantra's FULL tag list rather than the bucket it was collected under. This
   * is what closes the cross-tag leak where a mantra tagged {A,B} reaches a
   * user enrolled in A who wants nothing from B.
   *
   * THE PRIMARY CONSENT SURFACE. It carries alone what used to be split with a
   * ceiling on intensity, and the vocabulary is built so that it can: heavy
   * register is a flat tag (`intense`) alongside every other tag, so "nothing
   * absolute or permanent" is an exclusion like any other rather than a rung on
   * a ladder. The ceiling it replaced ordered records by `base_points`, a number
   * that MEASURED reproduced the batch filename on 2,461/2,461 generated
   * records — a user who set a cap was protected by a filename.
   *
   * A theme in both lists is rejected at the form (§6.3), not reconciled here.
   */
  excludedThemes: string[];

  /** When false, every record with `markers.has_operator` is filtered out. */
  allowOperator: boolean;

  /** Substituted at display time, never at selection or storage time. */
  names: Names;

  /** Wall-clock target. `length` is derived from this via mean dwell (§4.9). */
  targetDurationMs: number;

  mode: TripletMode;

  /**
   * Ids the user does not want. A PREFERENCE, not a consent boundary: when
   * honoring it would empty a slot the blocklist is ignored for that draw and
   * the plan carries a `blocklist-relaxed` diagnostic.
   */
  blocklist: string[];
}

/**
 * The intensity bell — DESIGN.md §4.5. Ported verbatim from `titration.py`.
 *
 * `target = iMin + (iMax - iMin) * exp(-((p - peak)^2) / (2 * width^2))`
 * with `p` clamped to [0,1] so the schedule stays well-defined at `step >= length`.
 */
export interface BellOptions {
  /** Where the peak sits in normalized progress. Validation: 0 <= peak <= 1. */
  peak: number;
  /** Spread. Validation: width > 0. */
  width: number;
}

/**
 * Phase bookends — DESIGN.md §4.2.
 *
 * Designated induction and emergence themes are removed from the titration pool
 * ENTIRELY. This is the structural fix for the measured "Wide awake, rested and
 * present at line 2" artifact, which every rater caught: intensity is a scalar,
 * session position is a direction, and a one-dimensional model cannot tell
 * "low because we are inducting" from "low because we are emerging".
 */
export interface BookendOptions {
  /** Themes that play the head. Unknown names are a hard planning error. */
  inductionThemes: string[];
  /** Themes that play the tail. A theme in both lists is a hard planning error. */
  emergenceThemes: string[];
  /** Fraction of `length` per bookend. Default 0.10. */
  fraction: number;
}

/**
 * Pacing — DESIGN.md §4.9.
 *
 * Dwell is NOT constant; a constant dwell is a metronome. The dwell bell's peak
 * is offset LATER than the intensity bell's, deliberately: with a shared curve
 * the fastest pacing, deepest tier and highest third-person share all arrive at
 * the same instant, which is where a session tips from absorbing to
 * overwhelming (risk R19).
 */
export interface PacingOptions {
  /** Induction and emergence: slow, spacious. */
  dwellMaxMs: number;
  /** Peak: tight, insistent. */
  dwellMinMs: number;
  /** Offset from the intensity bell's 0.5. */
  dwellBell: BellOptions;
  /**
   * Per-channel `stepMs` jitter, seeded. Preserved as documented reference
   * behavior (channels free-run and never re-synchronize) but tunable to 0:
   * the perceptual claim comes from an audio system and may not transfer to
   * three visible text lanes (risk R4). Not a ship gate.
   */
  driftPct: number;
  /** Quiet after the last line, before the fade. */
  tailQuietMs: number;
  /** The closing fade. A session never stops abruptly. */
  tailFadeMs: number;
  /** Per-lane offsets within a step; sides lead, the center anchors (§4.9). */
  laneOffsetsMs: LaneOffsets;
}

export interface LaneOffsets {
  /** Leads. */
  right: number;
  left: number;
  /** Arrives last and stays. */
  center: number;
}

/**
 * The person schedule — DESIGN.md §4.6.
 *
 * The center is always `second` and is not scheduled. The sides drift
 * `first -> named` and then BACK toward `first`: a session that leaves you
 * dissociated is a session you resent afterward, and the drift out is what
 * makes the drift in safe to accept.
 */
export interface PersonOptions {
  /** Ceiling on P(named) at the bell's peak. */
  peakMix: number;
  /** The named-share bell. Peaks slightly before the dwell bell. */
  bell: BellOptions;
  /**
   * Steps between person re-rolls. Sampling every step produces shimmer —
   * I / she / I / I / she — which reads as a rendering bug rather than a drift.
   */
  pivotEvery: number;
  /**
   * Offset applied to the right lane's pivot schedule so the two sides pivot
   * independently, and mid-session one side sits in "I" while the other sits in
   * "{subject}" — the two readings of yourself coexisting.
   */
  sidePivotOffset: number;
  /**
   * How strongly side lanes prefer `invariant` records when P(named) is near
   * 0.5. The 87 person-free records get a scheduled job at the drift midpoint
   * rather than being a remainder: the triplet passes through a person-free
   * moment on its way from "I" to "{subject}", which turns the shift from a
   * switch into a hinge. 0 disables the preference.
   */
  neutralBias: number;
}

/**
 * The theme walk — DESIGN.md §4.4.
 *
 * One theme shared across all three lanes at any step — that is what makes a
 * triplet read as one utterance in three voices rather than three unrelated
 * statements. The walk holds, then pivots; it is not a per-step redraw, because
 * a theme that changes every 3.4 seconds is a shuffle rather than an arc.
 */
export interface ThemeWalkOptions {
  /** Steps a theme holds before a pivot. Default 8, about 27s at 3400ms. */
  themeHold: number;
  /**
   * How strongly the pivot prefers themes whose surviving tier distribution
   * covers the current target tier. Uniform-random theme draw is the named
   * parity break: under it the arc moves only through difficulty, never through
   * content. 0 makes the pivot uniform.
   */
  coverageWeight: number;
}

/** DESIGN.md §4.8 — the Shuffler's sliding suppression window. */
export interface ShufflerOptions {
  /**
   * `window = clamp(floor(blockSize * windowFraction), windowMin, windowMax)`.
   * Sized relative to block size rather than copying the literal 6: when
   * `window >= n` suppression saturates and degrades toward LRU-with-random-ties.
   */
  windowFraction: number;
  windowMin: number;
  windowMax: number;
  /** Below this block size, emit a `shuffler-degraded` diagnostic. */
  degradedBelow: number;
}

/** The audio bed carried on the plan — DESIGN.md §1.4. */
export interface BedOptions {
  preset: string;
  gainDb: number;
}

/**
 * Engine tuning — every knob the base design would have hardcoded.
 *
 * Defaults are `DEFAULT_SESSION_OPTIONS`. A caller overrides what it needs and
 * inherits the rest; nothing here is read from a module-level constant.
 */
export interface SessionOptions {
  titration: TitrationMode;
  /** The intensity bell. Ported defaults: peak 0.5, width 0.25. */
  intensityBell: BellOptions;
  bookends: BookendOptions;
  pacing: PacingOptions;
  person: PersonOptions;
  themeWalk: ThemeWalkOptions;
  shuffler: ShufflerOptions;
  bed: BedOptions;
}

/**
 * The defaults, in one place, all measured or cited in DESIGN.md.
 *
 * Frozen because a module that mutates a shared default turns determinism into
 * a function of import order.
 */
export const DEFAULT_SESSION_OPTIONS: SessionOptions = Object.freeze({
  titration: 'gaussian',
  intensityBell: Object.freeze({ peak: 0.5, width: 0.25 }),
  bookends: Object.freeze({
    inductionThemes: Object.freeze(['induction']) as unknown as string[],
    emergenceThemes: Object.freeze(['emergence']) as unknown as string[],
    fraction: 0.1,
  }),
  pacing: Object.freeze({
    dwellMaxMs: 4200,
    dwellMinMs: 2900,
    dwellBell: Object.freeze({ peak: 0.62, width: 0.25 }),
    driftPct: 0.04,
    tailQuietMs: 2500,
    tailFadeMs: 1500,
    laneOffsetsMs: Object.freeze({ right: 0, left: 500, center: 1000 }),
  }),
  person: Object.freeze({
    peakMix: 0.85,
    bell: Object.freeze({ peak: 0.55, width: 0.28 }),
    pivotEvery: 4,
    sidePivotOffset: 2,
    neutralBias: 0.5,
  }),
  themeWalk: Object.freeze({ themeHold: 8, coverageWeight: 1 }),
  shuffler: Object.freeze({
    windowFraction: 0.5,
    windowMin: 3,
    windowMax: 12,
    degradedBelow: 8,
  }),
  bed: Object.freeze({ preset: 'drone', gainDb: -18 }),
}) as SessionOptions;

/** Mean dwell implied by a pacing config — `length = round(target / meanStep)`. */
export const MEAN_DWELL_MS = 3400;
