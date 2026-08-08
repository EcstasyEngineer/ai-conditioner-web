/**
 * The WebGL backdrop host — DESIGN.md §5.5, §5.6.
 *
 * One fragment shader, full-viewport, driven by session progress. That is all
 * it is; the 2D-canvas spiral the old app ran is gone and the shaders in
 * `public/shaders/` are the field.
 *
 * Three things this file is responsible for beyond "draw the shader":
 *
 *   1. **The shared clock.** The backdrop's transition rate is DERIVED from
 *      the bed's pulse rate (§5.5), so visuals and entrainment breathe
 *      together instead of beating against each other. `setPulseHz` is how the
 *      bed tells it; the breathing modulation is that rate divided down into
 *      the 0.4-1.2 Hz band `public/shaders/notes.md` asks for.
 *
 *   2. **The luminance clamp.** `u_maxLuminance` carries C9's ceiling into the
 *      fragment stage, where each sampled colour is scaled under it. See
 *      `contrast.ts` for why a global opacity could not do this job.
 *
 *   3. **Honoring notes.md.** Uniform changes are eased continuously and
 *      cross-faded through a brightness dip rather than switched — "sync with
 *      the breathing cycle" and "smooth visual fade to mask the change", which
 *      is the one genuinely thoughtful design document already in the repo.
 *
 * A backdrop that cannot initialize DEGRADES TO NOTHING and never throws: a
 * missing WebGL context leaves a black field and a session that still runs, the
 * same contract the audio bed keeps.
 */

import { fieldLuminanceCeiling } from './contrast.ts';
import {
  DEFAULT_SHADER,
  SHADERS,
  isShaderId,
  type ShaderId,
} from './shaders/registry.ts';
import {
  DEFAULT_UNIFORM_SCHEDULE,
  clampFieldRate,
  reducedMotionUniforms,
  uniformsAt,
  type ShaderUniforms,
  type UniformSchedule,
} from './uniforms.ts';

export type { ShaderId } from './shaders/registry.ts';

/** What the caller gets back. Mirrors `AudioBed`'s shape: no promises, idempotent. */
export interface BackdropHandle {
  /** Session progress in [0,1]. Drives every uniform. */
  setProgress(p: number): void;
  /**
   * The bed's isochronic pulse rate. The field's breathing is derived from it
   * so the two systems share one clock (§5.5).
   */
  setPulseHz(hz: number): void;
  /** Master fade for the threshold and the exit (§6.5, §6.6). */
  setOpacity(a: number): void;
  /** Release GL resources and stop the draw loop. */
  dispose(): void;
  /** False when WebGL was unavailable and the field is a no-op. */
  readonly active: boolean;
  /**
   * The shader actually mounted.
   *
   * Not necessarily the one requested: an unknown id, or one rejected by the
   * C9 contrast gate, silently resolves to the default. A caller that needs to
   * preload the matching source — §6.5 has the setup screen do exactly that —
   * must be able to read back what was chosen rather than assume its request
   * was honored.
   */
  readonly shader: ShaderId;
}

export interface BackdropOptions {
  /** Defaults to `pink_spiral`. An unknown or unselectable id falls back to it. */
  shader?: ShaderId | string;
  /** Overrides for the progress-to-uniform mapping. */
  schedule?: Readonly<UniformSchedule>;
  /**
   * Static field, no motion (§5.6). When omitted the media query is read from
   * the environment; pass explicitly to force either way.
   */
  reducedMotion?: boolean;
  /** The shader source. Injectable so a test never needs the network. */
  source?: string;
  /** Clock source. Defaults to `performance.now`. Never `Date.now` (§5.4). */
  now?: () => number;
}

/**
 * The vertex stage: a full-viewport triangle pair. The shaders are all
 * `gl_FragCoord`-driven, so the vertex shader carries no varyings at all.
 */
