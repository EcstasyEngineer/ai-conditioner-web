/**
 * M6 — mounting the backdrop.
 *
 * `mountBackdrop` is the one part of this module that touches a real platform
 * API, so what is asserted here is the CONTRACT around the GL calls rather than
 * the pixels: that a missing context degrades to a no-op instead of throwing,
 * that the uniform names the shaders declare are the ones the host sets, and
 * that dispose stops the loop and releases what it made.
 *
 * A fake GL context makes those assertions deterministic. Actual rendering is a
 * D-phase sitting, not a unit test — but "the session still runs when WebGL is
 * unavailable" is exactly the kind of promise that only ever gets verified if
 * something asserts it.
 *
 * This runs in the DEFAULT Node environment with a hand-built canvas stand-in
 * rather than opting into jsdom. `mountBackdrop` only ever touches four canvas
 * members (`getContext`, `clientWidth`, `clientHeight`, `width`/`height`), so a
 * plain object satisfies it — and the test then needs no DOM implementation at
 * all, which keeps the suite installable and fast.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountBackdrop, resolveShader } from '../web/backdrop/mountBackdrop.ts';
import { DEFAULT_SHADER } from '../web/backdrop/shaders/registry.ts';

/** Records every uniform the host sets, by name. */
class FakeGL {
  readonly uniforms = new Map<string, number[]>();
  readonly locations = new Map<string, object>();
  readonly deleted: string[] = [];
  drawCalls = 0;
  compiled: string[] = [];
  failCompile = false;
  failLink = false;

  // Enum stand-ins. Values are arbitrary; only identity matters.
  VERTEX_SHADER = 1;
  FRAGMENT_SHADER = 2;
  COMPILE_STATUS = 3;
  LINK_STATUS = 4;
  ARRAY_BUFFER = 5;
  STATIC_DRAW = 6;
  FLOAT = 7;
  TRIANGLES = 8;

  createShader(): object {
    return {};
  }
  shaderSource(_s: object, src: string): void {
    this.compiled.push(src);
  }
  compileShader(): void {}
  getShaderParameter(): boolean {
    return !this.failCompile;
  }
  deleteShader(): void {
    this.deleted.push('shader');
  }
  createProgram(): object {
    return {};
  }
  attachShader(): void {}
  linkProgram(): void {}
  getProgramParameter(): boolean {
    return !this.failLink;
  }
  deleteProgram(): void {
    this.deleted.push('program');
  }
  useProgram(): void {}
  createBuffer(): object {
    return {};
  }
  deleteBuffer(): void {
    this.deleted.push('buffer');
  }
  bindBuffer(): void {}
  bufferData(): void {}
  getAttribLocation(): number {
    return 0;
  }
  enableVertexAttribArray(): void {}
  vertexAttribPointer(): void {}
  getUniformLocation(_p: object, name: string): object {
    let loc = this.locations.get(name);
    if (!loc) {
      loc = { name };
      this.locations.set(name, loc);
    }
    return loc;
  }
  uniform1f(loc: { name: string } | null, v: number): void {
    if (loc) this.uniforms.set(loc.name, [v]);
  }
  uniform2f(loc: { name: string } | null, a: number, b: number): void {
    if (loc) this.uniforms.set(loc.name, [a, b]);
  }
  viewport(): void {}
  drawArrays(): void {
    this.drawCalls++;
  }
}

const SOURCE = `#ifdef GL_ES
precision highp float;
#endif
uniform float iTime;
uniform vec2 iResolution;
float num_arms = 3.0;
float rotation_speed = 4.;
float spiral_angle = 60.;
float pattern_speed = 2.;
float warp_speed = 0.;
void main(void){ gl_FragColor = vec4(vec3(0.1), 1.0); }`;

/**
 * The canvas surface `mountBackdrop` actually uses. Deliberately minimal: if a
 * future edit reaches for another DOM member, this test fails loudly rather
 * than quietly depending on a browser.
 */
function makeCanvas(gl: FakeGL | null): HTMLCanvasElement {
  return {
    clientWidth: 800,
    clientHeight: 600,
    width: 0,
    height: 0,
    getContext: () => gl,
  } as unknown as HTMLCanvasElement;
}

/** Drives the rAF loop a fixed number of times. */
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pump(times = 1): void {
  for (let i = 0; i < times; i++) {
    const next = rafQueue.shift();
    if (next) next(0);
  }
}

