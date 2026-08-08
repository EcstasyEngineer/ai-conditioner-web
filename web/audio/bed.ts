/**
 * The audio bed — DESIGN.md §1.4, DECISIONS.md #3.
 *
 * `AudioBed` is an interface with one implementation. That is a deliberate
 * shape, not a hedge: the owner decision is that the isochronic drone is the
 * PERMANENT audio story and Strudel is dropped entirely (AGPL-3.0 against a
 * public MIT repo). There are no Strudel seams here and no "generative bed
 * coming later" hooks. The interface earns its place for two reasons that hold
 * with exactly one implementation:
 *
 *   - it lets `createBed` return a SILENT bed when audio is unavailable, and
 *     the caller cannot tell the difference (see below); and
 *   - it keeps the session code from holding a Web Audio graph directly, so
 *     "the bed" is four methods rather than a node tree.
 *
 * **Audio failure degrades to a silent session and never blocks one.** A
 * blocked or missing `AudioContext`, a constructor that throws, a browser with
 * no Web Audio at all: each yields a `SilentBed` whose methods are no-ops. The
 * session still runs, the text still paints, the arc is unchanged. Silence is
 * a worse sitting; a thrown exception on the Begin gesture is no sitting.
 *
 * **Autoplay policy is handled structurally.** `createBed` constructs nothing
 * until `start()` is called, and `start()` is called from the Begin click
 * handler — a user gesture. A bed that can only be created inside a gesture
 * cannot be blocked by a policy that only blocks outside one.
 */

import {
  DEFAULT_DRONE_CONFIG,
  DRONE_PRESET,
  Drone,
  pulseRates,
  type AudioContextLike,
  type DroneConfig,
  type ToneSpec,
} from './drone.ts';

/**
 * The presets that exist. One, today, and named rather than boolean so the
 * plan's `bed.preset` string has something to validate against.
 *
 * `silent` is a first-class preset, not an error state: a user who wants the
 * visuals without the tone picks it, and the degradation path returns it.
 */
export type BedPreset = 'drone' | 'silent';

export const BED_PRESETS: readonly BedPreset[] = Object.freeze(['drone', 'silent']) as readonly BedPreset[];

export function isBedPreset(value: string): value is BedPreset {
  return (BED_PRESETS as readonly string[]).includes(value);
}

/**
 * What the session holds instead of an audio graph.
 *
 * Every method is synchronous and idempotent. No promises: an awaited audio
 * call inside a session lifecycle is how the original drone grew its start/stop
 * race, and a bed that cannot be awaited cannot be interleaved wrongly.
 */
export interface AudioBed {
  /** Begin sounding, fading in. Safe to call twice. */
  start(): void;
  /** Fade out and release. Safe to call twice, and safe to call before start. */
  stop(): void;
  /** Re-target gain in dB, live. */
  setGain(db: number): void;
  /** Release everything immediately, no fade. The bed is unusable after this. */
  dispose(): void;
  /** Which preset this bed is playing. `silent` when audio was unavailable. */
  readonly preset: BedPreset;
  /**
   * The pulse rate the backdrop derives its transition rate from (§5.5), in Hz.
   *
   * This is THE shared clock between entrainment and visuals. A silent bed
   * still reports one, so the backdrop breathes at the same rate whether or not
   * the tone is audible — a user on a muted laptop gets the same session shape.
   */
  readonly pulseHz: number;
}

/** Options a caller may pass when building a bed. */
export interface BedOptions {
  /** Settle gain in dB. Defaults to the drone's own target. */
  gainDb?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  /**
   * Factory for the audio context, so a test can inject a fake graph and the
   * browser path stays the default. Returning `null` selects the silent bed.
   */
  createContext?: () => AudioContextLike | null;
}

/**
 * The pulse rate the visuals ride on.
 *
 * The drone's two bands pulse at 5.0 Hz and 3.25 Hz. The BACKDROP is driven by
 * the SLOWER of them, and that choice is a safety constraint rather than an
 * aesthetic one: §5.6 caps anything in the visual field at ~3 Hz, and 3.25 Hz
 * is already over. `mountBackdrop` divides this down into the breathing band;
 * what matters here is that both systems derive from ONE number instead of two
 * independently tuned ones that drift apart in a later edit.
 */
export const BED_PULSE_HZ = Math.min(...pulseRates(DRONE_PRESET));

/**
 * A bed that does nothing, audibly.
 *
 * Returned whenever audio is unavailable, and selectable on purpose. It
 * reports the same `pulseHz` as the real bed so nothing downstream branches on
 * whether sound is actually happening.
 */
class SilentBed implements AudioBed {
  readonly preset: BedPreset = 'silent';
  readonly pulseHz: number = BED_PULSE_HZ;

