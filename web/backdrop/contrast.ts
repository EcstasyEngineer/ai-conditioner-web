/**
 * The contrast constraint — DESIGN.md §5.6, acceptance C9.
 *
 *   "Side lanes at 0.30 alpha must clear 4.5:1 contrast against the shader's
 *    brightest frame."
 *
 * This file is the arithmetic behind that sentence, kept separate from the
 * WebGL host so it can be asserted in Node with no GPU. The test sweeps the
 * uniform ranges the backdrop actually drives and takes the maximum, rather
 * than trusting a number typed into the registry.
 *
 * THE KEY STRUCTURAL FACT, MEASURED: the raw shaders cannot satisfy this on
 * their own, and the shortfall is not marginal.
 *
 *   - EVERY colormap shader in the registry reaches LITERAL WHITE (luminance
 *     1.0) at the top of its colour ramp — `colormap(1.0)` is `(1,1,1)`.
 *     `pink_spiral` is not gentler than `candy_cloud`; it merely arrives there
 *     on fewer pixels.
 *   - Text at 0.30 alpha is translucent, so a bright field lifts the TEXT as
 *     well as the ground and the ratio collapses from both directions. At a
 *     backdrop luminance of 0.05 the side lanes read 3.47:1; at 0.10, 2.54:1.
 *   - Solving for equality puts the ceiling at backdrop luminance ~0.0228.
 *
 * A uniform opacity that respects that ceiling would be ~2%, which is not a
 * field — it is an off switch with extra steps. So the ceiling is applied as a
 * LUMINANCE CLAMP inside the shader pipeline rather than as a global fade:
 * `mountBackdrop` scales each sampled colour by the factor that brings its own
 * luminance under the cap. Dark regions of the field keep their values and
 * their structure; only the rare near-white pixels are pulled down. The field
 * stays legible AS A FIELD while the brightest frame it can possibly emit
 * still clears 4.5:1.
 *
 * That is what honoring the constraint "at selection time, not retrofitted"
 * means here: the clamp is computed FROM the requirement, so it cannot drift
 * away from it, and a shader whose brightness is UNIFORM (`candy_cloud`,
 * `radiating_dots`) is rejected outright because clamping it yields a flat
 * grey wash instead of a field.
 */

/** WCAG relative luminance of an sRGB channel triple in [0,1]. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number): number => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two relative luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Alpha-composite a foreground luminance over a background luminance.
 *
 * Compositing is linear in the channel values, and luminance is linear in the
 * linearized channels, so mixing luminances directly is exact for a uniform
 * blend — which is what a flat alpha over a flat ground is.
 */
export function composite(fgLuminance: number, bgLuminance: number, alpha: number): number {
  return fgLuminance * alpha + bgLuminance * (1 - alpha);
}

/** The text colour the lanes paint in. Near-white, per §5.3's stratification. */
export const LANE_TEXT_LUMINANCE = relativeLuminance(0.94, 0.94, 0.96);

/** Side lanes composite at 0.30 (§5.3). This is the value C9 names. */
export const SIDE_LANE_ALPHA = 0.3;

/** The WCAG AA threshold C9 requires. */
export const REQUIRED_CONTRAST = 4.5;

/** The page ground the field is drawn over. Black; §6.5 darkens to it. */
export const GROUND_LUMINANCE = 0;

/**
 * Effective luminance of side-lane text at 0.30 alpha over a given backdrop.
 *
 * The text is not opaque, so the thing a reader actually sees is the text
 * composited over the field — which means a bright field lifts the TEXT as
 * well as the ground, and the ratio collapses from both directions. This is
 * the reason a bright shader fails so hard.
 */
export function sideLaneLuminance(backdropLuminance: number): number {
  return composite(LANE_TEXT_LUMINANCE, backdropLuminance, SIDE_LANE_ALPHA);
}

/** The contrast a side lane achieves against a backdrop of this luminance. */
export function sideLaneContrast(backdropLuminance: number): number {
  return contrastRatio(sideLaneLuminance(backdropLuminance), backdropLuminance);
}

/**
 * The largest backdrop luminance at which side lanes still clear 4.5:1.
 *
 * Solved by bisection rather than algebraically: `relativeLuminance` is
 * piecewise and the composite runs through it twice, so a closed form would be
 * a derivation to re-check on every tweak. The function is monotone decreasing
 * in backdrop luminance, which is all bisection needs.
 */
export function maxBackdropLuminance(required: number = REQUIRED_CONTRAST): number {
  let lo = 0;
  let hi = 1;
  if (sideLaneContrast(hi) >= required) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sideLaneContrast(mid) >= required) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Safety margin on the derived ceiling.
 *
 * The sweep evaluates each shader's analytic form at sampled points; a real GPU
 * frame interpolates between them and can land marginally brighter. 0.9 buys
 * that back without meaningfully darkening the field.
 */
export const LUMINANCE_SAFETY = 0.9;

/**
 * The luminance the field is clamped to — the single number the whole
 * constraint reduces to.
 *
 * MEASURED at ~0.0228 before the safety margin. Everything the backdrop paints
 * is scaled so its own luminance does not exceed this.
 */
export function fieldLuminanceCeiling(required: number = REQUIRED_CONTRAST): number {
  return maxBackdropLuminance(required) * LUMINANCE_SAFETY;
}

/**
 * The scale factor that brings a colour of luminance `l` under the ceiling.
 *
 * Returns 1 for colours already under it, so dark regions of the field pass
 * through untouched and keep their structure. This is the per-pixel form of the
 * constraint and it is what `mountBackdrop` hands the shader as a uniform.
 *
 * Scaling in the sRGB domain rather than linear light is deliberate: it is what
 * a fragment shader can do with a multiply, and it always UNDERSHOOTS the
 * target luminance (the transfer curve is convex), so the result errs toward
 * more contrast than required rather than less.
 */
export function luminanceClampScale(l: number, ceiling: number = fieldLuminanceCeiling()): number {
  if (l <= ceiling || l <= 0) return 1;
  return ceiling / l;
}

/**
 * Does a shader with this peak luminance clear the requirement once clamped?
 *
 * True for every shader, by construction — that is the point of the clamp. The
 * function exists so the test asserts the composed pipeline rather than the
 * clamp in isolation, and so a future change that removes the clamp fails
 * loudly here.
 */
export function clearsRequirement(peakLuminance: number, required: number = REQUIRED_CONTRAST): boolean {
  const clamped = peakLuminance * luminanceClampScale(peakLuminance);
  return sideLaneContrast(clamped) >= required;
}
