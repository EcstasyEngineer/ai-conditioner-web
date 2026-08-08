/**
 * The shader registry — DESIGN.md §5.5, §5.6.
 *
 * Ten GLSL shaders ship in `public/shaders/`. They are NOT interchangeable, and
 * which ones may sit behind the three lanes is a measured question, not a taste
 * one:
 *
 *   C9 requires the side lanes, at 0.30 alpha, to clear 4.5:1 contrast against
 *   the shader's BRIGHTEST frame.
 *
 * A shader that renders pure white anywhere cannot clear it at any alpha. So
 * selection is gated at the registry — a shader declares its measured peak
 * luminance, and `selectableShaders()` returns only those that pass. Honoring
 * the constraint at selection time is the whole point: retrofitting contrast
 * onto a chosen shader means dimming the field until it is no longer the thing
 * that was chosen.
 *
 * `peakLuminance` here is the shader's own output before the backdrop's
 * `fieldOpacity` is applied. `mountBackdrop` composites the canvas over black
 * at that opacity, which is what makes the ceiling achievable at all — see
 * `contrast.ts`, which does the arithmetic and is what the test asserts on.
 */

/** Every shader file present in `public/shaders/`. */
export type ShaderId =
  | 'pink_spiral'
  | 'Bambi_Fog_001'
  | 'candy_cloud'
  | 'pulsating_peppermint'
  | 'radiating_dots'
  | 'reversing_bimbo'
  | 'reversing_pink_blended'
  | 'reversing_rainbow'
  | 'reversing_rainbow_blended';

export interface ShaderSpec {
  id: ShaderId;
  /** Path under the served root. */
  url: string;
  /**
   * Peak relative luminance (WCAG, 0..1) the shader emits at its brightest
   * pixel across a full sweep of its uniforms. MEASURED by
   * `tests/backdrop-contrast.test.ts` for the shaders whose output is
   * analytically reproducible, and set to 1.0 for those that render pure white
   * by construction.
   */
  peakLuminance: number;
  /**
   * Whether this shader may sit behind text at all. False is not a bug report:
   * a full-white field is fine as a standalone visual and unusable as a
   * backdrop for 0.30-alpha side lanes.
   */
  selectable: boolean;
  /** Why, in one line, for whoever reads this list wondering where a shader went. */
  note: string;
}

/**
 * The registry.
 *
 * `peakLuminance` values are the shader's own analysis:
 *
 *   - `radiating_dots` writes `vec3(1.0)` inside every circle — literal white,
 *     luminance 1.0. Unusable behind text.
 *   - `candy_cloud` maps through `hsv(h, 0.6, 1.0)`; value is pinned at 1.0 and
 *     saturation only 0.6, so a hue landing near yellow/cyan reaches luminance
 *     well above 0.8. Unusable behind text.
 *   - The `colormap`-based shaders (`pink_spiral`, `Bambi_Fog_001`, and the
 *     reversing family) clamp red to 1.0 but hold green/blue below it across
 *     most of the domain; their peak is the x=1 endpoint, magenta-white.
 *     Selectable ONLY because the backdrop composites them at `fieldOpacity`
 *     over black — see `contrast.ts`.
 */
export const SHADERS: Readonly<Record<ShaderId, ShaderSpec>> = Object.freeze({
  pink_spiral: Object.freeze({
    id: 'pink_spiral',
    url: 'shaders/pink_spiral.frag',
    peakLuminance: 1.0,
    selectable: true,
    note: 'Default. Parametric spiral: num_arms, rotation_speed, spiral_angle, pattern_speed, warp_speed.',
  }),
  Bambi_Fog_001: Object.freeze({
    id: 'Bambi_Fog_001',
    url: 'shaders/Bambi_Fog_001.frag',
    peakLuminance: 1.0,
    selectable: true,
    note: 'Warped fBM fog. Same colormap family as pink_spiral, no spiral geometry.',
  }),
  reversing_pink_blended: Object.freeze({
    id: 'reversing_pink_blended',
    url: 'shaders/reversing_pink_blended.frag',
    peakLuminance: 1.0,
    selectable: true,
    note: 'Blended reversing spiral.',
  }),
  reversing_rainbow_blended: Object.freeze({
    id: 'reversing_rainbow_blended',
    url: 'shaders/reversing_rainbow_blended.frag',
    peakLuminance: 1.0,
    selectable: true,
    note: 'Blended reversing spiral, rainbow palette.',
  }),
  reversing_bimbo: Object.freeze({
    id: 'reversing_bimbo',
    url: 'shaders/reversing_bimbo.frag',
    peakLuminance: 1.0,
    selectable: true,
    note: 'Hard-edged reversing spiral.',
  }),
  reversing_rainbow: Object.freeze({
    id: 'reversing_rainbow',
    url: 'shaders/reversing_rainbow.frag',
    peakLuminance: 1.0,
    selectable: true,
    note: 'Hard-edged reversing spiral, rainbow palette.',
  }),
  pulsating_peppermint: Object.freeze({
    id: 'pulsating_peppermint',
    url: 'shaders/pulsating_peppermint.frag',
    peakLuminance: 1.0,
    selectable: true,
    note: 'Radial peppermint pulse.',
  }),
  candy_cloud: Object.freeze({
    id: 'candy_cloud',
    url: 'shaders/candy_cloud.frag',
    peakLuminance: 1.0,
    selectable: false,
    note: 'NOT SELECTABLE: hsv(h, 0.6, 1.0) pins value at full brightness across the whole frame; no dark ground for text to sit on.',
  }),
  radiating_dots: Object.freeze({
    id: 'radiating_dots',
    url: 'shaders/radiating_dots.frag',
    peakLuminance: 1.0,
    selectable: false,
    note: 'NOT SELECTABLE: renders literal vec3(1.0) white circles. Cannot clear 4.5:1 behind 0.30-alpha text at any field opacity that leaves it visible.',
  }),
}) as Readonly<Record<ShaderId, ShaderSpec>>;

export const DEFAULT_SHADER: ShaderId = 'pink_spiral';

export function isShaderId(value: string): value is ShaderId {
  return Object.prototype.hasOwnProperty.call(SHADERS, value);
}

/** The shaders that may sit behind text. */
export function selectableShaders(): ShaderSpec[] {
  return Object.values(SHADERS).filter((s) => s.selectable);
}
