/**
 * The three lanes, painted — DESIGN.md §5.3, §5.6, acceptance C1, C2, C4, C9.
 *
 * This is the only visual code in the app that matters, and it is deliberately
 * the least clever. Three `<div>`s are created once at mount and then MUTATED
 * IN PLACE for the rest of the session. Nothing is created, destroyed,
 * reconciled, keyed or diffed per frame.
 *
 * **React never sits between the session clock and the pixels (§5.4).** Not as
 * a performance micro-optimization — as a correctness property. A reconciler
 * between the clock and the paint means every frame's alpha goes through a
 * scheduler that may batch it, defer it across a frame boundary, or run it
 * twice under StrictMode, and the frame-level jitter that introduces is exactly
 * what §9 forbids. React owns the setup screen and the shell; from `Begin` to
 * `again · done` the lanes are raw DOM writes issued from the rAF callback.
 *
 * FLAT HEAP (C4). A 20-minute session is ~350 steps and ~72,000 frames. Every
 * per-frame allocation in this file is one the GC has to collect 72,000 times,
 * so there are none: no object literals in the hot path, no template strings
 * rebuilt when nothing changed, no arrays. The per-lane `LaneView` holds the
 * last value written for every property and skips the DOM write when the new
 * value is equal. That last part is not premature — a style write is a layout
 * invalidation, and three lanes × six properties × 60fps of redundant
 * invalidations is the difference between 60fps and a session that stutters at
 * the peak.
 *
 * WHAT THIS FILE DOES NOT DECIDE. Not which mantra (the planner settled it),
 * not what a lane looks like (M3's `renderChannel` and `CHANNEL_GEOMETRY` say),
 * not when frames happen (the clock says). It turns a `ChannelFrame` into
 * pixels and holds the cross-fade state that a stateless frame value cannot.
 */

import type { ChannelFrame, FrameState, LaneId } from '../../engine/types/frame.ts';
import { CHANNEL_GEOMETRY, PAINT_ORDER } from '../../engine/render/geometry.ts';
import { MIN_CROSSFADE_MS } from '../../engine/render/envelope.ts';

/**
 * §5.6: every appearance and disappearance is a cross-fade of at least 400ms.
 *
 * The envelope already shapes a token's alpha inside its own span, but a LANE
 * appearing and disappearing is a coarser event — the sides arrive at
 * head→middle and leave at middle→tail — and that transition has its own fade,
 * held here because it is a property of the mounted view rather than of any one
 * frame. Re-exported from M3's constant so there is one 400 in the codebase.
 */
export const LANE_FADE_MS = MIN_CROSSFADE_MS;

/**
 * The reduced-motion cross-fade (§5.6, C9).
 *
 * 200ms, per the requirement. Note the direction: reduced motion makes fades
 * SHORTER, not longer, because the request is for less movement on screen and a
 * long cross-fade is movement. It is still a fade — C9 says the session stops
 * moving, not that it starts cutting, and nothing anywhere in this app cuts.
 */
export const REDUCED_FADE_MS = 200;

/** Text scale in viewport units, before the lane's own `scale` multiplier. */
const BASE_FONT_VW = 3.2;

/** Blur is reported in renderer-defined units (§5.3); here, CSS pixels. */
const BLUR_PX_PER_UNIT = 1;

/**
 * How far a side lane translates as it settles, in CSS pixels.
 *
 * The one piece of parallax in the text layer, and the first thing reduced
 * motion turns off (C9: "no parallax").
 */
const PARALLAX_PX = 12;

export interface LaneViewOptions {
  /** Static field, 200ms cross-fades, no parallax (§5.6). */
  reducedMotion?: boolean;
  /** Override the lane-level cross-fade. Defaults by `reducedMotion`. */
  fadeMs?: number;
}

/**
 * One mounted lane.
 *
 * Holds the element plus a shadow copy of every property last written to it.
 * The shadow copy is the allocation-free frame skip: `apply` compares, writes
 * only what changed, and returns without touching the DOM when a frame is
 * identical to the one before it — which, at 60fps against ~3400ms dwells, is
 * the overwhelming majority of frames.
 */
export class LaneView {
  readonly lane: LaneId;
  readonly element: HTMLElement;

