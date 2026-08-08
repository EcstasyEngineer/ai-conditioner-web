/**
 * M6 — the backdrop.
 *
 * The C9 contrast criterion is the one that carries real risk, so it is tested
 * by SAMPLING the shaders' own colour maths across a uniform sweep rather than
 * by trusting a number in the registry. The shader sources are parsed from
 * `public/shaders/` where the structure allows and reimplemented faithfully
 * where the test needs to evaluate them — the reimplementations are checked
 * against the source text so they cannot silently drift.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GROUND_LUMINANCE,
  LANE_TEXT_LUMINANCE,
  REQUIRED_CONTRAST,
  SIDE_LANE_ALPHA,
  clearsRequirement,
  composite,
  contrastRatio,
  fieldLuminanceCeiling,
  luminanceClampScale,
  maxBackdropLuminance,
  relativeLuminance,
  sideLaneContrast,
} from '../web/backdrop/contrast.ts';
import {
  DEFAULT_SHADER,
  SHADERS,
  isShaderId,
  selectableShaders,
  type ShaderId,
} from '../web/backdrop/shaders/registry.ts';
import {
  BREATH_DIVISOR,
  breathHz,
  prepareFragmentSource,
} from '../web/backdrop/mountBackdrop.ts';
import {
  DEFAULT_UNIFORM_SCHEDULE,
  MAX_FIELD_HZ,
  bell,
  clampFieldRate,
  easeEarly,
  easeLate,
  fieldHz,
  reducedMotionUniforms,
  uniformsAt,
} from '../web/backdrop/uniforms.ts';
import { BED_PULSE_HZ } from '../web/audio/bed.ts';

const SHADER_DIR = join(process.cwd(), 'public', 'shaders');

function shaderSource(id: ShaderId): string {
  return readFileSync(join(SHADER_DIR, `${id}.frag`), 'utf8');
}

/* ------------------------------------------------------------------ *
 * The colour maths the shaders actually use.
 * ------------------------------------------------------------------ */

/**
 * The `colormap` shared by pink_spiral, Bambi_Fog_001 and the reversing family.
 * Transcribed from the GLSL; `assertColormapMatchesSource` guards the transcription.
 */
function colormap(x: number): [number, number, number] {
  const red = x < 0 ? 54 / 255 : x < 20049 / 82979 ? (829.79 * x + 54.51) / 255 : 1;
  const green =
    x < 20049 / 82979
      ? 0
      : x < 327013 / 810990
        ? (8546482679670 / 10875673217) * x / 255 - 2064961390770 / 10875673217 / 255
        : x <= 1
          ? ((103806720 / 483977) * x + 19607415 / 483977) / 255
          : 1;
  const blue =
    x < 0
      ? 54 / 255
      : x < 7249 / 82979
        ? (829.79 * x + 54.51) / 255
        : x < 20049 / 82979
          ? 127 / 255
          : x < 327013 / 810990
            ? (792.0224934136 * x - 64.3647907356) / 255
            : 1;
  return [red, green, blue];
}

/** `hsv(h, s, v)` from candy_cloud, transcribed from the GLSL. */
function hsv(h: number, s: number, v: number): [number, number, number] {
  const rgb = [0, 4, 2].map((o) => {
    let k = (h * 6 + o) % 6;
    if (k < 0) k += 6;
    return Math.min(1, Math.max(0, Math.abs(k - 3) - 1));
  });
  return rgb.map((c) => (1 - s + s * c) * v) as [number, number, number];
}

