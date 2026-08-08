/**
 * Progress-driven uniforms — DESIGN.md §5.5.
 *
 * The shaders ship with their parameters as file-scope constants
 * (`float num_arms = 3.0;`). Making them uniforms is what turns a loop into a
 * backdrop that follows the session: the field opens wide and slow, tightens
 * through the peak, and unwinds for the emergence.
 *
 * Every curve here is expressed in the SAME curve/ease vocabulary the rest of
 * the system uses (§4.5's bell, §5.2's eases), so the backdrop arcs with the
 * plan instead of running its own independent animation. This module is pure
 * arithmetic over `progress` and holds no GL state, so the whole mapping is
 * unit-testable without a canvas.
 */

/** The five parameters lifted out of the shader sources. */
export interface ShaderUniforms {
  num_arms: number;
  rotation_speed: number;
  spiral_angle: number;
  pattern_speed: number;
  warp_speed: number;
}

/** The endpoints a uniform travels between, and how it gets there. */
export interface UniformCurve {
  /** Value at progress 0 and 1 — the session opens and closes in the same place. */
  rest: number;
  /** Value at the bell's peak. */
  peak: number;
}

export interface UniformSchedule {
  num_arms: UniformCurve;
  rotation_speed: UniformCurve;
  spiral_angle: UniformCurve;
  pattern_speed: UniformCurve;
  warp_speed: UniformCurve;
  /** Where the visual peak sits in normalized progress. */
  bellPeak: number;
  /** Spread of the visual bell. */
  bellWidth: number;
}

/**
 * Defaults.
 *
 * The visual bell peaks slightly AFTER the intensity bell's 0.5, matching the
 * pacing bell's 0.62 offset (§4.9): the field should still be tightening as the
 * language starts to let go, so the two do not crest on the same instant.
 *
 * `num_arms` stays integral-ish and low; the shader's `atan` fan multiplies it,
 * and a high arm count at speed is exactly the strobe §5.6 forbids.
 */
export const DEFAULT_UNIFORM_SCHEDULE: Readonly<UniformSchedule> = Object.freeze({
  num_arms: Object.freeze({ rest: 2, peak: 4 }),
  rotation_speed: Object.freeze({ rest: 0.5, peak: 1.6 }),
  spiral_angle: Object.freeze({ rest: 35, peak: 70 }),
  pattern_speed: Object.freeze({ rest: 0.15, peak: 0.5 }),
  warp_speed: Object.freeze({ rest: 0, peak: 0.35 }),
  bellPeak: 0.62,
  /**
   * MEASURED, and narrower than the intensity bell's 0.25 on purpose.
   *
   * At width 0.28 the bell still reads 0.40 at progress 1.0 — the field would
   * be turning at roughly half speed through the emergence, which is the visual
   * equivalent of the "wide awake at line 2" artifact §4.2 exists to prevent.
   * At 0.18 the bell is 0.003 at the open and 0.108 at the close, so the field
   * is genuinely at rest at both ends while still sitting at 0.80 through the
   * middle of the session.
   */
  bellWidth: 0.18,
}) as Readonly<UniformSchedule>;

/**
 * The gaussian bell — the same shape §4.5 titrates with.
 *
 * `exp(-((p - peak)^2) / (2*width^2))`, with `p` clamped so the schedule stays
 * well-defined outside [0,1].
 */
export function bell(progress: number, peak: number, width: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const d = p - peak;
  return Math.exp(-(d * d) / (2 * width * width));
}

/** §5.2's `late` ease: dwells at the start. */
export function easeLate(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t * t * t;
}

/** §5.2's `early` ease: dwells at the end. */
export function easeEarly(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The uniforms at a given progress.
 *
 * Unimodal by construction: every parameter rides one shared bell, so the field
 * cannot tighten while the rotation slackens. One curve, five expressions of it
 * — which is what makes the backdrop read as a single gesture.
 */
export function uniformsAt(
  progress: number,
  schedule: Readonly<UniformSchedule> = DEFAULT_UNIFORM_SCHEDULE,
): ShaderUniforms {
  const t = bell(progress, schedule.bellPeak, schedule.bellWidth);
  return {
    num_arms: lerp(schedule.num_arms.rest, schedule.num_arms.peak, t),
    rotation_speed: lerp(schedule.rotation_speed.rest, schedule.rotation_speed.peak, t),
    spiral_angle: lerp(schedule.spiral_angle.rest, schedule.spiral_angle.peak, t),
    pattern_speed: lerp(schedule.pattern_speed.rest, schedule.pattern_speed.peak, t),
    warp_speed: lerp(schedule.warp_speed.rest, schedule.warp_speed.peak, t),
  };
}

/**
 * The hard motion ceiling — DESIGN.md §5.6.
 *
 *   "Nothing in the field exceeds ~3 Hz. No strobing, ever."
 *
 * This is a SAFETY limit, not a tuning preference, so it is applied as a clamp
 * over whatever the schedule produced rather than left to the schedule to
 * respect. A future edit that raises `rotation_speed.peak` to something
 * exciting cannot reintroduce a strobe.
 */
export const MAX_FIELD_HZ = 3.0;

/**
 * Rotational frequency, in Hz, that a given `rotation_speed` produces.
 *
 * In the shader, `angle += rotation_speed * iTime` inside a `mod(_, 2*pi)`, so
 * the pattern repeats every `2*pi / rotation_speed` seconds. With `num_arms`
 * arms the perceived flicker rate at a fixed point is that many times faster —
 * an arm passing is the event an eye actually counts, which is why arm count
 * belongs in this calculation and not just the rotation rate.
 */
export function fieldHz(u: Pick<ShaderUniforms, 'rotation_speed' | 'num_arms'>): number {
  const rotationsPerSec = Math.abs(u.rotation_speed) / (2 * Math.PI);
  return rotationsPerSec * Math.max(1, Math.abs(u.num_arms));
}

/**
 * Scale rotation down until the field is under the ceiling.
 *
 * Only `rotation_speed` is touched: it is the parameter that carries temporal
 * frequency. Slowing the spiral preserves the field's geometry, whereas
 * reducing `num_arms` would change what the user is looking at.
 */
export function clampFieldRate(u: ShaderUniforms, maxHz: number = MAX_FIELD_HZ): ShaderUniforms {
  const hz = fieldHz(u);
  if (hz <= maxHz) return u;
  return { ...u, rotation_speed: u.rotation_speed * (maxHz / hz) };
}

/**
 * Reduced-motion uniforms — §5.6, acceptance C9.
 *
 * "A working static-field session": amplitude to near zero, the session still
 * runs. The field is still THERE and still drawn; it simply stops moving. That
 * is a different thing from hiding it, and the difference matters — a user who
 * set the preference for vestibular reasons still gets the visual ground the
 * text is designed to sit on.
 */
export function reducedMotionUniforms(
  schedule: Readonly<UniformSchedule> = DEFAULT_UNIFORM_SCHEDULE,
): ShaderUniforms {
  return {
    num_arms: schedule.num_arms.rest,
    rotation_speed: 0,
    spiral_angle: schedule.spiral_angle.rest,
    pattern_speed: 0,
    warp_speed: 0,
  };
}