  private lastText = '';
  private lastOpacity = -1;
  private lastTransform = '';
  private lastFilter = '';
  private lastDisplay = '';
  private lastFade = -1;

  /** The lane-level gate, separate from the frame's `.active` (§5.3). */
  private gateOpen = true;

  private readonly reducedMotion: boolean;
  private readonly fadeMs: number;

  constructor(lane: LaneId, element: HTMLElement, options: LaneViewOptions = {}) {
    this.lane = lane;
    this.element = element;
    this.reducedMotion = options.reducedMotion === true;
    this.fadeMs = options.fadeMs ?? (this.reducedMotion ? REDUCED_FADE_MS : LANE_FADE_MS);
  }

  /**
   * Open or close the lane-level gate.
   *
   * The sides fade in at the head→middle transition and out at middle→tail;
   * the center is the thread held the whole way (§5.3). That is a lane fact,
   * not a token fact, so it lives here rather than being smuggled into an
   * envelope: a closed gate multiplies the lane's alpha to zero over
   * `fadeMs` while the frames underneath carry on unchanged, which is what
   * makes the transition a fade rather than a cut mid-mantra.
   */
  setGate(open: boolean): void {
    this.gateOpen = open;
  }

  get open(): boolean {
    return this.gateOpen;
  }

  /**
   * Paint one frame. Called from the rAF callback, up to 60 times a second.
   *
   * `masterAlpha` is the threshold/exit fade (§6.5, §6.6) and `gateAlpha` the
   * lane-level cross-fade the session holds for this lane. Both multiply into
   * the frame's already-composited alpha; none of them is allowed to raise it,
   * so a side lane never exceeds its 0.30 stratification ceiling.
   */
  apply(frame: ChannelFrame, masterAlpha: number, gateAlpha: number): void {
    // §5.2's `.active` gate: an inactive lane paints NOTHING. It is not kept in
    // the DOM at zero opacity waiting to flash, and — the reason that matters
    // beyond flashing — transparent text is still text to a screen reader.
    const visible = frame.active && gateAlpha > 0 && masterAlpha > 0;

    if (!visible) {
      if (this.lastDisplay !== 'none') {
        this.element.style.display = 'none';
        this.lastDisplay = 'none';
      }
      // Text is cleared with the lane so an inactive lane holds no content for
      // assistive technology, and so the next activation cross-fades in fresh
      // rather than revealing a stale token at full alpha.
      if (this.lastText !== '') {
        this.element.textContent = '';
        this.lastText = '';
      }
      this.lastOpacity = 0;
      return;
    }

    if (this.lastDisplay !== 'block') {
      this.element.style.display = 'block';
      this.lastDisplay = 'block';
    }

    if (frame.text !== this.lastText) {
      this.element.textContent = frame.text;
      this.lastText = frame.text;
    }

    const opacity = clamp01(frame.alpha) * clamp01(masterAlpha) * clamp01(gateAlpha);
    // Quantized before comparison: an opacity difference under 1/1000 is below
    // display precision, and writing it anyway costs a style invalidation for a
    // change nobody can see.
    const quantized = Math.round(opacity * 1000) / 1000;
    if (quantized !== this.lastOpacity) {
      this.element.style.opacity = String(quantized);
      this.lastOpacity = quantized;
    }

    const transform = this.transformFor(frame, gateAlpha);
    if (transform !== this.lastTransform) {
      this.element.style.transform = transform;
      this.lastTransform = transform;
    }

    const filter = frame.blur > 0 ? `blur(${frame.blur * BLUR_PX_PER_UNIT}px)` : 'none';
    if (filter !== this.lastFilter) {
      this.element.style.filter = filter;
      this.lastFilter = filter;
    }

    if (this.fadeMs !== this.lastFade) {
      this.element.style.transition = `opacity ${this.fadeMs}ms linear`;
      this.lastFade = this.fadeMs;
    }
  }

