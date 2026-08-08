/**
 * M1 acceptance: the five hand-authored fixtures.
 *
 *   "All five fixtures are hand-authored and committed. plan.reference.json and
 *    frame.reference.json are specifications, NOT generated output — this is
 *    what decouples M2 from M4."
 *
 * These tests are the fixtures' contract with the modules that consume them. M2
 * must reproduce `plan.reference.json`; M4 must render `frame.reference.json`.
 * If either file were quietly regenerated from an implementation, the
 * decoupling it exists to provide would be gone and nobody would notice — so
 * every rule the fixtures claim to demonstrate is asserted here, against the
 * files themselves, with no engine in the loop.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLoadFailure, loadCorpus } from '../engine/corpus/load.ts';
import { LANE_IDS, CHANNEL_COUNT } from '../engine/types/frame.ts';
import type { FrameState, LaneId } from '../engine/types/frame.ts';
import type { SessionPlan, TripletTick } from '../engine/types/plan.ts';
import type { UserConfig } from '../engine/types/config.ts';
import type { Corpus } from '../engine/types/record.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(repoRoot, 'fixtures');
const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as unknown;

const FIXTURES = [
  'corpus.mini.json',
  'persons.mini.json',
  'config.reference.json',
  'plan.reference.json',
  'frame.reference.json',
];

describe('all five fixtures exist and are committed', () => {
  it.each(FIXTURES)('fixtures/%s', (name) => {
    expect(existsSync(path.join(fixtureDir, name))).toBe(true);
  });

  it.each(FIXTURES)('fixtures/%s documents itself as hand-authored', (name) => {
    // The `_comment` block is not decoration. Judge 2's catch was a reference
    // fixture defined as the output of the function it constrains; the comment
    // is where each file states what it is and what a consumer must match.
    const raw = readFileSync(path.join(fixtureDir, name), 'utf8');
    expect(raw).toMatch(/HAND-AUTHORED/);
  });
});

describe('corpus.mini.json + persons.mini.json', () => {
  const result = loadCorpus(readFixture('corpus.mini.json'), readFixture('persons.mini.json'));

  it('loads with zero errors', () => {
    if (isLoadFailure(result)) {
      throw new Error(`mini fixtures failed to load: ${JSON.stringify(result, null, 2)}`);
    }
    expect(isLoadFailure(result)).toBe(false);
  });

  const corpus = result as Corpus;

  it('holds ~40 records', () => {
    expect(corpus.entries.length).toBeGreaterThanOrEqual(40);
    expect(corpus.entries.length).toBeLessThanOrEqual(60);
  });

  it('covers all four stances', () => {
    expect(new Set(corpus.entries.map((e) => e.pov)).size).toBe(4);
  });

  it('has records the center lane can serve — the corpus that made this necessary had none', () => {
    const second = corpus.entries.filter((e) => e.pov === 'second');
    expect(second.length).toBeGreaterThanOrEqual(8);
  });

  it('every record has a usable `second` variant, whatever its own stance', () => {
    // R9: the center is a 2nd-person anchor and it must never starve. Every
    // record carries all three variants, so any record can serve the center.
    for (const entry of corpus.entries) {
      expect(entry.persons.second.length, entry.record.id).toBeGreaterThan(0);
    }
  });
});

describe('config.reference.json', () => {
  const config = readFixture('config.reference.json') as UserConfig;

  it('is 4 themes, no exclusions, controller on, 20 min, parallel', () => {
    expect(config.themes).toHaveLength(4);
    expect(config.excludedThemes).toEqual([]);
    expect(config.allowController).toBe(true);
    expect(config.targetDurationMs).toBe(20 * 60 * 1000);
    expect(config.mode).toBe('parallel');
  });

  it('carries no intensity ceiling in any spelling', () => {
    // The ceiling ordered records by `base_points`, which MEASURED reproduced
    // the batch filename on 2,461/2,461 generated records: a user who set a cap
    // was protected by a filename. Exclusion is the whole consent surface now,
    // and a fixture that grows the field back would resurrect the defect
    // silently, since a config reader ignores keys it does not know.
    expect(config).not.toHaveProperty('intensityCap');
    for (const key of Object.keys(config)) {
      expect(key.toLowerCase()).not.toContain('intensity');
      expect(key.toLowerCase()).not.toContain('tier');
    }
  });

  it('enrolls no bookend theme — they are removed from the titration pool entirely', () => {
    // §4.2. Enrolling `emergence` here would make "You stand up rested and
    // present" reachable at step 2, which is the exact measured artifact the
    // bookend mechanism exists to prevent and that every rater caught.
    expect(config.themes).not.toContain('induction');
    expect(config.themes).not.toContain('emergence');
  });

  it('is servable by corpus.mini.json', () => {
    const corpus = loadCorpus(
      readFixture('corpus.mini.json'),
      readFixture('persons.mini.json'),
    ) as Corpus;
    for (const theme of config.themes) {
      expect(corpus.byTheme[theme], `${theme} is enrolled but absent from corpus.mini`).toBeDefined();
      expect(corpus.byTheme[theme].length, theme).toBeGreaterThanOrEqual(CHANNEL_COUNT);
    }
  });

  it('keeps the blocklist empty so `blocklist-relaxed` never fires here', () => {
    expect(config.blocklist).toEqual([]);
    expect(config.excludedThemes).toEqual([]);
  });

  it('has no theme both enrolled and excluded', () => {
    for (const theme of config.themes) expect(config.excludedThemes).not.toContain(theme);
  });
});

describe('plan.reference.json is a SPECIFICATION M2 must reproduce', () => {
  const plan = readFixture('plan.reference.json') as SessionPlan;
  const ticks = plan.ticks;

  it('is a hypnoapp.plan.v1 built from seed 47', () => {
    expect(plan.meta.schema).toBe('hypnoapp.plan.v1');
    expect(plan.meta.seed).toBe(47);
  });

  it('A2 bookend arithmetic: head + middle + tail === length', () => {
    expect(plan.meta.head + plan.meta.middle + plan.meta.tail).toBe(plan.meta.length);
    expect(ticks).toHaveLength(plan.meta.length);
  });

  it('numbers its steps 0..length-1 with no gaps', () => {
    expect(ticks.map((t) => t.step)).toEqual(ticks.map((_, i) => i));
  });

  it('labels phases consistently with the bookend counts', () => {
    for (const tick of ticks) {
      const expected =
        tick.step < plan.meta.head
          ? 'head'
          : tick.step >= plan.meta.length - plan.meta.tail
            ? 'tail'
            : 'middle';
      expect(tick.phase, `step ${tick.step}`).toBe(expected);
    }
  });

  it('A3 directionality: no emergence in the first half, no induction in the second', () => {
    // "The Wide awake at line 2 regression test." Intensity is a scalar and
    // session position is a direction; a symmetric bell alone cannot express it.
    const half = ticks.length / 2;
    for (const tick of ticks) {
      if (tick.step < half) expect(tick.theme, `step ${tick.step}`).not.toBe('emergence');
      if (tick.step >= half) expect(tick.theme, `step ${tick.step}`).not.toBe('induction');
    }
  });

  it('keeps bookend themes out of the titrating middle entirely', () => {
    for (const tick of ticks) {
      if (tick.phase !== 'middle') continue;
      expect(['induction', 'emergence']).not.toContain(tick.theme);
    }
  });

  it('A4 gaussian arc: the middle s intensity trace is unimodal', () => {
    // The curve survives the deletion of the tier ladder it used to be rounded
    // onto. Asserting it on the raw value is strictly sharper: rounding to five
    // rungs hid every non-monotone wobble smaller than a band.
    const trace = ticks.filter((t) => t.phase === 'middle').map((t) => t.intensity);

    const peak = trace.indexOf(Math.max(...trace));
    for (let i = 0; i < peak; i += 1) expect(trace[i]).toBeLessThanOrEqual(trace[i + 1]);
    for (let i = peak; i < trace.length - 1; i += 1) {
      expect(trace[i]).toBeGreaterThanOrEqual(trace[i + 1]);
    }
  });

  it('reaches its peak in the middle and comes back down', () => {
    const middle = ticks.filter((t) => t.phase === 'middle').map((t) => t.intensity);
    const peak = Math.max(...middle);
    expect(peak).toBeGreaterThan(0.9);
    expect(middle[0]).toBeLessThan(peak);
    expect(middle[middle.length - 1]).toBeLessThan(peak);
  });

  it('A5 triplet distinctness: three different mantraIds in every tick', () => {
    expect(plan.meta.mode).toBe('parallel');
    for (const tick of ticks) {
      const ids = new Set([tick.center.mantraId, tick.left.mantraId, tick.right.mantraId]);
      expect(ids.size, `step ${tick.step}`).toBe(CHANNEL_COUNT);
    }
  });

  it('A9 the center is `second` in 100% of ticks and never titrates in person', () => {
    for (const tick of ticks) expect(tick.center.person, `step ${tick.step}`).toBe('second');
  });

  it('A9 the sides drift toward `named` and RETURN to `first`', () => {
    // Non-monotone by design. The return is the point: a session that leaves you
    // dissociated is one you resent afterward, and the drift out is what makes
    // the drift in safe to accept. Asserted in both directions, not permitted.
    const namedShare = (from: number, to: number) => {
      const window = ticks.slice(from, to);
      const named = window.filter(
        (t) => t.left.person === 'named' || t.right.person === 'named',
      ).length;
      return named / window.length;
    };

    const third = Math.floor(ticks.length / 3);
    expect(namedShare(0, third)).toBeLessThan(0.5);
    expect(namedShare(third, 2 * third)).toBeGreaterThan(0.5);
    expect(namedShare(2 * third, ticks.length)).toBeLessThan(0.5);
  });

  it('opens and closes with both sides in `first`', () => {
    for (const tick of [ticks[0], ticks[ticks.length - 1]]) {
      expect(tick.left.person).toBe('first');
      expect(tick.right.person).toBe('first');
    }
  });

  it('A13 one theme is shared across all three lanes at every step', () => {
    for (const tick of ticks) {
      expect(typeof tick.theme).toBe('string');
      expect(tick.theme.length).toBeGreaterThan(0);
    }
  });

  it('A13 the theme walk HOLDS rather than redrawing per step', () => {
    // A theme that changes every 3.4 seconds is a shuffle, not an arc.
    const middle = ticks.filter((t) => t.phase === 'middle');
    let runStart = 0;
    const runs: number[] = [];
    for (let i = 1; i <= middle.length; i += 1) {
      if (i === middle.length || middle[i].theme !== middle[runStart].theme) {
        runs.push(i - runStart);
        runStart = i;
      }
    }
    for (const run of runs) expect(run).toBeGreaterThanOrEqual(4);
  });

  it('carries a normalized intensity on every tick', () => {
    for (const tick of ticks) {
      expect(Number.isFinite(tick.intensity), `step ${tick.step}`).toBe(true);
      expect(tick.intensity).toBeGreaterThanOrEqual(0);
      expect(tick.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('§4.9 dwell varies and stays inside the pacing band', () => {
    const dwells = ticks.map((t) => t.dwellMs);
    expect(new Set(dwells).size).toBeGreaterThan(1);
    for (const dwell of dwells) {
      expect(dwell).toBeGreaterThanOrEqual(2900);
      expect(dwell).toBeLessThanOrEqual(4200);
    }
  });

  it('R19 the pacing peak does NOT coincide with the intensity peak', () => {
    // With a shared curve, fastest pacing, the intensity peak and the highest
    // third-person share all land at the same instant — which is where a
    // session tips from absorbing to overwhelming. The dwell bell is offset
    // later on purpose, so the tightest pacing arrives AFTER the curve's peak,
    // on the near side of the wean.
    const tightest = ticks.reduce((a, b) => (b.dwellMs < a.dwellMs ? b : a));
    const deepest = ticks.reduce((a, b) => (b.intensity > a.intensity ? b : a));
    expect(tightest.step).toBeGreaterThan(deepest.step);
  });

  it('§5.2 center splits LINE, sides split WORD', () => {
    for (const tick of ticks) {
      expect(tick.center.split).toBe('LINE');
      expect(tick.left.split).toBe('WORD');
      expect(tick.right.split).toBe('WORD');
    }
  });

  it('§4.9 sides lead and the center arrives last', () => {
    const { right, left, center } = plan.meta.laneOffsetsMs;
    expect(right).toBe(0);
    expect(left).toBe(500);
    expect(center).toBe(1000);
    expect(center).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(right);
  });

  it('pins laneDrift to 1.0 so a byte-comparison tests the planner, not the jitter', () => {
    for (const lane of LANE_IDS) expect(plan.meta.laneDrift[lane]).toBe(1);
  });

  it('§4.9 totalMs is the content plus the quiet tail and the fade', () => {
    const content = ticks.reduce((sum, t) => sum + t.dwellMs, 0);
    expect(plan.meta.contentMs).toBe(content);
    expect(plan.meta.totalMs).toBe(content + plan.meta.tailQuietMs + plan.meta.tailFadeMs);
    expect(plan.meta.tailQuietMs).toBe(2500);
    expect(plan.meta.tailFadeMs).toBe(1500);
  });

  it('A12 carries zero diagnostics — every block clears the T1 ship floor', () => {
    // An empty array is an assertion, not a gap: no widening fired and no lane
    // starved on the reference config.
    expect(plan.diagnostics).toEqual([]);
  });

  it('carries a bed the plan does not vary', () => {
    expect(plan.bed.preset).toBe('drone');
    expect(typeof plan.bed.gainDb).toBe('number');
  });

  it('references only mantras that exist in corpus.mini.json', () => {
    const corpus = loadCorpus(
      readFixture('corpus.mini.json'),
      readFixture('persons.mini.json'),
    ) as Corpus;

    for (const tick of ticks) {
      for (const lane of ['center', 'left', 'right'] as const) {
        const content = tick[lane];
        const index = corpus.byId[content.mantraId];
        expect(index, `step ${tick.step} ${lane}: unknown id ${content.mantraId}`).toBeDefined();

        const entry = corpus.entries[index];
        // `text` is the RAW TEMPLATE for that lane's person, straight from the
        // sidecar. If it were substituted here, a rename could not re-render
        // content already in flight.
        expect(content.text, `step ${tick.step} ${lane}`).toBe(entry.persons[content.person]);
        expect(entry.record.themes, `step ${tick.step} ${lane}`).toContain(tick.theme);
      }
    }
  });

  it('leaves placeholders unsubstituted — substitution is a display-time act', () => {
    const withPlaceholders = ticks.filter((t) =>
      [t.center.text, t.left.text, t.right.text].some((s) => s.includes('{')),
    );
    expect(withPlaceholders.length).toBeGreaterThan(0);
    for (const tick of withPlaceholders) {
      for (const lane of ['center', 'left', 'right'] as const) {
        expect(tick[lane].text).not.toContain(plan.meta.subjectName);
      }
    }
  });

  it('is a plain serializable value with no functions or cycles', () => {
    const round = JSON.parse(JSON.stringify(plan)) as SessionPlan;
    expect(round).toEqual(plan);
  });
});

describe('frame.reference.json is a SPECIFICATION M4 can render before M2 exists', () => {
  const file = readFixture('frame.reference.json') as {
    frames: Array<FrameState & { label: string }>;
  };
  const frames = file.frames;
  const plan = readFixture('plan.reference.json') as SessionPlan;

  it('carries three samples: mid-head, mid-peak, mid-tail', () => {
    expect(frames.map((f) => f.label)).toEqual(['mid-head', 'mid-peak', 'mid-tail']);
  });

  it('every frame carries all three lanes, keyed by lane', () => {
    // The SHAPE of FrameState is constant; the `.active` gate is what varies.
    // An inactive lane is present and painting nothing, not absent — otherwise
    // a renderer has to handle two different frame shapes.
    for (const frame of frames) {
      expect(Object.keys(frame.channels).sort()).toEqual([...LANE_IDS].sort());
      for (const lane of LANE_IDS) expect(frame.channels[lane].lane).toBe(lane);
    }
  });

  it('elapsedMs, step and phase agree with plan.reference.json', () => {
    const starts: number[] = [];
    let acc = 0;
    for (const tick of plan.ticks) {
      starts.push(acc);
      acc += tick.dwellMs;
    }

    for (const frame of frames) {
      const tick = plan.ticks[frame.step];
      expect(tick, frame.label).toBeDefined();
      expect(frame.phase, frame.label).toBe(tick.phase);
      expect(frame.theme, frame.label).toBe(tick.theme);
      // The sample really is mid-dwell for its step.
      expect(frame.elapsedMs, frame.label).toBeGreaterThanOrEqual(starts[frame.step]);
      expect(frame.elapsedMs, frame.label).toBeLessThan(starts[frame.step] + tick.dwellMs);
    }
  });

  it('samples one frame from each phase', () => {
    expect(frames.map((f) => f.phase)).toEqual(['head', 'middle', 'tail']);
  });

  it('C1 the center is unambiguously dominant wherever the sides are showing', () => {
    for (const frame of frames) {
      const center = frame.channels.center;
      expect(center.active, frame.label).toBe(true);
      expect(center.scale, frame.label).toBe(1);
      expect(center.alpha, frame.label).toBe(1);
      expect(center.blur, frame.label).toBe(0);

      for (const lane of ['left', 'right'] as LaneId[]) {
        const side = frame.channels[lane];
        expect(side.scale, `${frame.label} ${lane}`).toBe(0.55);
        expect(side.split, `${frame.label} ${lane}`).toBe('WORD');
        if (side.active) {
          // Three full-alpha layers just show whichever drew last. The
          // stratification is what makes the stack legible.
          expect(side.alpha, `${frame.label} ${lane}`).toBe(0.3);
          expect(side.blur, `${frame.label} ${lane}`).toBeGreaterThan(0);
        }
      }
      expect(center.split, frame.label).toBe('LINE');
    }
  });

  it('the sides arrive at head->middle and leave at middle->tail', () => {
    // Opening on three lanes is overwhelming; closing on three is jarring. The
    // center is the thread held the whole way.
    const byLabel = Object.fromEntries(frames.map((f) => [f.label, f]));
    for (const label of ['mid-head', 'mid-tail']) {
      expect(byLabel[label].channels.left.active, label).toBe(false);
      expect(byLabel[label].channels.right.active, label).toBe(false);
    }
    expect(byLabel['mid-peak'].channels.left.active).toBe(true);
    expect(byLabel['mid-peak'].channels.right.active).toBe(true);
  });

  it('an inactive lane paints nothing at all — the `.active` gate, not a zero alpha', () => {
    for (const frame of frames) {
      for (const lane of LANE_IDS) {
        const channel = frame.channels[lane];
        if (channel.active) continue;
        expect(channel.text, `${frame.label} ${lane}`).toBe('');
        expect(channel.alpha, `${frame.label} ${lane}`).toBe(0);
        expect(channel.mantraId, `${frame.label} ${lane}`).toBe('');
      }
    }
  });

  it('carries SUBSTITUTED text beside its raw template', () => {
    const config = readFixture('config.reference.json') as UserConfig;
    for (const frame of frames) {
      for (const lane of LANE_IDS) {
        const channel = frame.channels[lane];
        if (!channel.active) continue;
        // This is what gets painted, so it must have no placeholders left.
        expect(channel.text, `${frame.label} ${lane}`).not.toMatch(/\{(subject|controller)\}/);
        expect(channel.template.length, `${frame.label} ${lane}`).toBeGreaterThan(0);
      }
    }

    // At least one frame proves substitution actually happened rather than the
    // fixture only ever using placeholder-free lines.
    const substituted = frames.some((f) =>
      LANE_IDS.some(
        (lane) =>
          f.channels[lane].active &&
          f.channels[lane].template.includes('{controller}') &&
          f.channels[lane].text.includes(config.names.controller),
      ),
    );
    expect(substituted).toBe(true);
  });

  it('a WORD lane shows one token while the LINE centre shows a whole phrase', () => {
    const peak = frames.find((f) => f.label === 'mid-peak')!;
    for (const lane of ['left', 'right'] as LaneId[]) {
      expect(peak.channels[lane].text.trim().split(/\s+/)).toHaveLength(1);
    }
    expect(peak.channels.center.text.trim().split(/\s+/).length).toBeGreaterThan(1);
  });

  it('every active lane names a real mantra from the plan s tick', () => {
    for (const frame of frames) {
      const tick: TripletTick = plan.ticks[frame.step];
      for (const lane of LANE_IDS) {
        const channel = frame.channels[lane];
        if (!channel.active) continue;
        expect(channel.mantraId, `${frame.label} ${lane}`).toBe(tick[lane].mantraId);
        expect(channel.template, `${frame.label} ${lane}`).toBe(tick[lane].text);
      }
    }
  });

  it('progress is monotone, clamped to [0,1], and tracks elapsedMs', () => {
    for (let i = 0; i < frames.length; i += 1) {
      expect(frames[i].progress).toBeGreaterThanOrEqual(0);
      expect(frames[i].progress).toBeLessThanOrEqual(1);
      if (i > 0) {
        expect(frames[i].progress).toBeGreaterThan(frames[i - 1].progress);
        expect(frames[i].elapsedMs).toBeGreaterThan(frames[i - 1].elapsedMs);
      }
    }
  });

  it('C9 the bed never exceeds the ~3Hz ceiling', () => {
    // No strobing, ever. The backdrop derives its transition rate from this, so
    // a bed above the ceiling would take the visuals with it.
    for (const frame of frames) {
      expect(frame.bed.pulseHz, frame.label).toBeGreaterThan(0);
      expect(frame.bed.pulseHz, frame.label).toBeLessThanOrEqual(3);
    }
  });

  it('the bed is quieter at the bookends than at the peak', () => {
    const byLabel = Object.fromEntries(frames.map((f) => [f.label, f]));
    expect(byLabel['mid-peak'].bed.gainDb).toBeGreaterThan(byLabel['mid-head'].bed.gainDb);
    expect(byLabel['mid-peak'].bed.gainDb).toBeGreaterThan(byLabel['mid-tail'].bed.gainDb);
  });

  it('the threshold fade is still climbing at mid-head and settled by mid-peak', () => {
    const byLabel = Object.fromEntries(frames.map((f) => [f.label, f]));
    expect(byLabel['mid-head'].masterAlpha).toBeLessThan(1);
    expect(byLabel['mid-peak'].masterAlpha).toBe(1);
  });

  it('no frame claims the session has ended', () => {
    // Including mid-tail: there is still content, then 2500ms of quiet, then a
    // 1500ms fade to go. `ended` is not "we are near the end".
    for (const frame of frames) expect(frame.ended, frame.label).toBe(false);
  });

  it('is a plain serializable value', () => {
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });
});

describe('the fixtures are specifications, not generated output', () => {
  it('no build script that would regenerate them is committed', () => {
    // R8: a reference fixture defined as the output of the function it
    // constrains destroys the decoupling it exists to provide. If a generator
    // lands in fixtures/, the next person to "refresh" the fixtures deletes the
    // only independent check M2 and M4 have.
    for (const stray of ['build_plan_reference.py', 'generate.ts', 'build.ts', 'build.js']) {
      expect(existsSync(path.join(fixtureDir, stray)), stray).toBe(false);
    }
  });

  it('plan.reference.json states the length it is authored at', () => {
    const plan = readFixture('plan.reference.json') as SessionPlan;
    const raw = readFileSync(path.join(fixtureDir, 'plan.reference.json'), 'utf8');
    // A 353-tick file cannot be authored by hand; it can only be generated and
    // then labelled hand-authored. The override is stated in the file so M2
    // reads `meta.length` rather than deriving it from the config's duration.
    expect(raw).toMatch(/targetDurationMs/);
    expect(plan.meta.length).toBeGreaterThan(0);
    expect(plan.meta.length).toBeLessThan(60);
  });
});

describe('the shared vocabulary the fixtures are written in', () => {
  it('CHANNEL_COUNT is 3 and matches the lane list', () => {
    const count: 3 = CHANNEL_COUNT;
    expect(count).toBe(3);
    expect(LANE_IDS).toHaveLength(CHANNEL_COUNT);
  });

});
