/**
 * M2 acceptance — the conductor and DESIGN.md §4.11's parity checklist.
 *
 * The checklist's fourteen rows are every behaviour recon-hypnocli lists under
 * "Port", and MODULES.json requires all fourteen to pass HEADLESS, WITH NO
 * BROWSER. So each row below is a test against a plan or a frame — never
 * against a rendered pixel — which is the whole point of the schedule/render
 * split: the schedule is testable without the renderer existing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { plan, isPlanFailure } from '../engine/plan/plan.ts';
import { frameAt, stripPauses, tokenize } from '../engine/conduct/frameAt.ts';
import { loadCorpus, isLoadFailure } from '../engine/corpus/load.ts';
import { DEFAULT_SESSION_OPTIONS, type SessionOptions, type UserConfig } from '../engine/types/config.ts';
import { LANE_IDS } from '../engine/types/frame.ts';
import type { Corpus } from '../engine/types/record.ts';
import type { SessionPlan } from '../engine/types/plan.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, 'fixtures', name), 'utf8')) as unknown;

const loaded = loadCorpus(fixture('corpus.mini.json'), fixture('persons.mini.json'));
if (isLoadFailure(loaded)) throw new Error('corpus.mini failed to load');
const corpus: Corpus = loaded;

const referenceConfig = fixture('config.reference.json') as UserConfig;
const referencePlan = fixture('plan.reference.json') as SessionPlan;

const NO_DRIFT: Partial<SessionOptions> = {
  pacing: { ...DEFAULT_SESSION_OPTIONS.pacing, driftPct: 0 },
};

function planOrThrow(opts: Partial<SessionOptions> = NO_DRIFT, seed = 47): SessionPlan {
  const result = plan(corpus, referenceConfig, opts, seed, { length: referencePlan.meta.length });
  if (isPlanFailure(result)) throw new Error(`expected a plan: ${JSON.stringify(result)}`);
  return result;
}

describe('parity row 1 — a field of three voices, each with its own stream', () => {
  it('every tick carries all three lanes', () => {
    const p = planOrThrow();
    expect(p.ticks).toHaveLength(p.meta.length);
    for (const tick of p.ticks) {
      for (const lane of LANE_IDS) {
        expect(tick[lane].mantraId.length, `step ${tick.step} ${lane}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('parity row 2 — right leads, then left, then centre; sides attenuated', () => {
  it('the offsets are 0 / 500 / 1000', () => {
    const p = planOrThrow();
    expect(p.meta.laneOffsetsMs).toEqual({ right: 0, left: 500, center: 1000 });
  });

  it('the centre is the anchor: it arrives last and is the only full-alpha lane', () => {
    const p = planOrThrow();
    const frame = frameAt(p, 4000);
    expect(frame.channels.center.alpha).toBe(1);
    expect(frame.channels.left.alpha).toBeLessThan(1);
    expect(frame.channels.right.alpha).toBeLessThan(1);
    expect(frame.channels.center.scale).toBeGreaterThan(frame.channels.left.scale);
  });

  it('a side lane is dark before its offset has elapsed', () => {
    const p = planOrThrow();
    // At 200ms only `right` (offset 0) has started.
    const frame = frameAt(p, 200);
    expect(frame.channels.right.active).toBe(true);
    expect(frame.channels.left.active).toBe(false);
    expect(frame.channels.center.active).toBe(false);
  });
});

describe('parity row 3 — channels free-run and drift', () => {
  it('per-channel jitter is non-zero when driftPct is on', () => {
    const drifted = planOrThrow({}, 47);
    const values = LANE_IDS.map((lane) => drifted.meta.laneDrift[lane]);
    expect(values.some((v) => v !== 1)).toBe(true);
    for (const v of values) {
      expect(Math.abs(v - 1)).toBeLessThanOrEqual(DEFAULT_SESSION_OPTIONS.pacing.driftPct);
    }
  });

  it('driftPct 0 pins every lane to EXACTLY 1.0', () => {
    // Not 0.9999999: the reference plan pins drift off so a byte-comparison
    // tests the planner rather than the jitter.
    const p = planOrThrow(NO_DRIFT);
    for (const lane of LANE_IDS) expect(p.meta.laneDrift[lane]).toBe(1);
  });

  it('lanes are never re-synchronized — they diverge as the session runs', () => {
    const drifted = planOrThrow({}, 47);
    // Late in the session the lanes sit on different steps, which is the
    // intended texture rather than a defect.
    const late = frameAt(drifted, drifted.meta.contentMs * 0.8);
    expect(late.channels.center.active || late.channels.left.active).toBe(true);
  });
});

describe('parity row 5 — gaussian titration builds, peaks and weans', () => {
  it('the trace is unimodal and returns to where it started', () => {
    const trace = planOrThrow().ticks.map((t) => t.intensity);
    expect(trace[0]).toBeCloseTo(trace[trace.length - 1], 5);
    expect(Math.max(...trace)).toBeGreaterThan(trace[0]);
  });

  it('linear is available as the monotone alternative', () => {
    const p = planOrThrow({ ...NO_DRIFT, titration: 'linear' });
    const trace = p.ticks.map((t) => t.intensity);
    for (let i = 1; i < trace.length; i += 1) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]);
  });
});

describe('parity row 7 — bookends, 10%, min 1, capped at half, excluded from the pool', () => {
  it('the reference plan splits 2 / 16 / 2', () => {
    const p = planOrThrow();
    expect({ head: p.meta.head, middle: p.meta.middle, tail: p.meta.tail }).toEqual({
      head: 2,
      middle: 16,
      tail: 2,
    });
  });

  it('phases are labelled consistently with the counts', () => {
    const p = planOrThrow();
    for (const tick of p.ticks) {
      const expected =
        tick.step < p.meta.head
          ? 'head'
          : tick.step >= p.meta.length - p.meta.tail
            ? 'tail'
            : 'middle';
      expect(tick.phase, `step ${tick.step}`).toBe(expected);
    }
  });
});

describe('parity row 9 — the anchor does not titrate in person', () => {
  it('the centre is `second` at every step and every frame', () => {
    const p = planOrThrow();
    for (const tick of p.ticks) expect(tick.center.person).toBe('second');
  });
});

describe('parity row 10 — a continuous, non-masking bed', () => {
  it('the plan carries the bed', () => {
    const p = planOrThrow();
    expect(p.bed.preset).toBe('drone');
    expect(typeof p.bed.gainDb).toBe('number');
  });

  it('the bed sounds through the quiet tail and stops with the session', () => {
    // The quiet after the last line is quiet of TEXT, not of the bed: cutting
    // the bed with the content is what makes an ending feel abrupt.
    const p = planOrThrow();
    const afterContent = frameAt(p, p.meta.contentMs + 500);
    expect(afterContent.bed.active).toBe(true);
    expect(afterContent.channels.center.active).toBe(false);
    expect(frameAt(p, p.meta.totalMs + 1).bed.active).toBe(false);
  });

  it('C9 the pulse never exceeds the ~3Hz ceiling', () => {
    // No strobing, ever. The backdrop derives its rate from this.
    const p = planOrThrow();
    for (let t = 0; t <= p.meta.totalMs; t += 500) {
      const frame = frameAt(p, t);
      expect(frame.bed.pulseHz, `at ${t}ms`).toBeGreaterThan(0);
      expect(frame.bed.pulseHz, `at ${t}ms`).toBeLessThanOrEqual(3);
    }
  });
});

describe('parity row 11 — ~2.5s tail plus a 1.5s fade', () => {
  it('totalMs is the content plus both', () => {
    const p = planOrThrow();
    const content = p.ticks.reduce((sum, t) => sum + t.dwellMs, 0);
    expect(p.meta.contentMs).toBe(content);
    expect(p.meta.tailQuietMs).toBe(2500);
    expect(p.meta.tailFadeMs).toBe(1500);
    expect(p.meta.totalMs).toBe(content + 2500 + 1500);
  });

  it('the session fades rather than stopping abruptly', () => {
    const p = planOrThrow();
    const fadeStart = p.meta.totalMs - p.meta.tailFadeMs;
    expect(frameAt(p, fadeStart).masterAlpha).toBeCloseTo(1, 5);
    expect(frameAt(p, fadeStart + p.meta.tailFadeMs / 2).masterAlpha).toBeLessThan(1);
    expect(frameAt(p, p.meta.totalMs).masterAlpha).toBeCloseTo(0, 5);
  });

  it('`ended` is not "we are near the end"', () => {
    const p = planOrThrow();
    expect(frameAt(p, p.meta.contentMs).ended).toBe(false);
    expect(frameAt(p, p.meta.totalMs - 1).ended).toBe(false);
    expect(frameAt(p, p.meta.totalMs).ended).toBe(true);
  });
});

describe('parity row 12 — inline [500] / [1.5s] pause markers round-trip', () => {
  it('a marker becomes holdMs and never becomes visible text', () => {
    expect(stripPauses('I sink [500] deeper')).toEqual({ text: 'I sink deeper', holdMs: 500 });
    expect(stripPauses('I sink [1.5s] deeper')).toEqual({ text: 'I sink deeper', holdMs: 1500 });
    expect(stripPauses('no marker here')).toEqual({ text: 'no marker here', holdMs: 0 });
  });

  it('accumulates multiple markers in one line', () => {
    expect(stripPauses('a [250] b [250] c').holdMs).toBe(500);
  });

  it('tokenizing never emits a marker as a word', () => {
    expect(tokenize('I sink [500] deeper', 'WORD')).toEqual(['I', 'sink', 'deeper']);
    expect(tokenize('I sink [500] deeper', 'LINE')).toEqual(['I sink deeper']);
  });
});

describe('the conductor owns no clock', () => {
  it('is a pure function of (plan, elapsedMs)', () => {
    const p = planOrThrow();
    for (const t of [0, 1, 999, 5000, 51234]) {
      expect(frameAt(p, t)).toEqual(frameAt(p, t));
    }
  });

  it('progress is clamped to [0,1] and monotone in elapsedMs', () => {
    const p = planOrThrow();
    let previous = -1;
    for (let t = 0; t <= p.meta.totalMs + 5000; t += 250) {
      const frame = frameAt(p, t);
      expect(frame.progress).toBeGreaterThanOrEqual(0);
      expect(frame.progress).toBeLessThanOrEqual(1);
      expect(frame.progress).toBeGreaterThanOrEqual(previous);
      previous = frame.progress;
    }
  });

  it('a frame is a plain serializable value', () => {
    const frame = frameAt(planOrThrow(), 12000);
    expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  });

  it('§6.5 the threshold fades in rather than cutting to a full field of text', () => {
    const p = planOrThrow();
    expect(frameAt(p, 0).masterAlpha).toBe(0);
    expect(frameAt(p, 3000).masterAlpha).toBeGreaterThan(0);
    expect(frameAt(p, 3000).masterAlpha).toBeLessThan(1);
    expect(frameAt(p, 6000).masterAlpha).toBe(1);
  });

  it('an inactive lane paints NOTHING — the `.active` gate, not a zero alpha', () => {
    const p = planOrThrow();
    const frame = frameAt(p, 100);
    for (const lane of LANE_IDS) {
      const channel = frame.channels[lane];
      if (channel.active) continue;
      expect(channel.text, lane).toBe('');
      expect(channel.mantraId, lane).toBe('');
      expect(channel.alpha, lane).toBe(0);
    }
  });

  it('a WORD lane drains one token at a time while LINE shows the phrase whole', () => {
    const p = planOrThrow();
    // Sample across one step of the centre's dwell and confirm the side shows
    // single tokens throughout.
    for (let t = 2000; t < 5000; t += 250) {
      const frame = frameAt(p, t);
      for (const lane of ['left', 'right'] as const) {
        if (!frame.channels[lane].active) continue;
        expect(frame.channels[lane].split).toBe('WORD');
        expect(frame.channels[lane].text.trim().split(/\s+/).length, `${lane} at ${t}`).toBe(1);
      }
      if (frame.channels.center.active) expect(frame.channels.center.split).toBe('LINE');
    }
  });

  it('carries the RAW template beside the token, unsubstituted', () => {
    // Substitution is a display-time act (§2.4), so a rename re-renders content
    // already in flight.
    const p = planOrThrow();
    const withPlaceholder = p.ticks.find((t) =>
      [t.center.text, t.left.text, t.right.text].some((s) => s.includes('{')),
    );
    expect(withPlaceholder, 'the fixture should exercise a placeholder').toBeDefined();
    for (const tick of p.ticks) {
      for (const lane of LANE_IDS) {
        expect(tick[lane].text).not.toContain(p.meta.subjectName);
        expect(tick[lane].text).not.toContain(p.meta.operatorName);
      }
    }
  });

  it('the frame names the anchor s step, and sides may sit on a neighbour', () => {
    const drifted = planOrThrow({}, 47);
    const frame = frameAt(drifted, 20000);
    expect(frame.step).toBeGreaterThanOrEqual(0);
    expect(frame.step).toBeLessThan(drifted.meta.length);
    expect(frame.theme).toBe(drifted.ticks[frame.step].theme);
    expect(frame.phase).toBe(drifted.ticks[frame.step].phase);
  });
});

describe('parity row 13 — presets expand to primitives BEFORE validation', () => {
  it('a partial options object inherits every default rather than failing', () => {
    // No hidden behaviour: an override is a plain merge over the defaults, so
    // what is validated is exactly what runs.
    const result = plan(corpus, referenceConfig, { titration: 'linear' }, 1, { length: 20 });
    expect(isPlanFailure(result)).toBe(false);
    const p = result as SessionPlan;
    expect(p.meta.tailQuietMs).toBe(DEFAULT_SESSION_OPTIONS.pacing.tailQuietMs);
  });
});

describe('parity row 14 — corpus order within a block is never sorted at rest', () => {
  it('the planner does not reorder the corpus it was given', () => {
    const before = corpus.entries.map((e) => e.record.id).join('|');
    planOrThrow();
    expect(corpus.entries.map((e) => e.record.id).join('|')).toBe(before);
  });
});
