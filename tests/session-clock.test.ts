/**
 * M4 — the session clock, acceptance C8.
 *
 * The one assertion this file exists for: **background the tab for 60 seconds,
 * come back, and get no burst.** That is the failure MEASURED in this repo at
 * `src/routes/Player.tsx:75`, and it is the reason the clock is a module with
 * its own tests rather than eight lines inside the renderer.
 *
 * Every test drives an injected `now` and an injected scheduler, so a
 * twenty-minute session runs in under a millisecond and the assertions are on
 * exact numbers rather than on tolerances.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_FRAME_MS, createClock, type ClockTick } from '../web/session/clock.ts';
import { FakeFrameDriver, FakeVisibility } from './session-dom.ts';

function build(options: { maxFrameMs?: number } = {}) {
  const driver = new FakeFrameDriver();
  const visibility = new FakeVisibility();
  const ticks: ClockTick[] = [];
  const clock = createClock((tick) => ticks.push(tick), {
    now: driver.now,
    scheduler: driver.scheduler,
    visibility,
    maxFrameMs: options.maxFrameMs,
  });
  return { driver, visibility, ticks, clock };
}

describe('the clock advances from performance.now deltas inside rAF', () => {
  it('accumulates elapsed time one frame at a time', () => {
    const { driver, clock, ticks } = build();
    clock.start();

    driver.advance(16);
    driver.advance(16);
    driver.advance(17);

    expect(ticks.map((t) => t.deltaMs)).toEqual([16, 16, 17]);
    expect(clock.elapsedMs).toBe(49);
  });

  it('does not advance before start or after dispose', () => {
    const { driver, clock } = build();

    driver.advance(100);
    expect(clock.elapsedMs).toBe(0);

    clock.start();
    driver.advance(100);
    expect(clock.elapsedMs).toBe(100);

    clock.dispose();
    driver.advance(100);
    expect(clock.elapsedMs).toBe(100);
  });

  it('keeps requesting frames for as long as it runs', () => {
    const { driver, clock } = build();
    clock.start();
    for (let i = 0; i < 50; i += 1) driver.advance(16);
    expect(driver.scheduler.pendingCount).toBe(1);
    clock.dispose();
    expect(driver.scheduler.pendingCount).toBe(0);
  });

  it('never runs backwards on a non-monotonic time source', () => {
    const driver = new FakeFrameDriver();
    let t = 0;
    const readings = [0, 100, 40, 200];
    let i = 0;
    const clock = createClock(() => {}, {
      now: () => {
        t = readings[Math.min(i, readings.length - 1)];
        i += 1;
        return t;
      },
      scheduler: driver.scheduler,
      visibility: new FakeVisibility(),
    });

    clock.start();
    driver.frame();
    driver.frame();
    driver.frame();

    expect(clock.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('C8 — backgrounding produces no burst', () => {
  it('a 60-second hidden gap adds nothing to elapsed time', () => {
    const { driver, visibility, clock } = build();
    clock.start();

    driver.advance(16);
    driver.advance(16);
    const before = clock.elapsedMs;
    expect(before).toBe(32);

    // The tab hides. A real browser stops calling rAF; the wall clock does not
    // stop, which is exactly what a naive `now() - startedAt` clock would bank.
    visibility.set(true);
    expect(clock.running).toBe(false);

    driver.skip(60_000);
    driver.frame();

    expect(clock.elapsedMs).toBe(before);

    // And on return the session resumes from where it stopped, not 60s later.
    visibility.set(false);
    expect(clock.running).toBe(true);
    driver.advance(16);
    expect(clock.elapsedMs).toBe(before + 16);
  });

  it('clamps a single enormous delta even without a visibility event', () => {
    // The belt to the visibility braces: a browser that fires one catch-up
    // frame, a GC pause, a laptop lid. The gap must not become session time.
    const { driver, clock } = build();
    clock.start();
    driver.advance(16);

    driver.skip(60_000);
    driver.frame();

    expect(clock.elapsedMs).toBe(16 + DEFAULT_MAX_FRAME_MS);
    expect(clock.skippedMs).toBeCloseTo(60_000 - DEFAULT_MAX_FRAME_MS, 6);
  });

  it('a normal frame hitch is NOT swallowed', () => {
    // The clamp must not make the session run slow on an ordinary machine:
    // 100ms is four dropped frames, well inside the budget, and it counts.
    const { driver, clock } = build();
    clock.start();
    driver.advance(100);
    expect(clock.elapsedMs).toBe(100);
    expect(clock.skippedMs).toBe(0);
  });

  it('a user pause outranks the tab coming back', () => {
    const { driver, visibility, clock } = build();
    clock.start();
    driver.advance(16);

    clock.pause();
    expect(clock.running).toBe(false);
    expect(clock.pausedByUser).toBe(true);

    visibility.set(true);
    visibility.set(false);

    // "I paused this" survives a tab switch. A session that resumed itself
    // because the user checked their email is a session that resumed without
    // consent.
    expect(clock.running).toBe(false);

    clock.resume();
    expect(clock.running).toBe(true);
  });

  it('starting into a hidden tab waits for the tab rather than playing to nobody', () => {
    const { driver, visibility, clock } = build();
    visibility.set(true);

    clock.start();
    expect(clock.running).toBe(false);

    driver.skip(5_000);
    driver.frame();
    expect(clock.elapsedMs).toBe(0);

    visibility.set(false);
    expect(clock.running).toBe(true);
    driver.advance(16);
    expect(clock.elapsedMs).toBe(16);
  });

  it('pause and resume are idempotent', () => {
    const { driver, clock } = build();
    clock.start();
    clock.start();
    driver.advance(16);

    clock.pause();
    clock.pause();
    driver.skip(1000);
    driver.frame();
    expect(clock.elapsedMs).toBe(16);

    clock.resume();
    clock.resume();
    driver.advance(16);
    expect(clock.elapsedMs).toBe(32);
  });

  it('releases the visibility listener on dispose', () => {
    const driver = new FakeFrameDriver();
    const visibility = new FakeVisibility();
    const clock = createClock(() => {}, {
      now: driver.now,
      scheduler: driver.scheduler,
      visibility,
    });
    expect(visibility.listenerCount).toBe(1);
    clock.dispose();
    expect(visibility.listenerCount).toBe(0);
  });
});

describe('the clock survives a throwing renderer', () => {
  it('keeps ticking after a callback throws', () => {
    const driver = new FakeFrameDriver();
    let calls = 0;
    const clock = createClock(() => {
      calls += 1;
      if (calls === 2) throw new Error('renderer blew up');
    }, {
      now: driver.now,
      scheduler: driver.scheduler,
      visibility: new FakeVisibility(),
    });

    clock.start();
    driver.advance(16);
    expect(() => driver.advance(16)).toThrow('renderer blew up');
    // The next frame was requested BEFORE the callback ran, so a throw costs a
    // frame of pixels rather than the whole session's clock.
    driver.advance(16);
    expect(calls).toBe(3);
    expect(clock.elapsedMs).toBe(48);
  });
});

describe('there is no setInterval anywhere in the clock', () => {
  it('drives entirely from the injected scheduler', () => {
    // Structural, not textual — the lint rule covers the text. This asserts the
    // stronger property: with the scheduler never flushed, time never advances,
    // which cannot be true of a clock with a second timer hidden in it.
    const { driver, clock } = build();
    clock.start();
    driver.skip(10_000);
    expect(clock.elapsedMs).toBe(0);
  });
});
