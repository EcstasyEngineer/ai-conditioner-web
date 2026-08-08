/**
 * The session mount — DESIGN.md §5.3, §5.4, §6.5, §6.6; acceptance C1-C5, C8, C9.
 *
 * `mountSession(root, plan, hooks)` takes over a DOM element and plays a
 * `SessionPlan` in it. It is the composition point for everything M4 owns: the
 * clock (`clock.ts`), the lanes (`lanes.ts`), the opening (`threshold.ts`) and
 * the ending (`exit.ts`). It holds all of the session's mutable state, and it
 * is the only file in the module that knows those four things exist together.
 *
 * ONE LOOP, ONE CLOCK. There is exactly one `requestAnimationFrame` loop in the
 * session path and it lives in `clock.ts`. The threshold does not have a timer,
 * the exit does not have a timer, the lane cross-fades do not have timers —
 * each is a pure function of an accumulated elapsed time, evaluated once per
 * frame from that one loop. This is why backgrounding the tab cannot
 * desynchronize the parts: they cannot drift from each other because there is
 * nothing for them to drift against.
 *
 * The consequence worth stating: a repeating timer is not merely avoided here,
 * it has no place to live. M0's lint rule enforces the letter of that; the
 * shape of this file is what makes it cheap to obey.
 *
 * REACT IS NOT IN THE PATH (§5.4, C4). `mountSession` takes an `HTMLElement`,
 * not a component. M7's play route renders a container and hands it over; from
 * that moment until `dispose()` every pixel change is a direct style write from
 * the rAF callback. React is welcome to re-render the shell around it.
 */

import type { FrameState, LaneId } from '../../engine/types/frame.ts';
import type { SessionPlan } from '../../engine/types/plan.ts';
import { LANE_IDS } from '../../engine/types/frame.ts';
import { CHANNEL_GEOMETRY } from '../../engine/render/geometry.ts';
import { frameAt } from '../../engine/conduct/frameAt.ts';

import {
  createClock,
  type ClockOptions,
  type FrameScheduler,
  type NowFn,
  type SessionClock,
  type VisibilitySource,
} from './clock.ts';
import { LANE_FADE_MS, REDUCED_FADE_MS, mountLanes, type ElementFactory, type LaneLayer } from './lanes.ts';
import { thresholdAt, thresholdSchedule, type ThresholdState } from './threshold.ts';
import { EXIT_LINE, EXIT_LINE_OPACITY, exitAt, exitSchedule, type ExitState } from './exit.ts';

/** What the caller holds. Every method is synchronous and idempotent. */
export interface SessionHandle {
  /** Hold the clock. The field and bed keep their last values; nothing cuts. */
  pause(): void;
  /** Resume from where `pause()` left off. */
  resume(): void;
  /**
   * End early, running the abort-length exit (C9: within 1.5s, with a fade).
   *
   * Not the same as `dispose()`: `stop()` plays the ending, `dispose()` tears
   * the DOM down. Escape calls this one.
   */
  stop(): void;
  /** Release the DOM, the clock and every listener. Safe after `stop()`. */
  dispose(): void;
  /** Accumulated session time. Excludes paused and hidden time. */
  readonly elapsedMs: number;
  /** Whether the clock is currently advancing. */
  readonly running: boolean;
}

/** What the session reports back to the shell. */
export interface SessionHooks {
  /** The session finished — either the plan ran out or `stop()` was called. */
  onEnd(): void;
  /** Session progress in [0,1], once per frame. Drives a shell-owned indicator. */
  onProgress(p: number): void;
}

/**
 * The two things M4 drives but does not own.
 *
 * M6's `BackdropHandle` and `AudioBed` are structurally what these describe,
 * so M7 passes them straight through. They are typed STRUCTURALLY rather than
 * imported so that M4 does not depend on M6: a session with no field and no
 * bed is a session that still runs, and a renderer that imported an audio
 * module to play text would be the wrong shape.
 */
export interface FieldTarget {
  setProgress(p: number): void;
  setPulseHz(hz: number): void;
  setOpacity(a: number): void;
}

