/**
 * M4 — `mountSession`, the whole lifecycle.
 *
 * This is the integration test: one clock, three lanes, an opening and an
 * ending, driven frame by frame against `fixtures/plan.reference.json`. Because
 * both the clock and the scheduler are injected, a full session runs in
 * milliseconds and every assertion is on an exact frame rather than on a
 * tolerance around a wall-clock wait.
 *
 * The acceptance criteria that only exist at this level:
 *
 *   C2  the right channel leads the center by ~1s
 *   C3  channels drift against each other over a session (observation, not a gate)
 *   C4  no per-frame allocation across a whole session
 *   C8  60s in the background produces no burst of lines
 *   C9  Escape stops within 1.5s, with a fade
 *
 * plus §5.3's sides-arrive-late-and-leave-early, which is the one rule that
 * spans the phase table, the gate state and the paint loop.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { LaneId } from '../engine/types/frame.ts';
import type { SessionPlan } from '../engine/types/plan.ts';
import { THRESHOLD_TOTAL_MS } from '../web/session/threshold.ts';
import { ABORT_FADE_MS, EXIT_LINE } from '../web/session/exit.ts';
import { approach, gainForFade, mountSession } from '../web/session/mountSession.ts';

import { FakeElement, FakeFrameDriver, FakeKeyTarget, FakeVisibility, fakeDocument } from './session-dom.ts';

const plan = JSON.parse(
  readFileSync(new URL('../fixtures/plan.reference.json', import.meta.url), 'utf8'),
) as SessionPlan;

interface Harness {
  driver: FakeFrameDriver;
  visibility: FakeVisibility;
  keys: FakeKeyTarget;
  root: FakeElement;
  handle: ReturnType<typeof mountSession>;
  created: FakeElement[];
  ends: number;
  progress: number[];
  field: { progress: number[]; opacity: number[]; pulse: number[] };
  bed: { starts: number; stops: number; gains: number[] };
  lane(lane: LaneId): FakeElement;
  closing(): FakeElement;
}

function harness(options: { reducedMotion?: boolean; sessionPlan?: SessionPlan } = {}): Harness {
  const driver = new FakeFrameDriver();
  const visibility = new FakeVisibility();
  const keys = new FakeKeyTarget();
  const doc = fakeDocument();
  const root = new FakeElement('div');

  const state = {
    ends: 0,
    progress: [] as number[],
    field: { progress: [] as number[], opacity: [] as number[], pulse: [] as number[] },
    bed: { starts: 0, stops: 0, gains: [] as number[] },
  };

  const handle = mountSession(
    root as unknown as HTMLElement,
    options.sessionPlan ?? plan,
    {
      onEnd: () => {
        state.ends += 1;
      },
      onProgress: (p) => state.progress.push(p),
    },
    {
      now: driver.now,
      scheduler: driver.scheduler,
      visibility,
      documentRef: doc,
      keyTarget: keys,
      reducedMotion: options.reducedMotion ?? false,
      field: {
        setProgress: (p) => state.field.progress.push(p),
        setOpacity: (a) => state.field.opacity.push(a),
        setPulseHz: (hz) => state.field.pulse.push(hz),
      },
      bed: {
        start: () => {
          state.bed.starts += 1;
        },
        stop: () => {
          state.bed.stops += 1;
        },
        setGain: (db) => state.bed.gains.push(db),
      },
    },
  );

  const findLane = (lane: LaneId): FakeElement => {
    const el = root.find(`hypnoapp-lane-${lane}`);
    if (!el) throw new Error(`lane ${lane} not mounted`);
    return el;
  };

  return {
    driver,
    visibility,
    keys,
    root,
    handle,
    created: doc.created,
    get ends() {
      return state.ends;
    },
    get progress() {
      return state.progress;
    },
    get field() {
      return state.field;
    },
    get bed() {
      return state.bed;
    },
    lane: findLane,
    closing: () => {
      const el = root.find('hypnoapp-closing');
      if (!el) throw new Error('closing line not mounted');
      return el;
    },
  };
}

/** Session time at which the plan's step `n` begins, including the threshold. */
function atStep(n: number): number {
  let t = THRESHOLD_TOTAL_MS;
  for (let i = 0; i < n; i += 1) t += plan.ticks[i].dwellMs;
  return t;
}