describe('shader transcriptions match the shipped sources', () => {
  it('the colormap breakpoints in the test match pink_spiral.frag', () => {
    const src = shaderSource('pink_spiral');
    // If someone edits the shader's colour ramp, these anchors fail and the
    // luminance sweep below stops being a measurement of the real shader.
    expect(src).toContain('20049.0 / 82979.0');
    expect(src).toContain('327013.0 / 810990.0');
    expect(src).toContain('829.79');
    expect(src).toContain('54.51');
  });

  it('candy_cloud really does pin HSV value at 1.0', () => {
    const src = shaderSource('candy_cloud');
    expect(src).toContain('float saturation = 0.6');
    expect(src).toContain('float value = 1.0');
  });

  it('radiating_dots really does write literal white', () => {
    expect(shaderSource('radiating_dots')).toContain('color = vec3(1.0)');
  });
});

/* ------------------------------------------------------------------ *
 * C9: the contrast constraint.
 * ------------------------------------------------------------------ */

describe('C9 contrast — side lanes at 0.30 alpha clear 4.5:1', () => {
  it('WCAG primitives are right', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 12);
    expect(relativeLuminance(1, 1, 1)).toBeCloseTo(1, 12);
    // Black on white is the canonical 21:1.
    expect(contrastRatio(1, 0)).toBeCloseTo(21, 6);
  });

  it('MEASURED: every colormap shader reaches literal white at the top of its ramp', () => {
    // This is the finding that shapes the whole module: pink_spiral is not a
    // gentler shader than candy_cloud, it just gets to white on fewer pixels.
    // A design that assumed "pick a dark shader" would have been wrong.
    let peak = 0;
    for (let i = 0; i <= 4000; i++) {
      const [r, g, b] = colormap(i / 4000);
      peak = Math.max(peak, relativeLuminance(r, g, b));
    }
    expect(peak).toBeCloseTo(1.0, 3);
  });

  it('MEASURED: candy_cloud peaks near white across every hue', () => {
    let peak = 0;
    for (let i = 0; i <= 4000; i++) {
      const [r, g, b] = hsv(i / 4000, 0.6, 1.0);
      peak = Math.max(peak, relativeLuminance(r, g, b));
    }
    // ~0.937 — high everywhere, which is why it is not selectable: there is no
    // dark ground anywhere in the frame for text to sit on.
    expect(peak).toBeGreaterThan(0.9);
  });

  it('the unclamped shaders FAIL the requirement — this is why the clamp exists', () => {
    // Stated as a test so the clamp can never be removed as "unnecessary".
    expect(sideLaneContrast(1.0)).toBeLessThan(REQUIRED_CONTRAST);
    expect(sideLaneContrast(0.5)).toBeLessThan(REQUIRED_CONTRAST);
    expect(sideLaneContrast(0.1)).toBeLessThan(REQUIRED_CONTRAST);
  });

  it('derives a backdrop luminance ceiling around 0.023', () => {
    const ceiling = maxBackdropLuminance();
    expect(ceiling).toBeGreaterThan(0.02);
    expect(ceiling).toBeLessThan(0.025);
    // At the ceiling the requirement is met exactly.
    expect(sideLaneContrast(ceiling)).toBeCloseTo(REQUIRED_CONTRAST, 3);
  });

  it('the shipped ceiling carries a safety margin under the exact solution', () => {
    expect(fieldLuminanceCeiling()).toBeLessThan(maxBackdropLuminance());
    expect(sideLaneContrast(fieldLuminanceCeiling())).toBeGreaterThan(REQUIRED_CONTRAST);
  });

  it('SWEEP: every selectable shader clears 4.5:1 at its BRIGHTEST frame once clamped', () => {
    // The acceptance criterion, executed: sample max luminance across the
    // shader's full output range, clamp as the fragment stage does, and assert
    // the side lanes still clear the ratio.
    for (const spec of selectableShaders()) {
      let worst = Infinity;
      for (let i = 0; i <= 2000; i++) {
        const [r, g, b] = colormap(i / 2000);
        const l = relativeLuminance(r, g, b);
        const clamped = l * luminanceClampScale(l);
        worst = Math.min(worst, sideLaneContrast(clamped));
      }
      expect(worst, `${spec.id} brightest frame`).toBeGreaterThanOrEqual(REQUIRED_CONTRAST);
    }
  });

  it('clears the requirement at peak luminance 1.0 — the worst case any shader can present', () => {
    expect(clearsRequirement(1.0)).toBe(true);
    for (const spec of selectableShaders()) {
      expect(clearsRequirement(spec.peakLuminance), spec.id).toBe(true);
    }
  });

  it('leaves dark regions of the field untouched', () => {
    // The clamp is not a global dimmer: below the ceiling the scale is exactly
    // 1, which is what preserves the field's structure.
    expect(luminanceClampScale(0.001)).toBe(1);
    expect(luminanceClampScale(0.01)).toBe(1);
    expect(luminanceClampScale(0.9)).toBeLessThan(1);
  });

  it('the center lane, at full alpha, clears the requirement comfortably', () => {
    // Sanity on the stratification: if the sides pass, the dominant lane must.
    const ceiling = fieldLuminanceCeiling();
    expect(contrastRatio(LANE_TEXT_LUMINANCE, ceiling)).toBeGreaterThan(REQUIRED_CONTRAST * 2);
  });

  it('holds the constants the criterion is written in terms of', () => {
    expect(SIDE_LANE_ALPHA).toBe(0.3);
    expect(REQUIRED_CONTRAST).toBe(4.5);
    expect(GROUND_LUMINANCE).toBe(0);
    expect(composite(1, 0, 0.3)).toBeCloseTo(0.3, 12);
  });
});

