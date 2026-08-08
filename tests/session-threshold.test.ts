/**
 * M4 — the threshold and the exit, DESIGN.md §6.5 and §6.6.
 *
 * Both are pure functions of elapsed time onto opacities, which is what makes
 * the opening and the ending assertable at all: a CSS animation would be a
 * screenshot test, and a screenshot test of a four-second fade is a test nobody
 * runs.
 *
 * The strongest assertions here are about what is ABSENT. §6.5 says no spinner
 * — so the threshold has no loading state to test, and the test that matters is
 * that its length is fixed and known before the session starts. §6.6 says no
 * stats, no score, no share prompt — so the exit's entire output surface is two
 * opacities and one line, and that is asserted directly.
 */

import { describe, expect, it } from 'vitest';

import {
  REDUCED_THRESHOLD_STAGE_MS,
  THRESHOLD_BED_MS,
  THRESHOLD_DARKEN_MS,
  THRESHOLD_FIELD_MS,
  THRESHOLD_TOTAL_MS,
  thresholdAt,
  thresholdSchedule,
} from '../web/session/threshold.ts';
import {
  ABORT_FADE_MS,
  EXIT_BLACK_MS,
  EXIT_FADE_MS,
  EXIT_LINE,
  EXIT_LINE_OPACITY,
  exitAt,
  exitSchedule,
} from '../web/session/exit.ts';