describe('mountBackdrop', () => {
  it('degrades to an inert handle when WebGL is unavailable — never throws', () => {
    const handle = mountBackdrop(makeCanvas(null), 'pink_spiral', { source: SOURCE });
    expect(handle.active).toBe(false);
    // Every method stays callable, so the session code has no branch to write.
    expect(() => {
      handle.setProgress(0.5);
      handle.setPulseHz(3.25);
      handle.setOpacity(0.2);
      handle.dispose();
    }).not.toThrow();
  });

  it('degrades when the shader fails to compile', () => {
    const gl = new FakeGL();
    gl.failCompile = true;
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE });
    expect(handle.active).toBe(false);
  });

  it('degrades when the program fails to link', () => {
    const gl = new FakeGL();
    gl.failLink = true;
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE });
    expect(handle.active).toBe(false);
  });

  it('degrades when no shader source was preloaded', () => {
    // §6.5 has the setup screen compile the shader while the user reads their
    // sample. If that did not happen, the session opens on black rather than
    // stalling on a fetch.
    const handle = mountBackdrop(makeCanvas(new FakeGL()), 'pink_spiral', {});
    expect(handle.active).toBe(false);
  });

  it('mounts and draws when GL is available', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE, now: () => 0 });
    expect(handle.active).toBe(true);
    pump();
    expect(gl.drawCalls).toBe(1);
    handle.dispose();
  });

  it('sets every uniform DESIGN.md 5.5 names, plus the safety uniforms', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE, now: () => 0 });
    handle.setProgress(0.62);
    pump();

    for (const name of [
      'num_arms',
      'rotation_speed',
      'spiral_angle',
      'pattern_speed',
      'warp_speed',
      'iTime',
      'iResolution',
      'u_maxLuminance',
      'u_opacity',
    ]) {
      expect(gl.uniforms.has(name), name).toBe(true);
    }
    handle.dispose();
  });

  it('carries the contrast ceiling into the fragment stage', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE, now: () => 0 });
    pump();
    const [ceiling] = gl.uniforms.get('u_maxLuminance') ?? [];
    // The derived C9 ceiling, not 1.0 and not zero.
    expect(ceiling).toBeGreaterThan(0);
    expect(ceiling).toBeLessThan(0.05);
    handle.dispose();
  });

  it('progress actually moves the uniforms', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE, now: () => 0 });

    handle.setProgress(0);
    pump();
    const atRest = gl.uniforms.get('rotation_speed')?.[0];

    handle.setProgress(0.62);
    pump();
    const atPeak = gl.uniforms.get('rotation_speed')?.[0];

    expect(atPeak).toBeGreaterThan(atRest as number);
    handle.dispose();
  });

  it('clamps progress and opacity into range', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE, now: () => 0 });

    handle.setProgress(50);
    handle.setOpacity(50);
    pump();
    expect(gl.uniforms.get('u_opacity')?.[0]).toBe(1);

    handle.setOpacity(-50);
    pump();
    expect(gl.uniforms.get('u_opacity')?.[0]).toBe(0);
    handle.dispose();
  });

  it('reduced motion holds the field still while still drawing it', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', {
      source: SOURCE,
      reducedMotion: true,
      now: () => 5000,
    });
    handle.setProgress(0.62);
    pump();

    expect(gl.uniforms.get('rotation_speed')?.[0]).toBe(0);
    expect(gl.uniforms.get('pattern_speed')?.[0]).toBe(0);
    // iTime is frozen, so even a time-driven shader stops animating.
    expect(gl.uniforms.get('iTime')?.[0]).toBe(0);
    // But the field is still being painted — a working static-field session.
    expect(gl.drawCalls).toBeGreaterThan(0);
    handle.dispose();
  });

  it('an unselectable shader falls back to the default rather than rendering white', () => {
    const gl = new FakeGL();
    // radiating_dots cannot clear C9; asking for it must not honor the request.
    const handle = mountBackdrop(makeCanvas(gl), 'radiating_dots', { source: SOURCE, now: () => 0 });
    expect(handle.active).toBe(true);
    expect(handle.shader).toBe(DEFAULT_SHADER);
    expect(handle.shader).not.toBe('radiating_dots');
    handle.dispose();
  });

  it('an unknown shader id falls back rather than throwing', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'does_not_exist', { source: SOURCE, now: () => 0 });
    expect(handle.shader).toBe(DEFAULT_SHADER);
    expect(() => handle.dispose()).not.toThrow();
  });

  it('honors a selectable shader that was actually asked for', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'Bambi_Fog_001', { source: SOURCE, now: () => 0 });
    expect(handle.shader).toBe('Bambi_Fog_001');
    handle.dispose();
  });

  it('resolveShader agrees with what mounting actually picks', () => {
    // The setup screen preloads a source using resolveShader; if the two ever
    // disagreed it would preload one shader and mount another.
    const gl = new FakeGL();
    for (const requested of ['radiating_dots', 'candy_cloud', 'Bambi_Fog_001', 'nonsense']) {
      const handle = mountBackdrop(makeCanvas(gl), requested, { source: SOURCE, now: () => 0 });
      expect(handle.shader, requested).toBe(resolveShader(requested));
      handle.dispose();
    }
  });

  it('an inert backdrop still reports which shader it would have used', () => {
    const handle = mountBackdrop(makeCanvas(null), 'Bambi_Fog_001', { source: SOURCE });
    expect(handle.active).toBe(false);
    expect(handle.shader).toBe('Bambi_Fog_001');
  });

  it('dispose stops the loop and releases GL objects, and is idempotent', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE, now: () => 0 });
    pump();
    const before = gl.drawCalls;

    handle.dispose();
    handle.dispose();
    pump(3);

    expect(gl.drawCalls).toBe(before);
    expect(gl.deleted).toContain('program');
    expect(gl.deleted).toContain('buffer');
  });

  it('ignores a nonsense pulse rate instead of freezing the field', () => {
    const gl = new FakeGL();
    const handle = mountBackdrop(makeCanvas(gl), 'pink_spiral', { source: SOURCE, now: () => 1000 });
    handle.setPulseHz(0);
    handle.setPulseHz(Number.NaN);
    handle.setPulseHz(-4);
    expect(() => pump()).not.toThrow();
    handle.dispose();
  });
});
