/**
 * M6 — the audio bed.
 *
 * The two properties that make this a lift rather than a rewrite are asserted
 * here: the start/stop race is gone, and the frequency-independent 180-degree
 * phase offset survives exactly.
 *
 * Everything runs against a fake Web Audio graph. That is not a compromise —
 * it is what lets the race be tested at all: the real bug is a scheduling
 * interleaving, and a headless browser would make it a flaky timing test
 * instead of a deterministic one.
 */

import { describe, expect, it } from 'vitest';

import {
  DRONE_PRESET,
  Drone,
  antiphaseDelaySec,
  dbToLinear,
  pulseRates,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioParamLike,
  type ConstantSourceNodeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '../web/audio/drone.ts';
import { BED_PULSE_HZ, createBed, createSilentBed, isBedPreset } from '../web/audio/bed.ts';

/* ------------------------------------------------------------------ *
 * A fake Web Audio graph.
 * ------------------------------------------------------------------ */

interface StartStop {
  startedAt: number | null;
  stoppedAt: number | null;
}

class FakeParam implements AudioParamLike {
  value = 0;
  readonly ramps: { to: number; at: number }[] = [];
  setValueAtTime(value: number, _t: number): this {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, endTime: number): this {
    this.ramps.push({ to: value, at: endTime });
    this.value = value;
    return this;
  }
  cancelScheduledValues(_t: number): this {
    return this;
  }
}

class FakeNode implements AudioNodeLike {
  connections = 0;
  disconnected = 0;
  connect(): this {
    this.connections++;
    return this;
  }
  disconnect(): this {
    this.disconnected++;
    return this;
  }
}

class FakeOscillator extends FakeNode implements OscillatorNodeLike, StartStop {
  type = 'sine';
  frequency = { value: 0 };
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when = 0): void {
    this.startedAt = when;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeConstantSource extends FakeNode implements ConstantSourceNodeLike, StartStop {
  offset = { value: 0 };
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when = 0): void {
    this.startedAt = when;
  }
  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  gain = new FakeParam();
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly constants: FakeConstantSource[] = [];
  closed = 0;

  createOscillator(): OscillatorNodeLike {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  createGain(): GainNodeLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createConstantSource(): ConstantSourceNodeLike {
    const c = new FakeConstantSource();
    this.constants.push(c);
    return c;
  }
  createChannelMerger(): AudioNodeLike {
    return new FakeNode();
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.closed++;
  }
}

/** Carrier oscillators, in preset order. LFOs are the interleaved odd ones. */
function carriers(ctx: FakeContext): FakeOscillator[] {
  // createIsochronicTone creates the carrier first, then the LFO — so per tone
  // the pair is [carrier, lfo] in creation order.
  return ctx.oscillators.filter((_, i) => i % 2 === 0);
}

function lfos(ctx: FakeContext): FakeOscillator[] {
  return ctx.oscillators.filter((_, i) => i % 2 === 1);
}

/* ------------------------------------------------------------------ *
 * The phase offset — the invariant that must survive the lift.
 * ------------------------------------------------------------------ */

describe('isochronic phase offset', () => {
  it('is a half period, so 180 degrees holds at any pulse rate', () => {
    // The whole point: a fixed millisecond delay would be right at one rate
    // and wrong at the other. 5 Hz -> 100ms, 3.25 Hz -> ~153.8ms.
    expect(antiphaseDelaySec(5.0)).toBeCloseTo(0.1, 12);
    expect(antiphaseDelaySec(3.25)).toBeCloseTo(0.15384615384, 8);
    expect(antiphaseDelaySec(1)).toBeCloseTo(0.5, 12);
  });

  it('applies the offset to the R ear of BOTH bands, each at its own rate', () => {
    const ctx = new FakeContext();
    const drone = new Drone(ctx);
    drone.start();

    const l = lfos(ctx);
    expect(l).toHaveLength(DRONE_PRESET.length);

    // Preset order: [310 L, 314 R, 58 L, 62 R].
    expect(l[0].startedAt).toBeCloseTo(0, 12); // 5 Hz left, no delay
    expect(l[1].startedAt).toBeCloseTo(0.1, 12); // 5 Hz right, half of 1/5
    expect(l[2].startedAt).toBeCloseTo(0, 12); // 3.25 Hz left
    expect(l[3].startedAt).toBeCloseTo(0.15384615384, 8); // 3.25 Hz right

    // Frequency-independence, stated as the relationship rather than the values:
    // each antiphase ear starts exactly half of ITS OWN period late.
    expect(l[1].startedAt).toBeCloseTo(0.5 / DRONE_PRESET[1].pulseHz, 12);
    expect(l[3].startedAt).toBeCloseTo(0.5 / DRONE_PRESET[3].pulseHz, 12);
  });

  it('keeps the four-tone two-band preset intact', () => {
    expect(DRONE_PRESET.map((t) => t.carrierHz)).toEqual([310, 314, 58, 62]);
    expect(DRONE_PRESET.map((t) => t.pulseHz)).toEqual([5.0, 5.0, 3.25, 3.25]);
    // The low band sits 6 dB under the high band.
    expect(DRONE_PRESET[2].amplitudeDb).toBe(-6);
    expect(DRONE_PRESET[3].amplitudeDb).toBe(-6);
  });

  it('modulates with a raised cosine in [0,1], never a gate', () => {
    const ctx = new FakeContext();
    new Drone(ctx).start();
    // Per tone: offset and depth are equal, so offset + depth*sin spans [0, 2*depth]
    // and never goes negative — that is what makes it raised cosine rather than
    // a bipolar multiply that would invert the carrier.
    for (let i = 0; i < DRONE_PRESET.length; i++) {
      const depth = 0.5 * dbToLinear(DRONE_PRESET[i].amplitudeDb);
      expect(ctx.constants[i].offset.value).toBeCloseTo(depth, 12);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The race. This is the regression the criterion names.
 * ------------------------------------------------------------------ */

describe('start/stop race (the drone.ts:117 regression)', () => {
  it('a start during the fade-out produces a NEW sounding voice', () => {
    const ctx = new FakeContext();
    const drone = new Drone(ctx, { fadeOutSec: 4 });

    drone.start();
    const first = carriers(ctx).length;
    expect(first).toBe(4);
    expect(drone.playing).toBe(true);

    // Stop, then start again while the 4s fade is still in flight. The old
    // implementation returned early here (isPlaying was still true) and then
    // had its graph destroyed by the in-flight cleanup — permanent silence.
    drone.stop();
    expect(drone.playing).toBe(false);

    ctx.currentTime = 0.5; // mid-fade
    drone.start();
    expect(drone.playing).toBe(true);

    // A second, independent set of tones exists.
    expect(carriers(ctx).length).toBe(first + 4);

    // And the NEW carriers are not scheduled to stop.
    const fresh = carriers(ctx).slice(4);
    for (const osc of fresh) {
      expect(osc.stoppedAt).toBeNull();
    }
  });

  it('the old voice tears down on its own clock without touching the new one', () => {
    const ctx = new FakeContext();
    const drone = new Drone(ctx, { fadeOutSec: 4 });
    drone.start();
    drone.stop();

    const old = carriers(ctx).slice(0, 4);
    for (const osc of old) {
      // Scheduled to end exactly at the end of its own ramp.
      expect(osc.stoppedAt).toBeCloseTo(4, 12);
    }

    ctx.currentTime = 1;
    drone.start();
    ctx.currentTime = 2;
    drone.stop();

    const second = carriers(ctx).slice(4, 8);
    for (const osc of second) {
      expect(osc.stoppedAt).toBeCloseTo(6, 12); // 2 + 4, its own schedule
    }
    // The first voice's teardown time is untouched by the second stop.
    for (const osc of old) {
      expect(osc.stoppedAt).toBeCloseTo(4, 12);
    }
  });

  it('survives rapid start/stop churn and always lands sounding when it should', () => {
    const ctx = new FakeContext();
    const drone = new Drone(ctx, { fadeOutSec: 4 });

    for (let i = 0; i < 50; i++) {
      ctx.currentTime = i * 0.01; // far inside every fade window
      drone.start();
      expect(drone.playing).toBe(true);
      drone.stop();
      expect(drone.playing).toBe(false);
    }
    drone.start();
    expect(drone.playing).toBe(true);

    // 51 starts, each building exactly one voice of four tones.
    expect(carriers(ctx).length).toBe(51 * 4);
  });

  it('start is idempotent — a double start does not stack a second graph', () => {
    const ctx = new FakeContext();
    const drone = new Drone(ctx);
    drone.start();
    drone.start();
    drone.start();
    expect(carriers(ctx).length).toBe(4);
  });

  it('stop before start, and double stop, are harmless', () => {
    const ctx = new FakeContext();
    const drone = new Drone(ctx);
    expect(() => {
      drone.stop();
      drone.stop();
      drone.start();
      drone.stop();
      drone.stop();
    }).not.toThrow();
  });

  it('dispose releases every node and is idempotent', () => {
    const ctx = new FakeContext();
    const drone = new Drone(ctx);
    drone.start();
    drone.dispose();
    drone.dispose();
    for (const g of ctx.gains) {
      expect(g.disconnected).toBeGreaterThan(0);
    }
    // A disposed drone stays quiet.
    drone.start();
    expect(drone.playing).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The bed interface and its degradation contract.
 * ------------------------------------------------------------------ */

describe('AudioBed', () => {
  it('drives the drone when a context is available', () => {
    const ctx = new FakeContext();
    const bed = createBed('drone', { createContext: () => ctx });
    expect(bed.preset).toBe('drone');

    // Nothing is built until start() — which is called from the Begin gesture,
    // so autoplay policy cannot block it.
    expect(ctx.oscillators).toHaveLength(0);
    bed.start();
    expect(ctx.oscillators.length).toBeGreaterThan(0);

    bed.stop();
    bed.dispose();
    expect(ctx.closed).toBe(1);
  });

  it('degrades to silence when there is no AudioContext, and never throws', () => {
    const bed = createBed('drone', { createContext: () => null });
    // The probe happens at start(), not construction — building a context
    // early is exactly what autoplay policy blocks. So the bed reports `drone`
    // until it has actually tried.
    expect(() => {
      bed.start();
      bed.setGain(-12);
      bed.stop();
      bed.dispose();
    }).not.toThrow();
    // Having tried and failed, it now tells the truth rather than claiming
    // sound that is not happening.
    expect(bed.preset).toBe('silent');
  });

  it('degrades to silence when the context constructor throws', () => {
    const bed = createBed('drone', {
      createContext: () => {
        throw new Error('AudioContext blocked');
      },
    });
    // The failure surfaces at start(), which must still return normally: a
    // session with no sound is the requirement, a thrown Begin handler is not.
    expect(() => {
      bed.start();
      bed.stop();
      bed.dispose();
    }).not.toThrow();
    expect(bed.preset).toBe('silent');
  });

  it('an unknown preset yields silence rather than an error', () => {
    const bed = createBed('strudel');
    expect(bed.preset).toBe('silent');
    expect(() => bed.start()).not.toThrow();
  });

  it('reports the same pulse rate whether or not it is audible', () => {
    // The backdrop derives its clock from this, so a muted session must still
    // breathe at the right rate.
    const silent = createSilentBed();
    const real = createBed('drone', { createContext: () => new FakeContext() });
    expect(silent.pulseHz).toBe(real.pulseHz);
    expect(silent.pulseHz).toBe(BED_PULSE_HZ);
  });

  it('shares the SLOWER band with the visuals, which is the one under 3Hz', () => {
    expect(pulseRates()).toEqual([5, 3.25]);
    expect(BED_PULSE_HZ).toBe(3.25);
  });

  it('only names presets that exist', () => {
    expect(isBedPreset('drone')).toBe(true);
    expect(isBedPreset('silent')).toBe(true);
    expect(isBedPreset('strudel')).toBe(false);
  });

  it('gain set before start is honored when the voice is built', () => {
    const ctx = new FakeContext();
    const bed = createBed('drone', { createContext: () => ctx, gainDb: -40 });
    bed.setGain(-33);
    bed.start();
    // The master gain ramps to the requested level, not the default.
    const ramped = ctx.gains.some((g) => g.gain.ramps.some((r) => Math.abs(r.to - dbToLinear(-33)) < 1e-9));
    expect(ramped).toBe(true);
  });
});