const VERTEX_SOURCE = `attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * Wraps a ShaderToy-style fragment source so it compiles standalone and
 * obeys the luminance ceiling.
 *
 * The shaders declare `iTime`/`iResolution` themselves and define `main()`, so
 * the wrapper cannot simply prepend a `main` — instead it renames the source's
 * entry point and calls it, then post-processes the result. The five tunable
 * parameters are file-scope `float` globals in the sources; they are rewritten
 * to uniforms so the session can drive them.
 */
export function prepareFragmentSource(source: string, uniformNames: readonly string[]): string {
  let out = source;

  // Lift `float num_arms = 3.0;` to `uniform float num_arms;`. The shaders
  // declare these at file scope with initializers; a uniform cannot carry one.
  for (const name of uniformNames) {
    const decl = new RegExp(`^\\s*float\\s+${name}\\s*=\\s*[^;]+;\\s*$`, 'm');
    if (decl.test(out)) {
      out = out.replace(decl, `uniform float ${name};`);
    } else if (!new RegExp(`uniform\\s+float\\s+${name}\\b`).test(out)) {
      // Not present in this shader at all — declare it so the host can set it
      // uniformly across shaders. GLSL drops unused uniforms; the host tolerates
      // a null location.
      out = `uniform float ${name};\n${out}`;
    }
  }

  // Rename the source's entry point so the wrapper owns `main`.
  out = out.replace(/\bvoid\s+main\s*\(\s*(?:void)?\s*\)/, 'void hypnoapp_shader_main()');

  return `${out}

uniform float u_maxLuminance;
uniform float u_opacity;