export interface BedTarget {
  start(): void;
  stop(): void;
  setGain(db: number): void;
}

export interface MountSessionOptions {
  /** The backdrop. Omitted, the session plays on a plain dark ground. */
  field?: FieldTarget;
  /** The audio bed. Omitted, the session is silent. */
  bed?: BedTarget;
  /**
   * Static field, 200ms cross-fades, no parallax (§5.6, C9).
   *
   * Read from `prefers-reduced-motion` when omitted. Passed explicitly by
   * tests and by any caller that wants to force either way.
   */
  reducedMotion?: boolean;
  /** Monotonic clock. Defaults to `performance.now`. Never `Date.now` (§5.4). */
  now?: NowFn;
  /** Frame scheduler. Defaults to the browser's rAF. */
  scheduler?: FrameScheduler;
  /** Visibility source. Defaults to the real `document` (§5.4). */
  visibility?: VisibilitySource;
  /** Element factory. Defaults to the real `document`. */
  documentRef?: ElementFactory;
  /** Largest delta one frame may contribute. See `ClockOptions.maxFrameMs`. */
  maxFrameMs?: number;
  /**
   * Whether Escape ends the session (C9). Default true.
   *
   * The listener is attached to the document rather than to `root`, because a
   * session's root is not focusable and a user reaching for Escape mid-trance
   * is not going to click first.
   */
  escapeToStop?: boolean;
  /** Where to attach the key listener. Defaults to the real `document`. */
  keyTarget?: KeyTarget;
}

/** The key-listening surface. Narrowed so a test can supply four lines of fake. */
export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (event: { key: string }) => void): void;
  removeEventListener(type: 'keydown', listener: (event: { key: string }) => void): void;
}

/** Which lifecycle stage the mount is in. */
type Stage = 'threshold' | 'playing' | 'exiting' | 'done';

/**
 * The gate targets per phase — DESIGN.md §5.3.
 *
 * "The sides arrive late and leave early." They fade in at the head→middle
 * transition and out at middle→tail; the center is the thread held the whole
 * way. Expressed as data rather than as a phase check inside the paint loop,
 * for the same reason `CHANNEL_GEOMETRY` is a table: this is the ONE place the
 * rule lives, so the head and the tail cannot disagree about it.
 */
const SIDE_GATE_BY_PHASE: Record<FrameState['phase'], number> = {
  head: 0,
  middle: 1,
  tail: 0,
};