describe('mounting builds the DOM once and starts the clock', () => {
  it('creates the session, the lanes, the veil and the closing line', () => {
    const h = harness();
    expect(h.root.find('hypnoapp-session')).not.toBeNull();
    expect(h.root.find('hypnoapp-lanes')).not.toBeNull();
    expect(h.root.find('hypnoapp-veil')).not.toBeNull();
    expect(h.root.find('hypnoapp-closing')).not.toBeNull();
    for (const lane of ['left', 'center', 'right'] as LaneId[]) {
      expect(h.lane(lane)).toBeDefined();
    }
    h.handle.dispose();
  });

  it('carries §6.6\'s closing line, present but hidden from the start', () => {
    const h = harness();
    // Created at mount, not at the ending: a session that allocates DOM at its
    // most fragile moment is a session that can fail there.
    expect(h.closing().textContent).toBe(EXIT_LINE);
    expect(h.closing().style.display).toBe('none');
    h.handle.dispose();
  });

  it('starts running immediately — Begin has nothing to wait for', () => {
    const h = harness();
    expect(h.handle.running).toBe(true);
    h.driver.advance(16);
    expect(h.handle.elapsedMs).toBe(16);
    h.handle.dispose();
  });
});

describe('§6.5 — the opening runs before any text appears', () => {
  it('holds every lane dark through the threshold', () => {
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS - 200, 16);

    for (const lane of ['left', 'center', 'right'] as LaneId[]) {
      expect(h.lane(lane).style.display).toBe('none');
    }
    h.handle.dispose();
  });

  it('lifts the veil across the darken stage', () => {
    const h = harness();
    const veil = h.root.find('hypnoapp-veil')!;
    expect(Number(veil.style.opacity)).toBe(1);
    h.driver.run(1000, 16);
    expect(Number(veil.style.opacity)).toBeLessThan(0.2);
    h.handle.dispose();
  });

  it('starts the bed on the first frame it is active, inside the Begin gesture', () => {
    const h = harness();
    h.driver.advance(16);
    // §6.7: the bed starts on the Begin gesture, so the autoplay policy can
    // never silence it. Never from a timer.
    expect(h.bed.starts).toBe(1);
    h.driver.run(2000, 16);
    expect(h.bed.starts).toBe(1);
    h.handle.dispose();
  });

  it('brings the center in once the field has arrived and its offset has elapsed', () => {
    // The center anchors at +1000ms within its step (§5.3): the sides LEAD and
    // the anchor arrives last, so the first center line lands one lane-offset
    // after content time zero, not at it.
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS + plan.meta.laneOffsetsMs.center + 400, 16);
    expect(h.lane('center').style.display).toBe('block');
    expect(h.lane('center').textContent.length).toBeGreaterThan(0);
    h.handle.dispose();
  });

  it('does not eat the first steps of the induction', () => {
    // The plan's step 0 begins when the first line is ALLOWED to appear, not
    // when Begin was pressed. Without the content offset the threshold would
    // consume the opening of the induction and the session would start mid-line.
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS + plan.meta.laneOffsetsMs.center + 400, 16);
    expect(h.lane('center').textContent).toBe(plan.ticks[0].center.text);
    h.handle.dispose();
  });

  it('opens at full opacity rather than fading the induction in twice', () => {
    // `frameAt` carries its own 6-second fade-in for headless callers that have
    // no threshold in front of them. M4 does have one, so applying both would
    // play the first ten seconds of the induction at a fraction of its opacity.
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS + plan.meta.laneOffsetsMs.center + 600, 16);
    expect(Number(h.lane('center').style.opacity)).toBe(1);
    h.handle.dispose();
  });
});