// WCAG relative luminance, matching contrast.ts. sRGB approximation with a
// gamma of 2.2 rather than the piecewise transfer: the difference is under a
// percent at these levels and the clamp already carries a 0.9 safety margin.
float hypnoapp_luminance(vec3 c) {
  vec3 lin = pow(clamp(c, 0.0, 1.0), vec3(2.2));
  return dot(lin, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  hypnoapp_shader_main();

  vec3 color = gl_FragColor.rgb;

  // C9: scale any colour whose luminance exceeds the ceiling back under it.
  // Colours already below pass through untouched, so the dark structure of the
  // field survives and only near-white pixels are pulled down.
  float l = hypnoapp_luminance(color);
  if (l > u_maxLuminance) {
    color *= u_maxLuminance / l;
  }

  gl_FragColor = vec4(color * u_opacity, 1.0);
}`;
}

const TUNABLE: readonly (keyof ShaderUniforms)[] = [
  'num_arms',
  'rotation_speed',
  'spiral_angle',
  'pattern_speed',
  'warp_speed',
];

/** A backdrop that draws nothing. Returned when WebGL is unavailable. */
function inertHandle(shader: ShaderId): BackdropHandle {
  return {
    setProgress() {},
    setPulseHz() {},
    setOpacity() {},
    dispose() {},
    active: false,
    shader,
  };
}

/**
 * Which shader a request actually resolves to.
 *
 * Exported so the setup screen can preload the right source BEFORE Begin
 * (§6.5) — the fallback happens here, not at mount time, so the caller and the
 * host agree on the answer without either guessing.
 *
 * A shader rejected by the C9 contrast gate is treated exactly like an unknown
 * one: the request is not honored, and the field falls back to a shader that
 * text can be read against.
 */
export function resolveShader(shader: ShaderId | string = DEFAULT_SHADER): ShaderId {
  return isShaderId(shader) && SHADERS[shader].selectable ? shader : DEFAULT_SHADER;
}

function prefersReducedMotion(): boolean {
  try {
    const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
    return mm ? mm('(prefers-reduced-motion: reduce)').matches : false;
  } catch {
    return false;
  }
}

/**
 * The breathing band `notes.md` asks transitions to sync with.
 *
 * The bed pulses at 3.25 Hz; a breath is far slower. Dividing the pulse by 4
 * lands at ~0.81 Hz, inside the 0.4-1.2 Hz band, and — this is the point —
 * PHASE-LOCKED to the pulse rather than independently chosen, so the field
 * swells on a multiple of the tone the user is entraining to.
 */
export const BREATH_DIVISOR = 4;

export function breathHz(pulseHz: number): number {
  return pulseHz / BREATH_DIVISOR;
}

/**
 * Mount the field.
 *
 * Starts its own `requestAnimationFrame` loop for the shader clock. That loop
 * is independent of M4's session clock on purpose: the backdrop is decorative
 * and must never be able to stall the text, and the two share nothing but the
 * `progress` float pushed in through `setProgress`.
 */
export function mountBackdrop(
  canvas: HTMLCanvasElement,
  shader: ShaderId | string = DEFAULT_SHADER,
  options: BackdropOptions = {},
): BackdropHandle {
  const id = resolveShader(shader);
  const schedule = options.schedule ?? DEFAULT_UNIFORM_SCHEDULE;
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const now = options.now ?? (() => performance.now());
  const ceiling = fieldLuminanceCeiling();

  let gl: WebGLRenderingContext | null = null;
  try {
    gl =
      (canvas.getContext('webgl', { alpha: false, antialias: false }) as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
  } catch {
    gl = null;
  }
  if (!gl) return inertHandle(id);

  const source = options.source ?? '';
  if (!source) {
    // Nothing to compile. The caller is expected to have fetched the shader on
    // the setup screen (§6.5: the compile happens while the user reads their
    // sample, so Begin has nothing to wait for). Without it, degrade to black.
    return inertHandle(id);
  }

  const context: WebGLRenderingContext = gl;

  function compile(type: number, src: string): WebGLShader | null {
    const sh = context.createShader(type);
    if (!sh) return null;
    context.shaderSource(sh, src);
    context.compileShader(sh);
    if (!context.getShaderParameter(sh, context.COMPILE_STATUS)) {
      context.deleteShader(sh);
      return null;
    }
    return sh;
  }

  const vs = compile(context.VERTEX_SHADER, VERTEX_SOURCE);
  const fs = compile(context.FRAGMENT_SHADER, prepareFragmentSource(source, TUNABLE));
  if (!vs || !fs) return inertHandle(id);

  const program = context.createProgram();
  if (!program) return inertHandle(id);
  context.attachShader(program, vs);
  context.attachShader(program, fs);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    context.deleteProgram(program);
    return inertHandle(id);
  }
  context.useProgram(program);

  // Full-viewport quad.
  const buffer = context.createBuffer();
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(
    context.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    context.STATIC_DRAW,
  );
  const positionLoc = context.getAttribLocation(program, 'a_position');
  context.enableVertexAttribArray(positionLoc);
  context.vertexAttribPointer(positionLoc, 2, context.FLOAT, false, 0, 0);

  const uTime = context.getUniformLocation(program, 'iTime');
  const uResolution = context.getUniformLocation(program, 'iResolution');
  const uMaxLuminance = context.getUniformLocation(program, 'u_maxLuminance');
  const uOpacity = context.getUniformLocation(program, 'u_opacity');
  const tunableLocs = new Map<keyof ShaderUniforms, WebGLUniformLocation | null>();
  for (const name of TUNABLE) {
    tunableLocs.set(name, context.getUniformLocation(program, name));
  }

  let progress = 0;
  let pulseHz = 3.25;
  let opacity = 1;
  let disposed = false;
  let raf = 0;
  const start = now();

  /**
   * The shader's own time, warped to breathe with the bed.
   *
   * `iTime` does not advance linearly: it is modulated by a slow sinusoid at
   * the breath rate derived from the pulse, so the field's motion swells and
   * eases on the same cycle the tone pulses on. The modulation depth is small
   * — this is a breath, not a lurch — and it is zero under reduced motion.
   */
  function shaderTime(elapsedSec: number): number {
    if (reduced) return 0;
    const hz = breathHz(pulseHz);
    const depth = 0.12;
    return elapsedSec + (depth / (2 * Math.PI * hz)) * Math.sin(2 * Math.PI * hz * elapsedSec);
  }

  function resize(): void {
    const dpr = Math.min(2, (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    context.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw(): void {
    if (disposed) return;
    resize();

    const elapsedSec = (now() - start) / 1000;

    let u: ShaderUniforms = reduced ? reducedMotionUniforms(schedule) : uniformsAt(progress, schedule);
    // §5.6's hard ceiling, applied AFTER the schedule so no tuning change can
    // reintroduce a strobe.
    u = clampFieldRate(u);

    context.uniform1f(uTime, shaderTime(elapsedSec));
    context.uniform2f(uResolution, canvas.width, canvas.height);
    context.uniform1f(uMaxLuminance, ceiling);
    context.uniform1f(uOpacity, opacity);
    for (const name of TUNABLE) {
      const loc = tunableLocs.get(name);
      if (loc) context.uniform1f(loc, u[name]);
    }

    context.drawArrays(context.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(draw);
  }

  raf = requestAnimationFrame(draw);

  return {
    setProgress(p: number): void {
      progress = Math.min(1, Math.max(0, p));
    },
    setPulseHz(hz: number): void {
      if (Number.isFinite(hz) && hz > 0) pulseHz = hz;
    },
    setOpacity(a: number): void {
      opacity = Math.min(1, Math.max(0, a));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      try {
        context.deleteProgram(program);
        context.deleteShader(vs);
        context.deleteShader(fs);
        context.deleteBuffer(buffer);
      } catch {
        /* context may already be lost */
      }
    },
    active: true,
    shader: id,
  };
}