export function mountSession(
  root: HTMLElement,
  plan: SessionPlan,
  hooks: SessionHooks,
  options: MountSessionOptions = {},
): SessionHandle {
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();
  const doc = options.documentRef ?? (globalThis as unknown as { document: ElementFactory }).document;
  const fadeMs = reducedMotion ? REDUCED_FADE_MS : LANE_FADE_MS;

  // ---- DOM, built once ----------------------------------------------------

  const stageEl = doc.createElement('div');
  stageEl.className = 'hypnoapp-session';
  stageEl.style.position = 'absolute';
  stageEl.style.inset = '0';
  stageEl.style.overflow = 'hidden';
  // Black, always. The threshold darkens INTO the session and the exit fades
  // back to this, so the ground under everything is the same color at both ends.
  stageEl.style.background = '#000';

  const lanes: LaneLayer = mountLanes(stageEl, { reducedMotion, documentRef: doc, fadeMs });

  // The darkening veil (§6.5). A separate element over the field rather than a
  // background animation, so the field can be at full opacity underneath while
  // the veil is still lifting — that overlap is what makes the open one gesture.
  const veil = doc.createElement('div');
  veil.className = 'hypnoapp-veil';
  veil.style.position = 'absolute';
  veil.style.inset = '0';
  veil.style.background = '#000';
  veil.style.pointerEvents = 'none';
  veil.style.opacity = '1';
  stageEl.appendChild(veil);

  // §6.6's closing line. Present in the DOM from the start with zero opacity
  // and `display:none` — created once, like everything else, because a session
  // that allocates DOM at its most fragile moment is a session that can fail
  // there.
  const closingEl = doc.createElement('div');
  closingEl.className = 'hypnoapp-closing';
  closingEl.style.position = 'absolute';
  closingEl.style.left = '50%';
  closingEl.style.top = '50%';
  closingEl.style.transform = 'translate(-50%, -50%)';
  closingEl.style.opacity = '0';
  closingEl.style.display = 'none';
  closingEl.style.fontSize = '1.1rem';
  closingEl.style.letterSpacing = '0.08em';
  closingEl.textContent = EXIT_LINE;
  stageEl.appendChild(closingEl);

  root.appendChild(stageEl);

  // ---- Mutable session state ----------------------------------------------

  let stage: Stage = 'threshold';
  let exitStartMs = 0;
  let exitAborted = false;
  let ended = false;
  let disposed = false;
  let bedStarted = false;

  /**
   * Per-lane gate alpha, eased toward its phase target one frame at a time.
   *
   * Held as state rather than derived from the frame because a cross-fade is
   * inherently stateful: `FrameState` says which phase the session is in, not
   * how far through the transition INTO that phase we are. Approaching the
   * target by `deltaMs / fadeMs` per frame gives §5.6's ≥400ms cross-fade for
   * free and makes it frame-rate independent — a 30fps machine takes the same
   * 400ms, in half as many steps.
   */
  const gateAlpha: Record<LaneId, number> = { left: 0, center: 0, right: 0 };

  /** Last values pushed to the field and bed, so a no-op push is skipped. */
  let lastFieldOpacity = -1;
  let lastPulseHz = -1;
  let lastBedGain = Number.NaN;

  // ---- The one loop --------------------------------------------------------

  const clock: SessionClock = createClock(onFrame, {
    now: options.now,
    scheduler: options.scheduler,
    visibility: options.visibility,
    maxFrameMs: options.maxFrameMs,
  } satisfies ClockOptions);

  function onFrame(tick: { elapsedMs: number; deltaMs: number }): void {
    if (disposed) return;

    if (stage === 'exiting' || stage === 'done') {
      runExit(tick.elapsedMs);
      return;
    }

    const threshold: ThresholdState = thresholdAt(tick.elapsedMs, { reducedMotion });

    // The session clock and the CONTENT clock are the same clock offset by the
    // threshold: the plan's step 0 begins when the first line is allowed to
    // appear, not when Begin was pressed. Without the offset the opening
    // sequence would eat the first five seconds of the induction.
    const contentMs = Math.max(0, tick.elapsedMs - thresholdTotal(reducedMotion));
    const raw = frameAt(plan, contentMs);
    const frame: FrameState = { ...raw, masterAlpha: masterAlphaFor(raw, contentMs) };

    applyVeil(1 - threshold.darken);
    applyField(threshold.field * frame.masterAlpha, frame);
    applyBed(threshold.bed, frame);

    stepGates(frame, tick.deltaMs, threshold.text);
    lanes.paint(frame, gateAlpha);

    hooks.onProgress(frame.progress);

    if (stage === 'threshold' && threshold.complete) stage = 'playing';

    // C5: the plan's own tail (quiet, then fade) has already run inside
    // `frameAt` by the time `ended` flips, so the exit begins against a screen
    // whose text is already gone. The two tails compose rather than overlap.
    if (frame.ended && stage === 'playing') beginExit(tick.elapsedMs, false);
  }

  function stepGates(frame: FrameState, deltaMs: number, textGate: number): void {
    const step = fadeMs > 0 ? Math.max(0, deltaMs) / fadeMs : 1;
    for (const lane of LANE_IDS) {
      const spec = CHANNEL_GEOMETRY[lane];
      // The center is the anchor: its gate follows the threshold's text gate
      // and nothing else, so it is held the whole way (§5.3). The sides follow
      // the phase table AND the threshold, so they can never precede the anchor.
      const target = spec.anchor ? textGate : Math.min(textGate, SIDE_GATE_BY_PHASE[frame.phase]);
      gateAlpha[lane] = approach(gateAlpha[lane], target, step);
    }
  }

  function beginExit(atMs: number, aborted: boolean): void {
    if (stage === 'exiting' || stage === 'done') return;
    stage = 'exiting';
    exitStartMs = atMs;
    exitAborted = aborted;
    if (closingEl.style.display !== 'block') closingEl.style.display = 'block';
  }

  function runExit(elapsedMs: number): void {
    const t = elapsedMs - exitStartMs;
    const state: ExitState = exitAt(t, { reducedMotion, abort: exitAborted });

    // Text is already gone; the lanes are told so explicitly rather than left
    // holding their last frame, because an aborted exit interrupts mid-mantra.
    for (const lane of LANE_IDS) gateAlpha[lane] = 0;
    for (const lane of LANE_IDS) {
      lanes.views[lane].apply(
        { ...blankChannel(lane), split: CHANNEL_GEOMETRY[lane].split },
        0,
        0,
      );
    }

    applyFieldOpacity(state.field);
    if (options.bed) {
      // The bed rides the same fade as the field: §6.6 fades them together,
      // and a bed that outlived the field by even half a second would leave a
      // tone playing over a black screen.
      options.bed.setGain(gainForFade(plan.bed.gainDb, state.field));
      if (state.field <= 0 && bedStarted) {
        options.bed.stop();
        bedStarted = false;
      }
    }

    const lineOpacity = state.line * EXIT_LINE_OPACITY;
    const quantized = Math.round(lineOpacity * 1000) / 1000;
    if (String(quantized) !== closingEl.style.opacity) {
      closingEl.style.opacity = String(quantized);
    }

    if (state.complete && stage !== 'done') {
      stage = 'done';
      clock.pause();
      finish();
    }
  }

  function finish(): void {
    if (ended) return;
    ended = true;
    hooks.onEnd();
  }

  function applyVeil(opacity: number): void {
    const quantized = String(Math.round(clamp01(opacity) * 1000) / 1000);
    if (veil.style.opacity !== quantized) veil.style.opacity = quantized;
  }

  function applyField(opacity: number, frame: FrameState): void {
    applyFieldOpacity(opacity);
    if (!options.field) return;
    options.field.setProgress(frame.progress);
    // §5.5: the backdrop's transition rate is DERIVED from the bed's pulse
    // rate, so visuals and entrainment share one clock. The engine's frame
    // carries that number; this just forwards it.
    if (frame.bed.pulseHz !== lastPulseHz) {
      options.field.setPulseHz(frame.bed.pulseHz);
      lastPulseHz = frame.bed.pulseHz;
    }
  }

  function applyFieldOpacity(opacity: number): void {
    const v = clamp01(opacity);
    if (v === lastFieldOpacity) return;
    lastFieldOpacity = v;
    options.field?.setOpacity(v);
  }

  function applyBed(envelope: number, frame: FrameState): void {
    if (!options.bed) return;
    // The bed starts on the Begin GESTURE, upstream of here — §6.7 makes the
    // autoplay failure structurally impossible by never starting audio from a
    // timer. What this does is start it on the first frame after that gesture,
    // which is inside the same user-activation window.
    if (!bedStarted && frame.bed.active) {
      options.bed.start();
      bedStarted = true;
    }
    const db = gainForFade(frame.bed.gainDb, envelope);
    if (db !== lastBedGain) {
      options.bed.setGain(db);
      lastBedGain = db;
    }
  }

  function blankChannel(lane: LaneId): FrameState['channels'][LaneId] {
    const spec = CHANNEL_GEOMETRY[lane];
    return {
      lane,
      text: '',
      template: '',
      mantraId: '',
      active: false,
      alpha: 0,
      scale: spec.scale,
      blur: spec.blur,
      split: spec.split,
      holdMs: 0,
    };
  }

  // ---- Escape (C9) ---------------------------------------------------------

  const keyTarget =
    options.keyTarget ?? ((globalThis as unknown as { document?: KeyTarget }).document ?? null);
  const escapeEnabled = options.escapeToStop !== false && keyTarget !== null;

  function onKeyDown(event: { key: string }): void {
    if (event.key === 'Escape') handle.stop();
  }

  if (escapeEnabled) keyTarget!.addEventListener('keydown', onKeyDown);

  // ---- The handle ----------------------------------------------------------

  const handle: SessionHandle = {
    pause(): void {
      clock.pause();
    },
    resume(): void {
      if (stage === 'done' || disposed) return;
      clock.resume();
    },
    stop(): void {
      if (disposed || stage === 'done') return;
      if (stage === 'exiting') return;
      // The abort exit needs the clock to keep running to play its fade — C9
      // asks for a fade, not a cut, and a fade needs frames. `beginExit` marks
      // the stage; the next frame starts painting the ending.
      beginExit(clock.elapsedMs, true);
      if (!clock.running) clock.resume();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clock.dispose();
      if (escapeEnabled) keyTarget!.removeEventListener('keydown', onKeyDown);
      lanes.dispose();
      stageEl.remove();
      if (bedStarted) {
        options.bed?.stop();
        bedStarted = false;
      }
      // A disposed session that never reached its ending still ended, from the
      // shell's point of view. Firing here rather than leaving `onEnd` unfired
      // is what keeps the play route from waiting forever on a session the user
      // navigated away from.
      finish();
    },
    get elapsedMs(): number {
      return clock.elapsedMs;
    },
    get running(): boolean {
      return clock.running;
    },
  };

  clock.start();
  return handle;
}

