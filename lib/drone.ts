/**
 * Isochronic Drone Generator
 *
 * Web Audio API port of hypnocli/audio/binaural.py --preset drone
 *
 * Creates a 4-tone isochronic drone:
 * - High band: 310 Hz (L) / 314 Hz (R) at 5 Hz pulse
 * - Low band: 58 Hz (L) / 62 Hz (R) at 3.25 Hz pulse, -6 dB
 * - R channel phase offset for L/R ping-pong effect
 * - Raised cosine envelope for smooth pulsing
 */

export interface DroneConfig {
  fadeInSec: number;
  fadeOutSec: number;
  interleaveMs: number;
  targetDb: number;
}

const DEFAULT_CONFIG: DroneConfig = {
  fadeInSec: 1.75,
  fadeOutSec: 1.75,
  interleaveMs: 100,
  targetDb: -28,
};

interface ToneSpec {
  carrierHz: number;
  pulseHz: number;
  amplitudeDb: number;
  ear: 'L' | 'R';
}

const DRONE_PRESET: ToneSpec[] = [
  { carrierHz: 310, pulseHz: 5.0, amplitudeDb: 0, ear: 'L' },
  { carrierHz: 314, pulseHz: 5.0, amplitudeDb: 0, ear: 'R' },
  { carrierHz: 58, pulseHz: 3.25, amplitudeDb: -6, ear: 'L' },
  { carrierHz: 62, pulseHz: 3.25, amplitudeDb: -6, ear: 'R' },
];

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Creates a single isochronic tone with raised cosine envelope
 */
function createIsochronicTone(
  ctx: AudioContext,
  spec: ToneSpec,
  phaseOffset: number,
  destination: AudioNode
): { oscillator: OscillatorNode; gainNode: GainNode } {
  // Create carrier oscillator
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = spec.carrierHz;

  // Create gain node for amplitude envelope
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0; // Start silent

  // Create LFO for isochronic pulsing
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = spec.pulseHz;

  // Create gain for LFO depth (converts -1..1 to 0..1 raised cosine)
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.5 * dbToLinear(spec.amplitudeDb);

  // Create constant offset to shift LFO from -1..1 to 0..1
  const lfoOffset = ctx.createConstantSource();
  lfoOffset.offset.value = 0.5 * dbToLinear(spec.amplitudeDb);

  // Apply true 180° phase offset for R channel ping-pong
  // Half period delay = 180° regardless of frequency
  if (phaseOffset > 0) {
    const halfPeriod = 0.5 / spec.pulseHz;
    lfo.start(ctx.currentTime + halfPeriod);
  } else {
    lfo.start(ctx.currentTime);
  }

  // Connect LFO modulation
  // gainNode.gain = lfoOffset + lfo * lfoGain = 0.5 + 0.5*sin(t) = raised cosine
  lfo.connect(lfoGain);
  lfoGain.connect(gainNode.gain);
  lfoOffset.connect(gainNode.gain);
  lfoOffset.start();

  // Connect carrier through gain to destination
  oscillator.connect(gainNode);
  gainNode.connect(destination);

  oscillator.start();

  return { oscillator, gainNode };
}

export class DronePlayer {
  private ctx: AudioContext | null = null;
  private tones: { oscillator: OscillatorNode; gainNode: GainNode }[] = [];
  private masterGain: GainNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private leftGain: GainNode | null = null;
  private rightGain: GainNode | null = null;
  private config: DroneConfig;
  private isPlaying = false;
  private isFadingOut = false;

  constructor(config: Partial<DroneConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.isPlaying) return;

    // Create or resume audio context
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    // Create stereo merger (L/R channels)
    this.merger = this.ctx.createChannelMerger(2);

    // Create separate gain nodes for L and R
    this.leftGain = this.ctx.createGain();
    this.rightGain = this.ctx.createGain();
    this.leftGain.gain.value = 1;
    this.rightGain.gain.value = 1;

    // Connect L/R to merger
    this.leftGain.connect(this.merger, 0, 0);
    this.rightGain.connect(this.merger, 0, 1);

    // Create master gain for fade in/out
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;
    this.merger.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    // Create tones
    for (const spec of DRONE_PRESET) {
      const destination = spec.ear === 'L' ? this.leftGain : this.rightGain;
      // True 180° offset for R channel (phaseOffset > 0 triggers half-period delay)
      const phaseOffset = spec.ear === 'R' ? Math.PI : 0;

      const tone = createIsochronicTone(
        this.ctx,
        spec,
        phaseOffset,
        destination
      );
      this.tones.push(tone);
    }

    // Fade in
    const targetGain = dbToLinear(this.config.targetDb);
    this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(
      targetGain,
      this.ctx.currentTime + this.config.fadeInSec
    );

    this.isPlaying = true;
    this.isFadingOut = false;
  }

  async stop(): Promise<void> {
    if (!this.isPlaying || !this.ctx || !this.masterGain || this.isFadingOut) return;

    this.isFadingOut = true;

    // Fade out
    const currentTime = this.ctx.currentTime;
    const currentGain = this.masterGain.gain.value;
    this.masterGain.gain.setValueAtTime(currentGain, currentTime);
    this.masterGain.gain.linearRampToValueAtTime(
      0,
      currentTime + this.config.fadeOutSec
    );

    // Wait for fade out, then clean up
    await new Promise(resolve => setTimeout(resolve, this.config.fadeOutSec * 1000 + 100));

    this.cleanup();
  }

  private cleanup(): void {
    // Stop and disconnect all tones
    for (const tone of this.tones) {
      tone.oscillator.stop();
      tone.oscillator.disconnect();
      tone.gainNode.disconnect();
    }
    this.tones = [];

    // Disconnect nodes
    this.merger?.disconnect();
    this.leftGain?.disconnect();
    this.rightGain?.disconnect();
    this.masterGain?.disconnect();

    this.merger = null;
    this.leftGain = null;
    this.rightGain = null;
    this.masterGain = null;

    this.isPlaying = false;
    this.isFadingOut = false;
  }

  get playing(): boolean {
    return this.isPlaying && !this.isFadingOut;
  }

  /**
   * Clean up audio context when done
   */
  dispose(): void {
    this.cleanup();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
