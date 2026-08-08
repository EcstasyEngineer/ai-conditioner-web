/**
 * Envelope and easing — DESIGN.md §5.2.
 *
 * The two claims under test are the ones a reimplementation gets wrong:
 *
 *   The TRUE ABSENT TAIL. `fade inout`'s whole-clock triangle is always fading
 *   and therefore never absent, which smears three lanes permanently over each
 *   other. Past the envelope the value must be EXACTLY 0, and that exactness is
 *   what the `.active` gate reads.
 *
 *   The DIRECTION of `late` and `early`. The names describe where the value
 *   arrives, not where the motion is, and they are the kind of thing a later
 *   contributor "fixes" backwards.
 */

import { describe, expect, it } from 'vitest';

import {
  EASE_VALUES,
  clamp01,
  ease,
  easeEarly,
  easeLate,
  easeLinear,
  lerp,
} from '../engine/render/ease.ts';
import {
  MIN_CROSSFADE_MS,
  type Envelope,
  compositeAlpha,
  defaultEnvelope,
  envelopeActive,
  envelopeAt,
  envelopeSpanMs,
} from '../engine/render/envelope.ts';

const trapezoid: Envelope = {
  inMs: 400,
  holdMs: 1000,
  outMs: 400,
  inEase: 'linear',
  outEase: 'linear',
};

describe('ease', () => {
  it('makes late p^3 — it dwells at the start', () => {
    expect(easeLate(0)).toBe(0);
    expect(easeLate(0.5)).toBeCloseTo(0.125, 10);
    expect(easeLate(1)).toBe(1);
    // Dwelling at the start means: below the diagonal for the whole interior.
    for (let p = 0.05; p < 1; p += 0.05) expect(easeLate(p)).toBeLessThan(p);
  });

  it('makes early 1-(1-p)^3 — it dwells at the end', () => {
    expect(easeEarly(0)).toBe(0);
    expect(easeEarly(0.5)).toBeCloseTo(0.875, 10);
    expect(easeEarly(1)).toBe(1);
    for (let p = 0.05; p < 1; p += 0.05) expect(easeEarly(p)).toBeGreaterThan(p);
  });

  it('makes late and early exact mirrors of each other', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) {
      expect(easeLate(p)).toBeCloseTo(1 - easeEarly(1 - p), 10);
    }
  });

  it('keeps every ease monotone, bounded and anchored at both ends', () => {
    for (const name of EASE_VALUES) {
      expect(ease(name, 0)).toBe(0);
      expect(ease(name, 1)).toBe(1);
      let previous = -1;
      for (let p = 0; p <= 1.0001; p += 0.01) {
        const v = ease(name, p);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(previous);
        previous = v;
      }
    }
  });

  it('clamps out-of-range and non-finite progress rather than propagating it', () => {
    for (const name of EASE_VALUES) {
      expect(ease(name, -5)).toBe(0);
      expect(ease(name, 5)).toBe(1);
      expect(ease(name, Number.NaN)).toBe(0);
      expect(ease(name, Number.POSITIVE_INFINITY)).toBe(1);
    }
    expect(clamp01(Number.NaN)).toBe(0);
    expect(easeLinear(0.25)).toBe(0.25);
  });

  it('lerps with a clamped parameter', () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, -1)).toBe(10);
    expect(lerp(10, 20, 2)).toBe(20);
  });
});