/**
 * The threshold's total length for the active motion setting.
 *
 * Read off `thresholdSchedule` rather than restated, so the content offset and
 * the opening sequence cannot fall out of agreement — the failure that would
 * put the first center line before the field has arrived.
 */
function thresholdTotal(reducedMotion: boolean): number {
  return thresholdSchedule({ reducedMotion }).totalMs;
}

/**
 * Which master fade applies, once the content clock is offset by the threshold.
 *
 * `frameAt` computes `masterAlpha` as the MINIMUM of its own 6-second fade-in
 * and the plan's closing fade — it has to, because a headless caller reading
 * frames straight off the engine has no threshold in front of it and would
 * otherwise open on a full field of text.
 *
 * M4 does have a threshold in front of it, and that threshold IS §6.5's opening.
 * Applying both would fade the session in twice: the first ten seconds of the
 * induction would play at a fraction of its opacity, arriving at full only well
 * into the content. So the opening is taken from `threshold.ts` and the
 * engine's fade-IN is dropped here — while its fade-OUT is kept exactly,
 * because that one implements §4.11's plan-level tail and composes with the
 * §6.6 exit rather than duplicating it.
 *
 * The two are distinguished by position rather than by re-deriving the engine's
 * arithmetic: before the closing fade begins, the only thing `masterAlpha` can
 * be doing is fading in.
 */
