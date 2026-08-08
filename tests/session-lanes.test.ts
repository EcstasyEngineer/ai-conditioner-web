/**
 * M4 — the three lanes, acceptance C1, C2, C4, C9.
 *
 * Driven against `fixtures/frame.reference.json`, which is the point of that
 * fixture: it is a HAND-AUTHORED `FrameState` at three sample times, so the
 * renderer can be built and asserted before M2 computes a single step. The
 * mid-peak frame is the one that has to prove C1 — center scale 1.0 alpha 1.0
 * against sides at 0.55 / 0.30 — and the head and tail frames are what prove
 * the sides arrive late and leave early.
 *
 * The fake DOM is not a shortcut around a real one. `lanes.ts` writes styles
 * and text and does nothing else, so recording those writes is a more precise
 * instrument than a real DOM would be: "was this style write skipped" is a
 * question a real DOM cannot answer at all, and it is the C4 flat-heap claim.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { ChannelFrame, FrameState, LaneId } from '../engine/types/frame.ts';
import { LANE_IDS } from '../engine/types/frame.ts';
import { CHANNEL_GEOMETRY, PAINT_ORDER } from '../engine/render/geometry.ts';
import { LANE_FADE_MS, REDUCED_FADE_MS, LaneView, mountLanes } from '../web/session/lanes.ts';

import { FakeElement, fakeDocument } from './session-dom.ts';

interface ReferenceFrame extends FrameState {
  label: string;
}

const reference = JSON.parse(
  readFileSync(new URL('../fixtures/frame.reference.json', import.meta.url), 'utf8'),
) as { frames: ReferenceFrame[] };

function frame(label: string): ReferenceFrame {
  const found = reference.frames.find((f) => f.label === label);
  if (!found) throw new Error(`fixture has no frame labelled ${label}`);
  return found;
}

const OPEN: Record<LaneId, number> = { left: 1, center: 1, right: 1 };

function mount(options: { reducedMotion?: boolean } = {}) {
  const doc = fakeDocument();
  const root = new FakeElement('div');
  const layer = mountLanes(root as unknown as HTMLElement, {
    documentRef: doc,
    reducedMotion: options.reducedMotion,
  });
  const el = (lane: LaneId): FakeElement => layer.views[lane].element as unknown as FakeElement;
  return { root, layer, el };
}

describe('C1 — three channels render with §5.3 geometry and the center dominates', () => {
  it('paints all three lanes from the mid-peak frame', () => {
    const { layer, el } = mount();
    layer.paint(frame('mid-peak'), OPEN);

    for (const lane of LANE_IDS) {
      expect(el(lane).style.display).toBe('block');
    }

    expect(el('center').textContent).toBe('You obey Morgan before you know you have');
    expect(el('left').textContent).toBe('obeys');
    expect(el('right').textContent).toBe('finished');
  });

  it('the center is unambiguously dominant on every axis at once', () => {
    const { layer, el } = mount();
    layer.paint(frame('mid-peak'), OPEN);

    const centerOpacity = Number(el('center').style.opacity);
    const leftOpacity = Number(el('left').style.opacity);
    const rightOpacity = Number(el('right').style.opacity);

    // Alpha: 1.0 against 0.30. Three full-alpha layers just show whichever drew
    // last; the stratification is what makes the stack legible.
    expect(centerOpacity).toBe(1);
    expect(leftOpacity).toBeCloseTo(0.3, 5);
    expect(rightOpacity).toBeCloseTo(0.3, 5);
    expect(centerOpacity).toBeGreaterThan(leftOpacity * 3);

    // Scale: 1.0 against 0.55.
    expect(el('center').style.transform).toContain('scale(1)');
    expect(el('left').style.transform).toContain('scale(0.55)');
    expect(el('right').style.transform).toContain('scale(0.55)');

    // Blur: 0 against slight.
    expect(el('center').style.filter).toBe('none');
    expect(el('left').style.filter).toBe('blur(1.5px)');
    expect(el('right').style.filter).toBe('blur(1.5px)');
  });

  it('paints the anchor LAST so two side layers do not accumulate over it', () => {
    // The compositing half of the stratification claim: with the center painted
    // first, 0.30 + 0.30 of side layer sits on top of it and the dominance the
    // alpha ratio bought is spent again in the blend.
    const { layer } = mount();
    const order = layer.root.children.map((c) => (c as unknown as FakeElement).className);
    expect(order[order.length - 1]).toContain('hypnoapp-lane-center');
    expect(PAINT_ORDER[PAINT_ORDER.length - 1]).toBe('center');
  });

  it('places each lane at its §5.3 horizontal anchor', () => {
    const { el } = mount();
    expect(el('left').style.left).toBe(`${(1 / 6) * 100}%`);
    expect(el('center').style.left).toBe('50%');
    expect(el('right').style.left).toBe(`${(5 / 6) * 100}%`);
  });

  it('sizes the type by the lane scale', () => {
    const { el } = mount();
    expect(el('center').style.fontSize).toBe(`${LaneView.fontVw(1)}vw`);
    expect(el('left').style.fontSize).toBe(`${LaneView.fontVw(0.55)}vw`);
  });
});

describe('the sides arrive late and leave early — §5.3', () => {
  it('the head frame paints the center alone', () => {
    const { layer, el } = mount();
    layer.paint(frame('mid-head'), OPEN);

    expect(el('center').style.display).toBe('block');
    expect(el('center').textContent).toBe('Your out-breath runs longer than your in-breath');
    // An inactive lane paints NOTHING — it is not held in the DOM at zero
    // opacity waiting to flash, and transparent text is still text to a screen
    // reader (§5.2).
    expect(el('left').style.display).toBe('none');
    expect(el('right').style.display).toBe('none');
    expect(el('left').textContent).toBe('');
  });

  it('the tail frame paints the center alone again', () => {
    const { layer, el } = mount();
    layer.paint(frame('mid-tail'), OPEN);

    expect(el('center').textContent).toBe('You stand up rested and present');
    expect(el('left').style.display).toBe('none');
    expect(el('right').style.display).toBe('none');
  });

  it('the center is the thread held through all three sample frames', () => {
    const { layer, el } = mount();
    for (const label of ['mid-head', 'mid-peak', 'mid-tail']) {
      layer.paint(frame(label), OPEN);
      expect(el('center').style.display).toBe('block');
      expect(el('center').textContent.length).toBeGreaterThan(0);
    }
  });
});

describe('the master fade and the lane gate multiply in, never out', () => {
  it('masterAlpha scales every lane', () => {
    const { layer, el } = mount();
    const head = { ...frame('mid-head'), masterAlpha: 0.5 };
    layer.paint(head, OPEN);
    expect(Number(el('center').style.opacity)).toBeCloseTo(0.5, 3);
  });

  it('a closed gate blanks its lane without touching the others', () => {
    const { layer, el } = mount();
    layer.paint(frame('mid-peak'), { left: 0, center: 1, right: 1 });
    expect(el('left').style.display).toBe('none');
    expect(el('center').style.display).toBe('block');
    expect(el('right').style.display).toBe('block');
  });

  it('a side lane never exceeds its 0.30 ceiling however the gates are set', () => {
    const { layer, el } = mount();
    // Gate and master both at their maximum: the ceiling is a MULTIPLIER, so
    // nothing here can raise a side above the stratification §5.2 requires.
    layer.paint({ ...frame('mid-peak'), masterAlpha: 1 }, { left: 1, center: 1, right: 1 });
    expect(Number(el('left').style.opacity)).toBeLessThanOrEqual(0.3);
    expect(Number(el('right').style.opacity)).toBeLessThanOrEqual(0.3);
  });
});

describe('C4 — flat heap: the paint loop skips redundant writes', () => {
  it('repainting an identical frame writes nothing to the DOM', () => {
    const { layer, el } = mount();
    const f = frame('mid-peak');

    layer.paint(f, OPEN);
    const center = el('center');
    const opacityWrites = center.style.writeCount('opacity');
    const textWrites = center.textWrites.length;

    // 600 frames is ten seconds of a held mantra at 60fps. Every one of them
    // would be a layout invalidation on a renderer that wrote unconditionally.
    for (let i = 0; i < 600; i += 1) layer.paint(f, OPEN);

    expect(center.style.writeCount('opacity')).toBe(opacityWrites);
    expect(center.textWrites.length).toBe(textWrites);
  });

  it('writes again as soon as something actually changes', () => {
    const { layer, el } = mount();
    const f = frame('mid-peak');
    layer.paint(f, OPEN);
    const before = el('center').style.writeCount('opacity');

    layer.paint({ ...f, masterAlpha: 0.5 }, OPEN);
    expect(el('center').style.writeCount('opacity')).toBe(before + 1);
  });

  it('quantizes opacity so sub-perceptual changes are not written', () => {
    const { layer, el } = mount();
    const f = frame('mid-peak');
    layer.paint(f, OPEN);
    const before = el('center').style.writeCount('opacity');

    // A change of 1/10000 is below display precision and below the 1/1000
    // quantization step. Writing it costs an invalidation for nothing.
    layer.paint({ ...f, masterAlpha: 0.9999 }, OPEN);
    expect(el('center').style.writeCount('opacity')).toBe(before);
  });

  it('creates its elements once and never again', () => {
    const doc = fakeDocument();
    const root = new FakeElement('div');
    const layer = mountLanes(root as unknown as HTMLElement, { documentRef: doc });
    const afterMount = doc.created.length;

    for (let i = 0; i < 500; i += 1) layer.paint(frame('mid-peak'), OPEN);

    // Four elements: the layer plus three lanes. A renderer that allocated per
    // frame would show 500 more here, and a 20-minute session would show 72,000.
    expect(afterMount).toBe(4);
    expect(doc.created.length).toBe(afterMount);
  });
});

describe('C9 — reduced motion', () => {
  it('collapses the cross-fade to 200ms and keeps it a fade', () => {
    const { layer, el } = mount({ reducedMotion: true });
    layer.paint(frame('mid-peak'), OPEN);
    // Still a transition, just a shorter one. Nothing in this app cuts.
    expect(el('center').style.transition).toBe(`opacity ${REDUCED_FADE_MS}ms linear`);
    expect(REDUCED_FADE_MS).toBe(200);
  });

  it('uses the 400ms floor when motion is not reduced', () => {
    const { layer, el } = mount();
    layer.paint(frame('mid-peak'), OPEN);
    expect(el('center').style.transition).toBe(`opacity ${LANE_FADE_MS}ms linear`);
    expect(LANE_FADE_MS).toBeGreaterThanOrEqual(400);
  });

  it('drops the parallax entirely', () => {
    const reduced = mount({ reducedMotion: true });
    reduced.layer.paint(frame('mid-peak'), { left: 0.5, center: 1, right: 0.5 });
    // No `calc()` offset: the transform is position and scale and nothing else.
    expect(reduced.el('left').style.transform).toBe('translate(-50%, -50%) scale(0.55)');

    const moving = mount();
    moving.layer.paint(frame('mid-peak'), { left: 0.5, center: 1, right: 0.5 });
    expect(moving.el('left').style.transform).toContain('calc(');
  });

  it('the side parallax settles to zero once the gate is fully open', () => {
    const { layer, el } = mount();
    layer.paint(frame('mid-peak'), OPEN);
    expect(el('left').style.transform).toBe('translate(calc(-50% + 0px), -50%) scale(0.55)');
  });

  it('the sides parallax in opposite directions while their gate opens', () => {
    const { layer, el } = mount();
    // A gate of 0 does not paint at all — an inactive lane paints NOTHING —
    // so the offset is read mid-fade, which is the only state in which it is
    // ever visible.
    layer.paint(frame('mid-peak'), { left: 0.25, center: 1, right: 0.25 });
    // Left drifts left, right drifts right: they settle outward-to-inward, so
    // the pair reads as one gesture rather than as two elements sliding the
    // same way.
    expect(el('left').style.transform).toContain('- 9px');
    expect(el('right').style.transform).toContain('+ 9px');
  });

  it('never emits a calc() with a doubled sign', () => {
    // `calc(-50% + -9px)` is not valid CSS: the browser drops the ENTIRE
    // transform, which takes the lane's scale with it and silently renders a
    // side lane at full size. Caught here rather than in a sitting.
    const { layer, el } = mount();
    for (const gate of [0.05, 0.25, 0.5, 0.75, 0.99, 1]) {
      layer.paint(frame('mid-peak'), { left: gate, center: 1, right: gate });
      for (const lane of ['left', 'right'] as const) {
        expect(el(lane).style.transform).not.toMatch(/[+-]\s*-/);
      }
    }
  });
});

describe('the lane layer is a good DOM citizen', () => {
  it('hides itself from assistive technology', () => {
    const { layer } = mount();
    // The session's meaning is announced once by the shell, not 350 times by
    // the renderer as each token seeps in.
    expect((layer.root as unknown as FakeElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('makes the text unselectable and non-interactive', () => {
    const { el } = mount();
    expect(el('center').style.userSelect).toBe('none');
    expect(el('center').style.pointerEvents).toBe('none');
  });

  it('removes itself on dispose', () => {
    const { root, layer } = mount();
    expect(root.children.length).toBe(1);
    layer.dispose();
    expect(root.children.length).toBe(0);
  });
});

describe('LaneView handles degenerate frames without painting garbage', () => {
  function channel(lane: LaneId, over: Partial<ChannelFrame> = {}): ChannelFrame {
    const spec = CHANNEL_GEOMETRY[lane];
    return {
      lane,
      text: 'x',
      template: 'x',
      mantraId: 'x',
      active: true,
      alpha: spec.alpha,
      scale: spec.scale,
      blur: spec.blur,
      split: spec.split,
      holdMs: 0,
      ...over,
    };
  }

  it('treats a NaN alpha as absent rather than as opaque', () => {
    const { layer, el } = mount();
    layer.views.center.apply(channel('center', { alpha: Number.NaN }), 1, 1);
    expect(Number(el('center').style.opacity)).toBe(0);
  });

  it('clamps an out-of-range alpha to the ceiling', () => {
    const { layer, el } = mount();
    layer.views.center.apply(channel('center', { alpha: 4 }), 1, 1);
    expect(Number(el('center').style.opacity)).toBe(1);
  });

  it('clears text when a lane goes inactive mid-mantra', () => {
    const { layer, el } = mount();
    layer.views.center.apply(channel('center', { text: 'held' }), 1, 1);
    expect(el('center').textContent).toBe('held');
    layer.views.center.apply(channel('center', { active: false }), 1, 1);
    expect(el('center').textContent).toBe('');
  });
});
