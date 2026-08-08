/**
 * The isochronic drone — DESIGN.md §1.4.
 *
 * Lifted from `lib/drone.ts`, which was itself a Web Audio port of
 * hypnocli's `audio/binaural.py --preset drone`. In hypnocli this bed sat
 * under spoken trance; in hypnoapp there is no speech, so THIS IS the
 * entrainment bed and it is the permanent audio story — not a placeholder for
 * a generative bed that never arrives.
 *
 * Four tones in two bands:
 *
 *   high  310 Hz (L) / 314 Hz (R)  pulsed at 5.0 Hz   at 0 dB
 *   low    58 Hz (L) /  62 Hz (R)  pulsed at 3.25 Hz  at -6 dB
 *
 * The 4 Hz carrier split across the ears is a binaural beat riding inside an
 * isochronic pulse; the amplitude modulation is a RAISED COSINE
 * (`0.5 + 0.5*sin`), never a gate, because a hard gate clicks.
 *
 * Two properties are load-bearing and are the reason this file is a careful
 * lift rather than a rewrite:
 *
 *   1. The 180-degree phase offset between ears is FREQUENCY-INDEPENDENT. It is
 *      applied as a half-PERIOD start delay (`0.5 / pulseHz`), so both the
 *      5.0 Hz band and the 3.25 Hz band land exactly antiphase. Implementing it
 *      as a fixed millisecond delay would be correct at one pulse rate and
 *      wrong at the other, and the ping-pong is the whole perceptual point.
 *
 *   2. The start/stop race at the original `:117` is fixed here (see
 *      `DroneVoice`). The original guarded `start()` with `if (this.isPlaying)
 *      return` while `stop()` held `isPlaying === true` across a ~1.85 s
 *      awaited fade — so a stop/start inside the fade window returned early
 *      from `start()` and then had its graph torn down by the in-flight
 *      `cleanup()`. The caller was left permanently silent with every flag
 *      reading "playing".
 *
 * Nothing here reads a wall clock. Every fade and every teardown is scheduled
 * on `AudioContext.currentTime`, which is the sample clock the fades actually
 * run on — so the repeating timers banned in the session path by
 * `hypnoapp/no-set-interval-in-session-path` are not merely avoided here, they
 * are unnecessary.
 */

/** A minimal structural view of the Web Audio surface this file uses.
 *
 * Declared structurally rather than taken from `lib.dom` so the drone is
 * testable against a fake graph in Node. The browser's real `AudioContext`
 * satisfies it; so does the test double. This is not a shim for the engine —
 * `web/` may use the DOM freely — it is what makes the race regression test
 * runnable without a headless browser.
 */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(startTime: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike, output?: number, input?: number): unknown;
  disconnect(): unknown;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  frequency: { value: number };
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

