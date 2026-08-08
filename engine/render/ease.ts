/**
 * Easing — the `curve … ease late/early` vocabulary, DESIGN.md §5.2.
 *
 * **[CITED recon-trance §9]** lists `curve … ease late/early` among the
 * semantics worth taking: `late` is p³ and dwells at the START, `early` is
 * 1−(1−p)³ and dwells at the END. The names describe where the VALUE arrives,
 * not where the motion is — `late` spends most of its span near 0 and then
 * rushes, so the thing it drives shows up late.
 *
 * These names are counter-intuitive on first read and that is precisely why
 * they are named rather than inlined: `p * p * p` scattered across a renderer
 * is a place where someone eventually "fixes" the direction.
 *
 * One vocabulary, three consumers — the per-line envelope here in M3, the
 * backdrop uniforms in M6 (§5.5), and the master fades in M4 (§6.5, §6.6) — so
 * that visuals, text and field move with the same hand.
 */

/**
 * The easing names. `linear` is included as the identity rather than as a
 * special case at every call site.
 */
export type Ease = 'linear' | 'late' | 'early';

/** Every `Ease`, as a value, for exhaustiveness checks and property tests. */
export const EASE_VALUES: readonly Ease[] = ['linear', 'late', 'early'] as const;

/**
 * Clamp to [0,1].
 *
 * Every easing function takes a normalized progress, and every caller computes
 * that progress as a ratio of two durations at least one of which can be zero
 * or negative at a boundary. Clamping HERE rather than at the call sites is
 * what makes `ease` total.
 *
 * `NaN` maps to 0 rather than propagating into an alpha and blanking a lane for
 * the rest of the session. The infinities are NOT lumped in with it: they carry
 * a direction, and `0/0` and `1/0` mean different things at a boundary — a
 * degenerate ramp that has already finished should read as finished, not as
 * never started. `p >= 1` catches `+Infinity` on its own, so the only value
 * needing the explicit guard is the one with no direction at all.
 */
export function clamp01(p: number): number {
  if (Number.isNaN(p)) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p;
}

/** `late` — p³. Dwells at the start; the value arrives late. */
export function easeLate(p: number): number {
  const t = clamp01(p);
  return t * t * t;
}

/** `early` — 1−(1−p)³. Dwells at the end; the value arrives early. */
export function easeEarly(p: number): number {
  const t = clamp01(p);
  const u = 1 - t;
  return 1 - u * u * u;
}

/** The identity, clamped. */
export function easeLinear(p: number): number {
  return clamp01(p);
}

/** Apply a named ease. Total over `Ease`; no default branch to drift. */
export function ease(name: Ease, p: number): number {
  switch (name) {
    case 'late':
      return easeLate(p);
    case 'early':
      return easeEarly(p);
    case 'linear':
      return easeLinear(p);
  }
}

/**
 * Linear interpolation with a clamped parameter.
 *
 * Present because the envelope's ramps are lerps and every one of them would
 * otherwise re-derive the clamp — which is where an unclamped ramp overshoots
 * the lane's alpha ceiling by a frame at a boundary.
 */
export function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * clamp01(p);
}