/* ------------------------------------------------------------------ *
 * Shader selection.
 * ------------------------------------------------------------------ */

describe('shader registry', () => {
  it('every registered shader exists on disk', () => {
    for (const spec of Object.values(SHADERS)) {
      expect(() => shaderSource(spec.id), spec.id).not.toThrow();
    }
  });

  it('excludes the uniformly-bright shaders from selection', () => {
    expect(SHADERS.candy_cloud.selectable).toBe(false);
    expect(SHADERS.radiating_dots.selectable).toBe(false);
    const ids = selectableShaders().map((s) => s.id);
    expect(ids).not.toContain('candy_cloud');
    expect(ids).not.toContain('radiating_dots');
    expect(ids.length).toBeGreaterThan(0);
  });

  it('the default is selectable', () => {
    expect(isShaderId(DEFAULT_SHADER)).toBe(true);
    expect(SHADERS[DEFAULT_SHADER].selectable).toBe(true);
  });

  it('every non-selectable shader says why', () => {
    for (const spec of Object.values(SHADERS)) {
      if (!spec.selectable) {
        expect(spec.note, spec.id).toMatch(/NOT SELECTABLE/);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Uniforms driven by progress.
 * ------------------------------------------------------------------ */

describe('progress-driven uniforms', () => {
  it('drives all five parameters named in DESIGN.md 5.5', () => {
    const u = uniformsAt(0.5);
    for (const key of ['num_arms', 'rotation_speed', 'spiral_angle', 'pattern_speed', 'warp_speed'] as const) {
      expect(Number.isFinite(u[key]), key).toBe(true);
    }
  });

  it('is unimodal: rises to the peak and falls after it', () => {
    const trace: number[] = [];
    for (let i = 0; i <= 100; i++) trace.push(uniformsAt(i / 100).rotation_speed);
    const peakIdx = trace.indexOf(Math.max(...trace));
    for (let i = 1; i <= peakIdx; i++) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1] - 1e-9);
    for (let i = peakIdx + 1; i < trace.length; i++) {
      expect(trace[i]).toBeLessThanOrEqual(trace[i - 1] + 1e-9);
    }
  });

  it('opens and closes at rest — the field unwinds for the emergence', () => {
    const { rest, peak } = DEFAULT_UNIFORM_SCHEDULE.rotation_speed;
    const span = peak - rest;
    const open = uniformsAt(0).rotation_speed;
    const close = uniformsAt(1).rotation_speed;

    // Within 15% of rest at both ends. The loose version of this test passed
    // with a bell that still read 0.40 at progress 1.0 — a field turning at
    // half speed through the emergence, which is the visual twin of the
    // "wide awake at line 2" artifact.
    expect(open).toBeLessThan(rest + span * 0.15);
    expect(close).toBeLessThan(rest + span * 0.15);

    // And it genuinely does open up in between, or "at rest" would be trivial.
    expect(uniformsAt(DEFAULT_UNIFORM_SCHEDULE.bellPeak).rotation_speed).toBeGreaterThan(
      rest + span * 0.9,
    );
  });

  it('is still generous through the middle of the session', () => {
    // The narrow bell must not have bought its clean ends by collapsing the
    // body of the session into a static field.
    const { rest, peak } = DEFAULT_UNIFORM_SCHEDULE.rotation_speed;
    expect(uniformsAt(0.5).rotation_speed).toBeGreaterThan(rest + (peak - rest) * 0.7);
  });

  it('peaks after the intensity bell, not on top of it', () => {
    // §4.9: the fastest pacing, deepest content and busiest field must not all
    // land on the same instant.
    expect(DEFAULT_UNIFORM_SCHEDULE.bellPeak).toBeGreaterThan(0.5);
  });

  it('clamps progress rather than extrapolating', () => {
    expect(uniformsAt(-5)).toEqual(uniformsAt(0));
    expect(uniformsAt(5)).toEqual(uniformsAt(1));
  });

  it('uses the same curve vocabulary as the rest of the system', () => {
    expect(bell(0.5, 0.5, 0.25)).toBeCloseTo(1, 12);
    expect(bell(0, 0.5, 0.25)).toBeLessThan(1);
    // §5.2's eases, exactly as M3 defines them.
    expect(easeLate(0.5)).toBeCloseTo(0.125, 12);
    expect(easeEarly(0.5)).toBeCloseTo(0.875, 12);
    expect(easeLate(0)).toBe(0);
    expect(easeLate(1)).toBe(1);
    expect(easeEarly(0)).toBe(0);
    expect(easeEarly(1)).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * C9: the motion ceiling.
 * ------------------------------------------------------------------ */

describe('C9 motion — nothing in the field exceeds ~3Hz', () => {
  it('the whole progress sweep stays under the ceiling', () => {
    for (let i = 0; i <= 1000; i++) {
      const u = clampFieldRate(uniformsAt(i / 1000));
      expect(fieldHz(u), `progress ${i / 1000}`).toBeLessThanOrEqual(MAX_FIELD_HZ + 1e-9);
    }
  });

  it('clamps a deliberately reckless schedule instead of trusting it', () => {
    // A future tuning edit must not be able to reintroduce a strobe.
    const reckless = clampFieldRate({
      num_arms: 12,
      rotation_speed: 400,
      spiral_angle: 60,
      pattern_speed: 2,
      warp_speed: 1,
    });
    expect(fieldHz(reckless)).toBeLessThanOrEqual(MAX_FIELD_HZ + 1e-9);
    // Geometry is preserved; only the rate is reduced.
    expect(reckless.num_arms).toBe(12);
    expect(reckless.spiral_angle).toBe(60);
  });

  it('counts arm passes, not just rotations — an eye counts events', () => {
    const oneRotationPerSec = { rotation_speed: 2 * Math.PI, num_arms: 1 };
    expect(fieldHz(oneRotationPerSec)).toBeCloseTo(1, 9);
    expect(fieldHz({ rotation_speed: 2 * Math.PI, num_arms: 4 })).toBeCloseTo(4, 9);
  });

  it('leaves an already-slow field alone', () => {
    const slow = { num_arms: 2, rotation_speed: 0.5, spiral_angle: 30, pattern_speed: 0.1, warp_speed: 0 };
    expect(clampFieldRate(slow)).toEqual(slow);
  });
});

/* ------------------------------------------------------------------ *
 * C9: reduced motion.
 * ------------------------------------------------------------------ */

describe('C9 reduced motion — a working static-field session', () => {
  it('drops amplitude to zero while the field still exists', () => {
    const u = reducedMotionUniforms();
    expect(u.rotation_speed).toBe(0);
    expect(u.pattern_speed).toBe(0);
    expect(u.warp_speed).toBe(0);
    // Still a field: the geometry is intact, it simply is not moving. The
    // session runs; it stops animating.
    expect(u.num_arms).toBeGreaterThan(0);
    expect(u.spiral_angle).toBeGreaterThan(0);
  });

  it('is trivially under the motion ceiling', () => {
    expect(fieldHz(reducedMotionUniforms())).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * The shared clock.
 * ------------------------------------------------------------------ */

describe('the backdrop derives its rate from the bed', () => {
  it('breathes at a subdivision of the bed pulse, inside the 0.4-1.2Hz band', () => {
    const hz = breathHz(BED_PULSE_HZ);
    expect(hz).toBeGreaterThanOrEqual(0.4);
    expect(hz).toBeLessThanOrEqual(1.2);
    // Phase-locked, not independently chosen: an exact integer division.
    expect(hz * BREATH_DIVISOR).toBeCloseTo(BED_PULSE_HZ, 12);
  });

  it('is under the field motion ceiling', () => {
    expect(breathHz(BED_PULSE_HZ)).toBeLessThan(MAX_FIELD_HZ);
  });

  it('tracks whatever rate the bed reports', () => {
    expect(breathHz(4)).toBe(1);
    expect(breathHz(8)).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * The fragment wrapper.
 * ------------------------------------------------------------------ */

describe('fragment source preparation', () => {
  const TUNABLE = ['num_arms', 'rotation_speed', 'spiral_angle', 'pattern_speed', 'warp_speed'] as const;

  it('lifts the shader constants to uniforms so the session can drive them', () => {
    const src = shaderSource('pink_spiral');
    // The shipped source really does hardcode them — that is the thing being fixed.
    expect(src).toMatch(/float num_arms = 3\.0;/);

    const out = prepareFragmentSource(src, TUNABLE);
    for (const name of TUNABLE) {
      expect(out, name).toMatch(new RegExp(`uniform\\s+float\\s+${name}\\s*;`));
    }
    // And the constant declaration is gone, or GLSL would reject the redefinition.
    expect(out).not.toMatch(/float num_arms = 3\.0;/);
  });

  it('declares every tunable even in shaders that lack it, so one host drives all', () => {
    const out = prepareFragmentSource(shaderSource('candy_cloud'), TUNABLE);
    for (const name of TUNABLE) {
      expect(out, name).toMatch(new RegExp(`uniform\\s+float\\s+${name}\\s*;`));
    }
  });

  it('takes over main() and applies the luminance clamp', () => {
    const out = prepareFragmentSource(shaderSource('pink_spiral'), TUNABLE);
    expect(out).toContain('void hypnoapp_shader_main()');
    expect(out).toContain('uniform float u_maxLuminance');
    expect(out).toContain('u_maxLuminance / l');
    // Exactly one main().
    expect(out.match(/\bvoid\s+main\s*\(/g)).toHaveLength(1);
  });

  it('applies the master opacity for the threshold and exit fades', () => {
    const out = prepareFragmentSource(shaderSource('pink_spiral'), TUNABLE);
    expect(out).toContain('uniform float u_opacity');
    expect(out).toContain('color * u_opacity');
  });

  it('handles every shipped shader without producing a duplicate main', () => {
    for (const spec of Object.values(SHADERS)) {
      const out = prepareFragmentSource(shaderSource(spec.id), TUNABLE);
      expect(out.match(/\bvoid\s+main\s*\(/g), spec.id).toHaveLength(1);
      expect(out, spec.id).toContain('hypnoapp_shader_main');
    }
  });
});