export interface ConstantSourceNodeLike extends AudioNodeLike {
  offset: { value: number };
  start(when?: number): unknown;
  stop(when?: number): unknown;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  createOscillator(): OscillatorNodeLike;
  createGain(): GainNodeLike;
  createConstantSource(): ConstantSourceNodeLike;
  createChannelMerger(numberOfInputs?: number): AudioNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** How the drone fades and how loud it sits. */
export interface DroneConfig {
  fadeInSec: number;
  fadeOutSec: number;
  /** Gain the bed settles at, in dB. Negative; the bed is under everything. */
  targetDb: number;
}

export const DEFAULT_DRONE_CONFIG: Readonly<DroneConfig> = Object.freeze({
  fadeInSec: 2.0,
  fadeOutSec: 4.0,
  targetDb: -28,
});

/** One tone of the drone. */
export interface ToneSpec {
  carrierHz: number;
  pulseHz: number;
  amplitudeDb: number;
  ear: 'L' | 'R';
  /**
   * True for the ear that starts a half-period late. Antiphase is expressed
   * as a flag rather than a radian value because the delay is DERIVED from
   * `pulseHz` at start time — a stored radian would invite a
   * frequency-dependent conversion, which is the bug this preserves against.
   */
  antiphase: boolean;
}

/**
 * The one preset. `BedPreset` in `bed.ts` is the public name for it.
 *
 * Frozen: a module-level default that a caller can mutate turns "the bed" into
 * a function of import order.
 */
export const DRONE_PRESET: readonly ToneSpec[] = Object.freeze([
  Object.freeze({ carrierHz: 310, pulseHz: 5.0, amplitudeDb: 0, ear: 'L', antiphase: false }),
  Object.freeze({ carrierHz: 314, pulseHz: 5.0, amplitudeDb: 0, ear: 'R', antiphase: true }),
  Object.freeze({ carrierHz: 58, pulseHz: 3.25, amplitudeDb: -6, ear: 'L', antiphase: false }),
  Object.freeze({ carrierHz: 62, pulseHz: 3.25, amplitudeDb: -6, ear: 'R', antiphase: true }),
]) as readonly ToneSpec[];

/** The pulse rates present in the preset, fastest first. */
export function pulseRates(preset: readonly ToneSpec[] = DRONE_PRESET): number[] {
  return [...new Set(preset.map((t) => t.pulseHz))].sort((a, b) => b - a);
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * The half-period start delay that realizes a 180-degree offset at ANY pulse
 * rate — the property called out in DESIGN.md and the reason this is a
 * function rather than a constant.
 *
 * At 5.0 Hz that is 100 ms; at 3.25 Hz it is ~153.8 ms. A single millisecond
 * constant cannot be right for both.
 */
export function antiphaseDelaySec(pulseHz: number): number {
  return 0.5 / pulseHz;
}

interface Tone {
  oscillator: OscillatorNodeLike;
  gainNode: GainNodeLike;
  lfo: OscillatorNodeLike;
  /** The LFO depth node. Held only so teardown can disconnect it. */
  lfoGain: GainNodeLike;
  lfoOffset: ConstantSourceNodeLike;
}

/**
 * Builds one isochronic tone: a sine carrier whose gain is driven by
 * `offset + lfo*depth` = `0.5 + 0.5*sin(2*pi*f*t)`, a raised cosine in [0,1].
 */
function createIsochronicTone(
  ctx: AudioContextLike,
  spec: ToneSpec,
  destination: AudioNodeLike,
): Tone {
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = spec.carrierHz;

  const gainNode = ctx.createGain();
  // Silent until the LFO drives it. A carrier connected at unity would thump.
  gainNode.gain.value = 0;

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = spec.pulseHz;

  const depth = 0.5 * dbToLinear(spec.amplitudeDb);

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = depth;

  const lfoOffset = ctx.createConstantSource();
  lfoOffset.offset.value = depth;

  lfo.connect(lfoGain);
  lfoGain.connect(gainNode.gain);
  lfoOffset.connect(gainNode.gain);

  oscillator.connect(gainNode);
  gainNode.connect(destination);

  const now = ctx.currentTime;
  // THE PRESERVED INVARIANT: a half-period delay, computed from this tone's
  // own pulse rate. Frequency-independent by construction.
  lfo.start(spec.antiphase ? now + antiphaseDelaySec(spec.pulseHz) : now);
  lfoOffset.start(now);
  oscillator.start(now);

  return { oscillator, gainNode, lfo, lfoGain, lfoOffset };
}

/**
 * One generation of the audio graph.
 *
 * The race fix is structural: every start builds a NEW voice, and teardown is
 * addressed to a specific voice rather than to "the player". A fade-out that
 * is still running when the next start arrives can only ever tear down its own
 * nodes, because the nodes it holds are the only ones it can reach.
 */
class DroneVoice {
  private readonly ctx: AudioContextLike;
  private readonly tones: Tone[] = [];
  private readonly masterGain: GainNodeLike;
  private readonly merger: AudioNodeLike;
  private readonly leftGain: GainNodeLike;
  private readonly rightGain: GainNodeLike;
  private stopped = false;

  constructor(ctx: AudioContextLike, preset: readonly ToneSpec[], targetDb: number, fadeInSec: number) {
    this.ctx = ctx;

    this.merger = ctx.createChannelMerger(2);
    this.leftGain = ctx.createGain();
    this.rightGain = ctx.createGain();
    this.leftGain.gain.value = 1;
    this.rightGain.gain.value = 1;
    this.leftGain.connect(this.merger, 0, 0);
    this.rightGain.connect(this.merger, 0, 1);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.merger.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    for (const spec of preset) {
      const destination = spec.ear === 'L' ? this.leftGain : this.rightGain;
      this.tones.push(createIsochronicTone(ctx, spec, destination));
    }

    const now = ctx.currentTime;
    this.masterGain.gain.setValueAtTime(0, now);
    this.masterGain.gain.linearRampToValueAtTime(dbToLinear(targetDb), now + fadeInSec);
  }

  /** Re-target the settle gain without restarting anything. */
  setGain(db: number, rampSec: number): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(dbToLinear(db), now + rampSec);
  }

  /**
   * Fade out and schedule teardown ON THE AUDIO CLOCK.
   *
   * Oscillator `stop(when)` is sample-accurate, so the graph ends itself at the
   * end of the ramp with no wall-clock timer and no pending callback that a
   * later `dispose()` would have to chase.
   */
  fadeOutAndStop(fadeOutSec: number): void {
    if (this.stopped) return;
    this.stopped = true;

    const now = this.ctx.currentTime;
    const end = now + fadeOutSec;

    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0, end);

    for (const tone of this.tones) {
      tone.oscillator.stop(end);
      tone.lfo.stop(end);
      tone.lfoOffset.stop(end);
    }
  }