describe('§6.5 — the threshold runs Begin -> darken -> bed -> field -> first line', () => {
  it('uses the timings the design specifies', () => {
    expect(THRESHOLD_DARKEN_MS).toBe(800);
    expect(THRESHOLD_BED_MS).toBe(2000);
    expect(THRESHOLD_FIELD_MS).toBe(2000);
    expect(THRESHOLD_TOTAL_MS).toBe(4800);
  });

  it('darkens first and alone', () => {
    // The 800ms of darkening is the beat that says "we have started" before
    // anything else moves.
    const early = thresholdAt(400);
    expect(early.darken).toBeGreaterThan(0);
    expect(early.bed).toBe(0);
    expect(early.field).toBe(0);
    expect(early.text).toBe(0);
  });

  it('responds to Begin inside the first frame', () => {
    // `early` ease on the darken: the screen commits immediately and settles,
    // so Begin never feels ignored. A `late` ease here would spend 500ms near
    // zero and read as a hang.
    const first = thresholdAt(16);
    expect(first.darken).toBeGreaterThan(0.05);
  });

  it('brings the bed up only after the darkening', () => {
    expect(thresholdAt(THRESHOLD_DARKEN_MS - 1).bed).toBe(0);
    expect(thresholdAt(THRESHOLD_DARKEN_MS + 1000).bed).toBeGreaterThan(0);
    expect(thresholdAt(THRESHOLD_DARKEN_MS + THRESHOLD_BED_MS).bed).toBe(1);
  });

  it('brings the field up only after the bed', () => {
    const bedDone = THRESHOLD_DARKEN_MS + THRESHOLD_BED_MS;
    expect(thresholdAt(bedDone - 1).field).toBe(0);
    expect(thresholdAt(bedDone + 1000).field).toBeGreaterThan(0);
    expect(thresholdAt(THRESHOLD_TOTAL_MS).field).toBe(1);
  });

  it('holds the first center line until the field has fully arrived', () => {
    // The first line cross-fades in against a field that is already there,
    // never onto a black screen.
    expect(thresholdAt(THRESHOLD_TOTAL_MS - 1).text).toBe(0);
    expect(thresholdAt(THRESHOLD_TOTAL_MS).text).toBe(1);
    expect(thresholdAt(THRESHOLD_TOTAL_MS).complete).toBe(true);
  });

  it('lands the first line inside §6.5\'s 0:00-0:06 window', () => {
    expect(THRESHOLD_TOTAL_MS).toBeGreaterThanOrEqual(3000);
    expect(THRESHOLD_TOTAL_MS).toBeLessThanOrEqual(6000);
  });

  it('every stage is monotone — nothing flickers on the way in', () => {
    let lastDarken = -1;
    let lastBed = -1;
    let lastField = -1;
    for (let t = 0; t <= THRESHOLD_TOTAL_MS + 500; t += 25) {
      const s = thresholdAt(t);
      expect(s.darken).toBeGreaterThanOrEqual(lastDarken);
      expect(s.bed).toBeGreaterThanOrEqual(lastBed);
      expect(s.field).toBeGreaterThanOrEqual(lastField);
      lastDarken = s.darken;
      lastBed = s.bed;
      lastField = s.field;
    }
  });

  it('every value stays inside [0,1] including before zero and past the end', () => {
    for (const t of [-1000, -1, 0, 1, 2500, THRESHOLD_TOTAL_MS, 1e9, Number.NaN]) {
      const s = thresholdAt(t);
      for (const v of [s.darken, s.bed, s.field, s.text]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has no loading state at all — §6.5 has nothing to wait for', () => {
    // The whole point of the mechanic: the plan, the pool filtering, the
    // variants, the fonts and the shader all happened on the setup screen. If
    // this ever grew a `loading` field, the fix would be upstream.
    const keys = Object.keys(thresholdAt(1000)).sort();
    expect(keys).toEqual(['bed', 'complete', 'darken', 'field', 'text']);
  });
});

describe('C9 — the reduced-motion threshold still opens gently', () => {
  it('collapses each stage to 200ms without removing the sequence', () => {
    const schedule = thresholdSchedule({ reducedMotion: true });
    expect(schedule.totalMs).toBe(REDUCED_THRESHOLD_STAGE_MS * 3);
    expect(schedule.darken.startMs).toBe(0);
    expect(schedule.bed.startMs).toBe(REDUCED_THRESHOLD_STAGE_MS);
    expect(schedule.field.startMs).toBe(REDUCED_THRESHOLD_STAGE_MS * 2);
  });

  it('still orders darken before bed before field', () => {
    const opts = { reducedMotion: true };
    expect(thresholdAt(100, opts).bed).toBe(0);
    expect(thresholdAt(300, opts).field).toBe(0);
    expect(thresholdAt(600, opts).complete).toBe(true);
  });
});

describe('§6.6 — the exit fades, holds black, then says `again · done`', () => {
  it('uses the timings the design specifies', () => {
    expect(EXIT_FADE_MS).toBe(4000);
    expect(EXIT_BLACK_MS).toBe(2000);
    expect(EXIT_LINE).toBe('again · done');
  });

  it('fades the field over four seconds', () => {
    expect(exitAt(0).field).toBe(1);
    expect(exitAt(2000).field).toBeGreaterThan(0);
    expect(exitAt(2000).field).toBeLessThan(1);
    expect(exitAt(EXIT_FADE_MS).field).toBe(0);
    expect(exitAt(0).stage).toBe('fading');
  });

  it('holds black for two seconds with nothing on screen', () => {
    const black = exitAt(EXIT_FADE_MS + 1000);
    expect(black.stage).toBe('black');
    expect(black.field).toBe(0);
    expect(black.text).toBe(0);
    expect(black.line).toBe(0);
  });

  it('brings the closing line in after the black', () => {
    const closed = exitAt(EXIT_FADE_MS + EXIT_BLACK_MS + 1000);
    expect(closed.stage).toBe('closed');
    expect(closed.line).toBe(1);
    expect(closed.complete).toBe(true);
  });

  it('the text is gone before the field starts moving', () => {
    // §4.11's plan-level tail already took the text down; the two tails
    // COMPOSE rather than overlap, so the exit never re-fades live text.
    for (const t of [0, 1000, 4000, 7000]) {
      expect(exitAt(t).text).toBe(0);
    }
  });

  it('keeps the closing line low-contrast', () => {
    expect(EXIT_LINE_OPACITY).toBeLessThan(0.5);
    expect(EXIT_LINE_OPACITY).toBeGreaterThan(0);
  });

  it('offers nothing but two opacities and a line — no stats, no score, no share', () => {
    const keys = Object.keys(exitAt(10_000)).sort();
    expect(keys).toEqual(['complete', 'field', 'line', 'stage', 'text']);
    // Two words and a middot. There is no count, no streak, no percentage.
    expect(EXIT_LINE.split(/\s+/).filter((w) => w !== '·')).toHaveLength(2);
    expect(EXIT_LINE).not.toMatch(/\d/);
  });

  it('the field fade is monotone — a session never brightens on the way out', () => {
    let last = 2;
    for (let t = 0; t <= EXIT_FADE_MS; t += 25) {
      const v = exitAt(t).field;
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });
});

describe('C9 — Escape stops within 1.5s, with a fade and never a cut', () => {
  it('the abort fade fits inside the 1.5s budget with headroom', () => {
    expect(ABORT_FADE_MS).toBeLessThanOrEqual(1500);
    expect(exitSchedule({ abort: true }).fadeMs).toBe(ABORT_FADE_MS);
  });

  it('is a fade, not a cut — the field passes through intermediate values', () => {
    const mid = exitAt(ABORT_FADE_MS / 2, { abort: true }).field;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(exitAt(0, { abort: true }).field).toBe(1);
    expect(exitAt(ABORT_FADE_MS, { abort: true }).field).toBe(0);
  });

  it('skips the two-second black — the user asked to leave', () => {
    const schedule = exitSchedule({ abort: true });
    expect(schedule.blackMs).toBe(0);
    // The whole aborted ending, fade plus line, is still short enough that
    // "stopped" is unambiguous well before the user wonders whether it worked.
    expect(schedule.totalMs).toBeLessThan(EXIT_FADE_MS);
  });

  it('reaches the closing line rather than ending on black', () => {
    const schedule = exitSchedule({ abort: true });
    const done = exitAt(schedule.totalMs, { abort: true });
    expect(done.stage).toBe('closed');
    expect(done.complete).toBe(true);
  });
});

describe('the reduced-motion exit shortens the fades but keeps the beat', () => {
  it('keeps the two-second black intact', () => {
    // Reduced motion means less movement, not less time. Removing the pause
    // would take away what makes the ending an ending.
    expect(exitSchedule({ reducedMotion: true }).blackMs).toBe(EXIT_BLACK_MS);
  });

  it('shortens the field fade', () => {
    expect(exitSchedule({ reducedMotion: true }).fadeMs).toBeLessThan(EXIT_FADE_MS);
    expect(exitSchedule({ reducedMotion: true }).fadeMs).toBeGreaterThanOrEqual(200);
  });
});