describe('§5.3 — the sides arrive late and leave early', () => {
  it('the head plays on the center alone', () => {
    const h = harness();
    h.driver.run(atStep(0) + 1000, 16);
    expect(h.lane('center').style.display).toBe('block');
    expect(h.lane('left').style.display).toBe('none');
    expect(h.lane('right').style.display).toBe('none');
    h.handle.dispose();
  });

  it('all three lanes play through the middle', () => {
    const h = harness();
    h.driver.run(atStep(6) + 1500, 16);
    expect(plan.ticks[6].phase).toBe('middle');
    for (const lane of ['left', 'center', 'right'] as LaneId[]) {
      expect(h.lane(lane).style.display).toBe('block');
    }
    h.handle.dispose();
  });

  it('the tail returns to the center alone', () => {
    const h = harness();
    const tailStep = plan.ticks.findIndex((t) => t.phase === 'tail');
    expect(tailStep).toBeGreaterThan(0);
    // `FrameState.phase` is the ANCHOR's phase, and the anchor runs one lane
    // offset behind — so the tail is reached a further +1000ms in. Past that,
    // plus the fade, so the gate has fully CLOSED rather than merely started to.
    h.driver.run(atStep(tailStep) + plan.meta.laneOffsetsMs.center + 1200, 16);
    expect(h.lane('center').style.display).toBe('block');
    expect(h.lane('left').style.display).toBe('none');
    expect(h.lane('right').style.display).toBe('none');
    h.handle.dispose();
  });

  it('the sides CROSS-FADE in rather than cutting', () => {
    // §5.6: every appearance is a cross-fade of >=400ms. The gate approaches
    // its target one frame at a time, so the lane passes through intermediate
    // opacities on the way in.
    const h = harness();
    const middleStep = plan.ticks.findIndex((t) => t.phase === 'middle');
    // The anchor's phase is what drives the gate, and the anchor lags by its
    // lane offset — so the middle begins one offset after the step does.
    h.driver.run(atStep(middleStep) + plan.meta.laneOffsetsMs.center, 16);

    const seen: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      h.driver.advance(16);
      const o = Number(h.lane('right').style.opacity);
      if (o > 0) seen.push(o);
    }

    // Distinct intermediate opacities on the way in: a cross-fade, not a cut.
    const distinct = new Set(seen.map((v) => Math.round(v * 100)));
    expect(distinct.size).toBeGreaterThan(3);
    h.handle.dispose();
  });

  it('the center is the thread held the whole way', () => {
    const h = harness();
    let darkFrames = 0;
    let litFrames = 0;
    h.driver.run(THRESHOLD_TOTAL_MS + 500, 16);
    for (let t = 0; t < plan.meta.contentMs - 4000; t += 500) {
      h.driver.run(500, 16);
      if (h.lane('center').style.display === 'block') litFrames += 1;
      else darkFrames += 1;
    }
    // The center is between tokens sometimes — the envelope has a true absent
    // tail — but it is overwhelmingly present, which the sides are not.
    expect(litFrames).toBeGreaterThan(darkFrames * 4);
    h.handle.dispose();
  });
});

describe('C2 — the right channel leads the center by ~1s', () => {
  it('carries the plan\'s lane offsets, right leading center by 1000ms', () => {
    expect(plan.meta.laneOffsetsMs.right).toBe(0);
    expect(plan.meta.laneOffsetsMs.left).toBe(500);
    expect(plan.meta.laneOffsetsMs.center).toBe(1000);
    expect(plan.meta.laneOffsetsMs.center - plan.meta.laneOffsetsMs.right).toBe(1000);
  });

  it('the stagger is visible in the paint: the right lane is ahead of the center', () => {
    // The lanes free-run against their own offsets, so at any instant deep in
    // the middle the right lane is showing content from a step the center has
    // not reached yet. That is the stagger reading as intentional rather than
    // as jitter.
    const h = harness();
    const middleStep = plan.ticks.findIndex((t) => t.phase === 'middle') + 2;
    h.driver.run(atStep(middleStep) + 200, 16);

    const centerText = h.lane('center').textContent;
    const rightText = h.lane('right').textContent;
    expect(centerText.length).toBeGreaterThan(0);
    expect(rightText.length).toBeGreaterThan(0);
    // The right lane shows a WORD; the center shows a LINE. The anchor/
    // periphery distinction has a temporal dimension on top of alpha and scale.
    expect(rightText.split(' ')).toHaveLength(1);
    expect(centerText.split(' ').length).toBeGreaterThan(1);
    h.handle.dispose();
  });
});