  /** Immediate teardown. Used by dispose(); never leaves a node connected. */
  teardown(): void {
    this.stopped = true;
    for (const tone of this.tones) {
      // A source already stopped throws on a second stop() in some
      // implementations; the graph is going away either way.
      try {
        tone.oscillator.stop();
      } catch {
        /* already stopped */
      }
      try {
        tone.lfo.stop();
      } catch {
        /* already stopped */
      }
      try {
        tone.lfoOffset.stop();
      } catch {
        /* already stopped */
      }
      tone.oscillator.disconnect();
      tone.gainNode.disconnect();
      tone.lfo.disconnect();
      tone.lfoGain.disconnect();
      tone.lfoOffset.disconnect();
    }
    this.tones.length = 0;
    this.merger.disconnect();
    this.leftGain.disconnect();
    this.rightGain.disconnect();
    this.masterGain.disconnect();
  }
}

/**
 * The drone, as a plain object with no async surface.
 *
 * `start()` and `stop()` are SYNCHRONOUS and idempotent. The original returned
 * promises, which is what let a caller interleave a start into the middle of a
 * stop; here the state transition happens immediately and only the audible
 * fade takes time. That is the whole race fix expressed at the API level.
 */
export class Drone {
  private readonly ctx: AudioContextLike;
  private readonly config: DroneConfig;
  private readonly preset: readonly ToneSpec[];
  private voice: DroneVoice | null = null;
  private gainDb: number;
  private disposed = false;

  constructor(
    ctx: AudioContextLike,
    config: Partial<DroneConfig> = {},
    preset: readonly ToneSpec[] = DRONE_PRESET,
  ) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_DRONE_CONFIG, ...config };
    this.preset = preset;
    this.gainDb = this.config.targetDb;
  }

  /** True when a voice is sounding or fading in. */
  get playing(): boolean {
    return this.voice !== null;
  }

  /**
   * Start sounding. Idempotent: starting an already-started drone is a no-op
   * rather than a second graph.
   *
   * Crucially, a start that arrives while a previous voice is still fading out
   * builds a fresh voice immediately. The old voice keeps fading on its own
   * schedule and tears itself down; it cannot touch the new one.
   */
  start(): void {
    if (this.disposed || this.voice) return;
    this.voice = new DroneVoice(this.ctx, this.preset, this.gainDb, this.config.fadeInSec);
  }

  /**
   * Stop sounding, over `fadeOutSec`.
   *
   * Returns immediately. `playing` reads false the instant this is called, so
   * an interleaved `start()` is never swallowed by a stale flag.
   */
  stop(): void {
    const voice = this.voice;
    this.voice = null;
    voice?.fadeOutAndStop(this.config.fadeOutSec);
  }

  /** Re-target the bed gain, live. Persists across a stop/start. */
  setGain(db: number, rampSec = 0.5): void {
    this.gainDb = db;
    this.voice?.setGain(db, rampSec);
  }

  /** Tear everything down now, with no fade. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.voice?.teardown();
    this.voice = null;
  }
}