  start(): void {
    /* silence starts instantly */
  }
  stop(): void {
    /* and stops just as fast */
  }
  setGain(_db: number): void {
    /* no gain to set */
  }
  dispose(): void {
    /* nothing held */
  }
}

/** The isochronic drone behind the interface. */
class DroneBed implements AudioBed {
  readonly pulseHz: number = BED_PULSE_HZ;

  /**
   * What this bed is ACTUALLY playing.
   *
   * A getter rather than a field because the answer is not known at
   * construction: the audio context is not probed until `start()`, since
   * building one earlier is what autoplay policy blocks. Once the bed has
   * tried and failed, it reports `silent` — a caller that asks must not be
   * told sound is playing when the session is running in silence.
   */
  get preset(): BedPreset {
    return this.degraded ? 'silent' : 'drone';
  }

  private degraded = false;

  private readonly makeContext: () => AudioContextLike | null;
  private readonly config: Partial<DroneConfig>;
  private readonly tones: readonly ToneSpec[];
  private ctx: AudioContextLike | null = null;
  private drone: Drone | null = null;
  private gainDb: number;
  private disposed = false;

  constructor(
    makeContext: () => AudioContextLike | null,
    config: Partial<DroneConfig>,
    tones: readonly ToneSpec[] = DRONE_PRESET,
  ) {
    this.makeContext = makeContext;
    this.config = config;
    this.tones = tones;
    this.gainDb = config.targetDb ?? DEFAULT_DRONE_CONFIG.targetDb;
  }

  /**
   * Build the graph on first start — inside the user gesture, never before.
   *
   * Returns false when the context could not be made, which is the whole
   * degradation path: the caller's `start()` still returns normally and the
   * session proceeds in silence.
   */
  private ensure(): boolean {
    if (this.disposed) return false;
    if (this.drone) return true;
    try {
      this.ctx = this.makeContext();
      if (!this.ctx) {
        this.degraded = true;
        return false;
      }
      // A context created outside a gesture can land suspended; resuming inside
      // one is exactly what the autoplay policy wants. Fire-and-forget: the
      // fade-in is scheduled on the audio clock either way, and awaiting here
      // would reintroduce the async surface the race fix removed.
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
      this.drone = new Drone(this.ctx, { ...this.config, targetDb: this.gainDb }, this.tones);
      return true;
    } catch {
      // Web Audio missing, blocked, or out of contexts. Degrade, do not throw.
      this.ctx = null;
      this.drone = null;
      this.degraded = true;
      return false;
    }
  }

  start(): void {
    if (!this.ensure()) return;
    try {
      this.drone?.start();
    } catch {
      /* a bed that cannot sound must not stop a session */
    }
  }

  stop(): void {
    try {
      this.drone?.stop();
    } catch {
      /* idem */
    }
  }

  setGain(db: number): void {
    this.gainDb = db;
    try {
      this.drone?.setGain(db);
    } catch {
      /* idem */
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.drone?.dispose();
      void this.ctx?.close().catch(() => undefined);
    } catch {
      /* teardown is best-effort by definition */
    }
    this.drone = null;
    this.ctx = null;
  }
}

/**
 * The browser's AudioContext, or null where there is not one.
 *
 * Reads the constructor off `globalThis` rather than naming `window` so this
 * module loads in a Node test run without a DOM shim — the file still belongs
 * to `web/`, but a bed that can only be constructed in a browser cannot have
 * its degradation path tested.
 */
function defaultCreateContext(): AudioContextLike | null {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return null;
  return new Ctor();
}

/**
 * Build a bed.
 *
 * NEVER THROWS and never returns null. An unknown preset, a missing Web Audio
 * implementation, or a constructor that blows up all yield a `SilentBed`, so
 * the Begin gesture has exactly one outcome: the session starts.
 */
export function createBed(preset: BedPreset | string = 'drone', options: BedOptions = {}): AudioBed {
  if (preset === 'silent' || !isBedPreset(preset)) {
    return new SilentBed();
  }

  const createContext = options.createContext ?? defaultCreateContext;
  const config: Partial<DroneConfig> = {};
  if (options.gainDb !== undefined) config.targetDb = options.gainDb;
  if (options.fadeInSec !== undefined) config.fadeInSec = options.fadeInSec;
  if (options.fadeOutSec !== undefined) config.fadeOutSec = options.fadeOutSec;

  try {
    return new DroneBed(createContext, config);
  } catch {
    return new SilentBed();
  }
}

/** Exposed so a caller can ask for silence explicitly. */
export function createSilentBed(): AudioBed {
  return new SilentBed();
}