describe('C8 — backgrounding the tab produces no burst', () => {
  it('60 seconds hidden advances the session by nothing', () => {
    const h = harness();
    h.driver.run(atStep(5), 16);
    const before = h.handle.elapsedMs;
    const textBefore = h.lane('center').textContent;

    h.visibility.set(true);
    expect(h.handle.running).toBe(false);

    h.driver.skip(60_000);
    h.driver.frame();

    expect(h.handle.elapsedMs).toBe(before);

    h.visibility.set(false);
    expect(h.handle.running).toBe(true);
    h.driver.advance(16);

    // The session picked up where it stopped: the same step, not twenty steps
    // later, and no queue of lines was flushed on return.
    expect(h.handle.elapsedMs).toBe(before + 16);
    expect(h.lane('center').textContent).toBe(textBefore);
    h.handle.dispose();
  });

  it('a user pause holds the lanes without clearing them', () => {
    const h = harness();
    h.driver.run(atStep(6) + 800, 16);
    const held = h.lane('center').textContent;

    h.handle.pause();
    h.driver.skip(30_000);
    h.driver.frame();

    expect(h.lane('center').textContent).toBe(held);
    h.handle.resume();
    h.driver.advance(16);
    expect(h.handle.running).toBe(true);
    h.handle.dispose();
  });
});

describe('C9 — Escape stops within 1.5s with a fade, never a cut', () => {
  it('Escape ends the session and reaches the closing line', () => {
    const h = harness();
    h.driver.run(atStep(6), 16);

    h.keys.press('Escape');
    expect(h.ends).toBe(0);

    // The fade needs frames to play. Within the abort budget plus the line's
    // own cross-fade, the session is over.
    h.driver.run(ABORT_FADE_MS + 1200, 16);
    expect(h.ends).toBe(1);
    h.handle.dispose();
  });

  it('the text is gone and the field faded, not cut', () => {
    const h = harness();
    h.driver.run(atStep(6), 16);
    h.keys.press('Escape');

    const opacities: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      h.driver.advance(16);
      opacities.push(h.field.opacity[h.field.opacity.length - 1] ?? 1);
    }

    expect(h.lane('center').style.display).toBe('none');
    // Intermediate values on the way down: a fade, not a cut.
    expect(opacities.some((o) => o > 0 && o < 1)).toBe(true);
    h.handle.dispose();
  });

  it('finishes inside the 1.5s the criterion allows', () => {
    const h = harness();
    h.driver.run(atStep(6), 16);
    const at = h.handle.elapsedMs;
    h.keys.press('Escape');
    h.driver.run(1500, 16);
    // The field is fully down inside the budget; the low-contrast line arriving
    // after it is the ending, not the stopping.
    expect(h.field.opacity[h.field.opacity.length - 1]).toBe(0);
    expect(h.handle.elapsedMs - at).toBeLessThanOrEqual(1600);
    h.handle.dispose();
  });

  it('ignores other keys', () => {
    const h = harness();
    h.driver.run(atStep(6), 16);
    h.keys.press('a');
    h.keys.press('Enter');
    h.driver.run(2000, 16);
    expect(h.ends).toBe(0);
    h.handle.dispose();
  });

  it('releases the key listener on dispose', () => {
    const h = harness();
    expect(h.keys.listenerCount).toBe(1);
    h.handle.dispose();
    expect(h.keys.listenerCount).toBe(0);
  });

  it('stop() is idempotent and does not restart the ending', () => {
    const h = harness();
    h.driver.run(atStep(6), 16);
    h.handle.stop();
    h.handle.stop();
    h.keys.press('Escape');
    h.driver.run(ABORT_FADE_MS + 1200, 16);
    expect(h.ends).toBe(1);
    h.handle.dispose();
  });
});