  /**
   * The lane's transform string.
   *
   * `translate(-50%, -50%)` centers the element on its anchor point; the scale
   * is §5.3's. Under reduced motion that is the whole transform. Otherwise the
   * side lanes drift `PARALLAX_PX` outward as their gate opens, which is the
   * only motion in the text layer and the one C9 names.
   */
  private transformFor(frame: ChannelFrame, gateAlpha: number): string {
    const scale = frame.scale;
    if (this.reducedMotion) {
      return `translate(-50%, -50%) scale(${scale})`;
    }
    const spec = CHANNEL_GEOMETRY[this.lane];
    if (spec.anchor) {
      return `translate(-50%, -50%) scale(${scale})`;
    }
    // Sides settle outward as they arrive: -1 for the left lane, +1 for the
    // right, scaled by how far the gate has opened. Rounded to whole pixels so
    // the string is stable across frames and the write is skipped.
    const direction = spec.position < 0.5 ? -1 : 1;
    const offset = Math.round(direction * PARALLAX_PX * (1 - clamp01(gateAlpha)));
    // `calc()` needs whitespace around a binary operator, so the sign is
    // emitted as the operator rather than glued to the number: `+ -9px` is not
    // valid CSS and would silently drop the whole transform.
    const sign = offset < 0 ? '-' : '+';
    return `translate(calc(-50% ${sign} ${Math.abs(offset)}px), -50%) scale(${scale})`;
  }

  /** Font size for this lane, in viewport width units. */
  static fontVw(scale: number): number {
    return BASE_FONT_VW * scale;
  }
}

/** The mounted lane layer: three views plus the element that hosts them. */
export interface LaneLayer {
  readonly root: HTMLElement;
  readonly views: Record<LaneId, LaneView>;
  /**
   * Paint a whole frame.
   *
   * `gateAlpha` is per-lane so the head→middle and middle→tail transitions can
   * be mid-fade on the sides while the center stays at 1.
   */
  paint(frame: FrameState, gateAlpha: Record<LaneId, number>): void;
  dispose(): void;
}

/** Anything that can make an element. The real `document`, or a test's stand-in. */
export interface ElementFactory {
  createElement(tag: string): HTMLElement;
}

export interface LaneLayerOptions extends LaneViewOptions {
  /** Defaults to the real `document`. Injectable so this is testable in Node. */
  documentRef?: ElementFactory;
}

/**
 * Build the lane layer inside `root`.
 *
 * Elements are appended in `PAINT_ORDER` — sides first, center LAST. That is
 * the compositing half of the stratification claim (§5.2): with the center
 * painted first, two 0.30 layers accumulate over it and the dominance the alpha
 * ratio buys is spent again in the blend. C1 asks that the center be
 * unambiguously dominant, and paint order is half of what delivers it.
 */
export function mountLanes(root: HTMLElement, options: LaneLayerOptions = {}): LaneLayer {
  const doc = options.documentRef ?? (globalThis as unknown as { document: ElementFactory }).document;

  const layer = doc.createElement('div');
  layer.className = 'hypnoapp-lanes';
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.overflow = 'hidden';
  // The text layer is decorative-by-frame and read as a whole; announcing every
  // token as it seeps would make a screen reader unusable. The session's
  // meaning is announced once, by the shell, not 350 times by the renderer.
  layer.setAttribute('aria-hidden', 'true');

  const views = {} as Record<LaneId, LaneView>;

  for (const lane of PAINT_ORDER) {
    const spec = CHANNEL_GEOMETRY[lane];
    const el = doc.createElement('div');
    el.className = `hypnoapp-lane hypnoapp-lane-${lane}`;
    el.style.position = 'absolute';
    el.style.left = `${spec.position * 100}%`;
    el.style.top = '50%';
    el.style.display = 'none';
    el.style.opacity = '0';
    el.style.maxWidth = spec.anchor ? '68vw' : '28vw';
    el.style.textAlign = 'center';
    el.style.fontSize = `${LaneView.fontVw(spec.scale)}vw`;
    el.style.lineHeight = '1.35';
    el.style.willChange = 'opacity, transform';
    el.style.pointerEvents = 'none';
    // Rendered text must not be selectable: a drag across the field during a
    // session selects a mantra and pops a native selection highlight.
    el.style.userSelect = 'none';

    layer.appendChild(el);
    views[lane] = new LaneView(lane, el, options);
  }

  root.appendChild(layer);

  return {
    root: layer,
    views,
    paint(frame: FrameState, gateAlpha: Record<LaneId, number>): void {
      for (const lane of PAINT_ORDER) {
        views[lane].apply(frame.channels[lane], frame.masterAlpha, gateAlpha[lane] ?? 1);
      }
    },
    dispose(): void {
      layer.remove();
    },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