describe('envelope', () => {
  it('produces a piecewise-linear trapezoid', () => {
    expect(envelopeAt(trapezoid, 0)).toBe(0);
    expect(envelopeAt(trapezoid, 200)).toBeCloseTo(0.5, 10);
    expect(envelopeAt(trapezoid, 400)).toBe(1);
    expect(envelopeAt(trapezoid, 900)).toBe(1);
    expect(envelopeAt(trapezoid, 1400)).toBe(1);
    expect(envelopeAt(trapezoid, 1600)).toBeCloseTo(0.5, 10);
  });

  it('has a TRUE absent tail — exactly 0 past the envelope, not a whole-clock triangle', () => {
    const span = envelopeSpanMs(trapezoid);
    expect(span).toBe(1800);
    expect(envelopeAt(trapezoid, span)).toBe(0);
    for (const t of [1800, 1801, 2000, 5000, 1_000_000]) {
      expect(envelopeAt(trapezoid, t), `t=${t}`).toBe(0);
    }
    // A whole-clock triangle over the same span would still be well above zero
    // a third of the way past the hold. The trapezoid is at full there.
    expect(envelopeAt(trapezoid, 1000)).toBe(1);
  });

  it('is exactly 0 before it starts and for non-finite time', () => {
    expect(envelopeAt(trapezoid, -1)).toBe(0);
    expect(envelopeAt(trapezoid, Number.NaN)).toBe(0);
  });

  it('gates active exactly on the span, closing at its final instant', () => {
    expect(envelopeActive(trapezoid, -1)).toBe(false);
    expect(envelopeActive(trapezoid, 0)).toBe(true);
    expect(envelopeActive(trapezoid, 1799)).toBe(true);
    expect(envelopeActive(trapezoid, 1800)).toBe(false);
    // Agreement with the value is the invariant that keeps a lane from being
    // kept in the DOM at zero opacity waiting to flash.
    for (let t = -100; t < 2000; t += 7) {
      if (envelopeAt(trapezoid, t) > 0) expect(envelopeActive(trapezoid, t), `t=${t}`).toBe(true);
    }
  });

  it('honors the eases on each ramp independently', () => {
    const eased: Envelope = { ...trapezoid, inEase: 'late', outEase: 'early' };
    // `late` in: still low a quarter of the way up the ramp.
    expect(envelopeAt(eased, 100)).toBeCloseTo(0.015625, 10);
    // `early` out: already well down a quarter of the way through the ramp.
    expect(envelopeAt(eased, 1500)).toBeCloseTo(1 - 0.578125, 10);
  });

  it('degenerates to silence rather than to a flash when the span is zero', () => {
    const empty: Envelope = { inMs: 0, holdMs: 0, outMs: 0, inEase: 'linear', outEase: 'linear' };
    expect(envelopeSpanMs(empty)).toBe(0);
    expect(envelopeAt(empty, 0)).toBe(0);
    expect(envelopeActive(empty, 0)).toBe(false);
  });

  it('treats negative components as zero rather than inverting the shape', () => {
    const bad: Envelope = { inMs: -100, holdMs: -50, outMs: 200, inEase: 'linear', outEase: 'linear' };
    expect(envelopeSpanMs(bad)).toBe(200);
    expect(envelopeAt(bad, 0)).toBe(1);
    expect(envelopeAt(bad, 200)).toBe(0);
  });
});

describe('defaultEnvelope', () => {
  it('gives a normal dwell 400ms ramps and spends the rest on the hold', () => {
    const env = defaultEnvelope(3400);
    expect(env.inMs).toBe(MIN_CROSSFADE_MS);
    expect(env.outMs).toBe(MIN_CROSSFADE_MS);
    expect(env.holdMs).toBe(3400 - 800);
    expect(envelopeSpanMs(env)).toBe(3400);
  });

  it('holds the 400ms cross-fade floor across the whole pacing range', () => {
    // 5.6: every appearance and disappearance is a cross-fade of >= 400ms. The
    // ramps are fixed rather than a fraction of dwell precisely so that the
    // tightest pacing does not produce the hardest edge.
    for (const dwell of [2900, 3000, 3400, 4200]) {
      const env = defaultEnvelope(dwell);
      expect(env.inMs, `dwell=${dwell}`).toBe(MIN_CROSSFADE_MS);
      expect(env.outMs, `dwell=${dwell}`).toBe(MIN_CROSSFADE_MS);
      expect(envelopeSpanMs(env), `dwell=${dwell}`).toBe(dwell);
    }
  });

  it('scales the ramps down together on a dwell too short to carry them', () => {
    const env = defaultEnvelope(500);
    expect(env.inMs).toBe(250);
    expect(env.outMs).toBe(250);
    expect(env.holdMs).toBe(0);
    expect(envelopeSpanMs(env)).toBe(500);
    // Still ends in a true absent tail.
    expect(envelopeAt(env, 500)).toBe(0);
  });

  it('never produces a span longer than its dwell, at any dwell', () => {
    for (let dwell = 0; dwell <= 6000; dwell += 37) {
      expect(envelopeSpanMs(defaultEnvelope(dwell)), `dwell=${dwell}`).toBeCloseTo(dwell, 10);
    }
  });
});

describe('compositeAlpha', () => {
  it('multiplies the envelope into the lane ceiling and never past it', () => {
    expect(compositeAlpha(1, 0.3)).toBeCloseTo(0.3, 10);
    expect(compositeAlpha(0.5, 0.3)).toBeCloseTo(0.15, 10);
    expect(compositeAlpha(1, 1)).toBe(1);
    expect(compositeAlpha(0, 1)).toBe(0);
  });

  it('clamps rather than overshooting on a bad input', () => {
    expect(compositeAlpha(5, 0.3)).toBeCloseTo(0.3, 10);
    expect(compositeAlpha(-5, 0.3)).toBe(0);
    expect(compositeAlpha(Number.NaN, 0.3)).toBe(0);
  });
});