describe('§6.6 — the natural ending', () => {
  it('runs to the end of the plan and closes', () => {
    const h = harness();
    // The whole session plus the threshold, the plan's own tail and the exit.
    h.driver.run(THRESHOLD_TOTAL_MS + plan.meta.totalMs + 8000, 32);

    expect(h.ends).toBe(1);
    expect(h.closing().style.display).toBe('block');
    expect(Number(h.closing().style.opacity)).toBeGreaterThan(0);
    expect(h.lane('center').style.display).toBe('none');
    h.handle.dispose();
  });

  it('takes the bed down with the field rather than leaving a tone over black', () => {
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS + plan.meta.totalMs + 8000, 32);
    expect(h.bed.stops).toBeGreaterThanOrEqual(1);
    h.handle.dispose();
  });

  it('reports onEnd exactly once', () => {
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS + plan.meta.totalMs + 10_000, 32);
    h.handle.dispose();
    expect(h.ends).toBe(1);
  });

  it('reports progress every frame, monotonically, in [0,1]', () => {
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS + 20_000, 16);
    expect(h.progress.length).toBeGreaterThan(100);
    let last = -1;
    for (const p of h.progress) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    h.handle.dispose();
  });
});

describe('C4 — a full session allocates no DOM and writes no redundant styles', () => {
  it('creates its elements once for the whole session', () => {
    const h = harness();
    const afterMount = h.created.length;
    h.driver.run(THRESHOLD_TOTAL_MS + plan.meta.totalMs + 8000, 16);
    // Six: the session, the lane layer, three lanes, the veil, the closing
    // line. (The layer counts once and holds the three.) Nothing is created per
    // frame, which is the flat-heap claim in its most direct form.
    expect(h.created.length).toBe(afterMount);
    h.handle.dispose();
  });

  it('writes far fewer style changes than there are frames', () => {
    const h = harness();
    const frames = 1200;
    h.driver.run(THRESHOLD_TOTAL_MS + 500, 16);
    const center = h.lane('center');
    const before = center.style.writes.length;

    h.driver.run(frames * 16, 16);

    const writes = center.style.writes.length - before;
    // A renderer that wrote unconditionally would issue at least one write per
    // frame per property. Skipping unchanged values is what keeps 60fps at the
    // peak, where three lanes are live at once.
    expect(writes).toBeLessThan(frames);
    h.handle.dispose();
  });

  it('does not re-push an unchanged field opacity', () => {
    const h = harness();
    h.driver.run(THRESHOLD_TOTAL_MS + 10_000, 16);
    const pushes = h.field.opacity.length;
    // The field sits at full opacity for most of the session; a push per frame
    // would be ~600 by now.
    expect(pushes).toBeLessThan(400);
    h.handle.dispose();
  });
});

describe('C3 — the lanes drift against each other (observation, not a gate)', () => {
  it('a plan with driftPct 0 keeps every lane multiplier at exactly 1.0', () => {
    // The reference plan is the no-drift case, and C3 says driftPct is tunable
    // to 0. Asserting the identity here is what makes a future non-zero drift a
    // visible change rather than an invisible one.
    for (const lane of ['left', 'center', 'right'] as LaneId[]) {
      expect(plan.meta.laneDrift[lane]).toBe(1);
    }
  });

  it('a drifted plan puts the lanes on different steps', () => {
    const drifted: SessionPlan = {
      ...plan,
      meta: { ...plan.meta, laneDrift: { left: 0.94, center: 1, right: 1.06 } },
    };
    const h = harness({ sessionPlan: drifted });
    h.driver.run(atStep(12), 16);

    // Deep in the middle the three lanes have accumulated different amounts of
    // their own time, so they are showing content from different steps. That is
    // intended texture; the Phase D sitting decides whether it reads as texture
    // or as broken timing.
    const texts = new Set(
      (['left', 'center', 'right'] as LaneId[]).map((lane) => h.lane(lane).textContent),
    );
    expect(texts.size).toBeGreaterThan(1);
    h.handle.dispose();
  });
});