function masterAlphaFor(frame: FrameState, contentMs: number): number {
  return contentMs < FADE_IN_HORIZON_MS ? 1 : frame.masterAlpha;
}

/**
 * How long the engine's own fade-in runs, from `frameAt`'s `THRESHOLD_MS`.
 *
 * Held as a named constant with this comment rather than as a bare 6000 so that
 * a future change to the engine's threshold has one obvious place to land. It
 * is only ever compared against, never used to compute an alpha.
 */
const FADE_IN_HORIZON_MS = 6000;

/**
 * Fade a dB gain by a linear envelope in [0,1].
 *
 * dB is logarithmic, so multiplying it is wrong: a 0.5 envelope on -18dB is not
 * -9dB. Converting to linear, scaling, and converting back is what makes a
 * half-open envelope sound half-open. The floor at -60dB is inaudible and
 * stops the conversion running to -Infinity at zero.
 */
export function gainForFade(gainDb: number, envelope: number): number {
  const e = clamp01(envelope);
  if (e <= 0) return -60;
  const linear = Math.pow(10, gainDb / 20) * e;
  const db = 20 * Math.log10(linear);
  return Math.max(-60, Math.round(db * 100) / 100);
}

/** Move `current` toward `target` by at most `step`. Frame-rate independent. */
export function approach(current: number, target: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return current;
  if (current === target) return target;
  const delta = target - current;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function prefersReducedMotion(): boolean {
  try {
    const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
    return mm ? mm('(prefers-reduced-motion: reduce)').matches : false;
  } catch {
    return false;
  }
}

export { exitSchedule };