describe('C9 — a reduced-motion session still works end to end', () => {
  it('completes with a shorter opening and no parallax', () => {
    const h = harness({ reducedMotion: true });
    h.driver.run(2000, 16);
    // The threshold collapsed to 600ms, so text is already playing where a
    // full-motion session would still be opening.
    expect(h.lane('center').style.display).toBe('block');
    expect(h.lane('center').style.transform).toBe('translate(-50%, -50%) scale(1)');

    h.driver.run(plan.meta.totalMs + 8000, 32);
    expect(h.ends).toBe(1);
    h.handle.dispose();
  });

  it('uses 200ms cross-fades and never a cut', () => {
    const h = harness({ reducedMotion: true });
    // Past the collapsed threshold AND the center's lane offset, so the anchor
    // has actually painted and carries a transition to read.
    h.driver.run(2000, 16);
    expect(h.lane('center').style.transition).toBe('opacity 200ms linear');
    h.handle.dispose();
  });
});

describe('the session degrades rather than throwing', () => {
  it('runs with no field and no bed at all', () => {
    const driver = new FakeFrameDriver();
    const doc = fakeDocument();
    const root = new FakeElement('div');
    let ended = 0;

    const handle = mountSession(
      root as unknown as HTMLElement,
      plan,
      { onEnd: () => { ended += 1; }, onProgress: () => {} },
      {
        now: driver.now,
        scheduler: driver.scheduler,
        visibility: new FakeVisibility(),
        documentRef: doc,
        keyTarget: new FakeKeyTarget(),
      },
    );

    // A missing WebGL context or a blocked AudioContext leaves a session that
    // still runs. The text is the session; the field and the bed are its room.
    expect(() => driver.run(THRESHOLD_TOTAL_MS + plan.meta.totalMs + 8000, 32)).not.toThrow();
    expect(ended).toBe(1);
    handle.dispose();
  });

  it('dispose tears everything down and reports the end once', () => {
    const h = harness();
    h.driver.run(atStep(4), 16);
    h.handle.dispose();

    expect(h.root.children.length).toBe(0);
    expect(h.handle.running).toBe(false);
    expect(h.ends).toBe(1);

    // A disposed session is inert: further frames do nothing at all.
    expect(() => h.driver.run(10_000, 16)).not.toThrow();
    expect(h.ends).toBe(1);
  });

  it('dispose is idempotent', () => {
    const h = harness();
    h.handle.dispose();
    h.handle.dispose();
    expect(h.ends).toBe(1);
  });
});

describe('helpers', () => {
  it('gainForFade converts through linear rather than scaling dB', () => {
    // Multiplying a dB value is wrong: half of -18dB is not -9dB. -6dB is the
    // half-amplitude point, so a 0.5 envelope on -18 must land near -24.
    expect(gainForFade(-18, 1)).toBeCloseTo(-18, 2);
    expect(gainForFade(-18, 0.5)).toBeCloseTo(-24.02, 1);
    expect(gainForFade(-18, 0)).toBe(-60);
    expect(gainForFade(-18, -5)).toBe(-60);
  });

  it('approach is frame-rate independent and never overshoots', () => {
    expect(approach(0, 1, 0.25)).toBe(0.25);
    expect(approach(0.9, 1, 0.25)).toBe(1);
    expect(approach(1, 0, 0.25)).toBe(0.75);
    expect(approach(0.1, 0, 0.25)).toBe(0);
    expect(approach(0.5, 0.5, 0.25)).toBe(0.5);
    // A zero or nonsensical step holds rather than jumping.
    expect(approach(0.3, 1, 0)).toBe(0.3);
    expect(approach(0.3, 1, Number.NaN)).toBe(0.3);
  });
});
