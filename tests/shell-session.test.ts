/**
 * M7 — the integration the whole module exists to perform.
 *
 *   D1  Configure -> Play -> a full 20-minute session completes unattended with
 *       no console errors.
 *   D2  `session:dump` renders a plan to readable text, and a reviewer reading
 *       it confirms the arc: gentle open, build, peak, wean, wake.
 *
 * D1 IS RUN FOR REAL, not sampled. The session below is planned from the REAL
 * corpus at the real 20-minute duration (353 steps), then played frame by frame
 * from the threshold through the plan's quiet tail and fade to §6.6's ending —
 * ~76,000 frames at 16ms. What makes that affordable is that M4 injects its
 * clock and scheduler, so a full sitting runs in about a second of wall time and
 * every assertion lands on an exact frame rather than a tolerance around a wait.
 *
 * "No console errors" is asserted rather than assumed: `console.error` and
 * `console.warn` are captured for the duration of the run and required to be
 * empty. An unattended session that logs an error at minute eighteen is exactly
 * the defect D1 names, and it is invisible to a test that only checks the
 * ending.
 *
 * The React components are deliberately NOT rendered here. This repo runs its
 * suite in Node with no DOM (vitest.config.ts says so, and every other web/ test
 * follows it), and the shell's logic lives in pure functions that are tested
 * directly in `setup-feedback.test.ts`. What cannot be tested that way is the
 * lifecycle — plan, mount, play, end — and that is what this file drives, using
 * the same fakes M4's own tests use.
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Corpus } from '../engine/types/record.ts';
import type { SessionPlan } from '../engine/types/plan.ts';
import type { UserConfig } from '../engine/types/config.ts';
import { isLoadFailure, loadCorpus } from '../engine/corpus/load.ts';
import { isPlanFailure, plan } from '../engine/plan/plan.ts';
import { mountSession } from '../web/session/mountSession.ts';

import { buildFeedback } from '../web/setup/SetupScreen.tsx';
import { sampleTicks } from '../web/setup/LiveSample.tsx';
import { defaultConfig } from '../web/persist/config.ts';
import { personDeciles, renderDump, sparkline, themeRuns, parseArgs } from '../tools/session/dump.ts';

import { FakeElement, FakeFrameDriver, FakeKeyTarget, FakeVisibility, fakeDocument } from './session-dom.ts';

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) as unknown;

function loadRealCorpus(): Corpus {
  const result = loadCorpus(
    read('corpus/pool.json'),
    read('corpus/persons.json'),
    read('corpus/provenance.json'),
  );
  if (isLoadFailure(result)) throw new Error('the real corpus failed to load');
  return result;
}

const corpus = loadRealCorpus();

/** The config a first-run user gets, which is what D1 should be able to play. */
const config: UserConfig = defaultConfig();

function planOrThrow(cfg: UserConfig = config, seed = 47): SessionPlan {
  const result = plan(corpus, cfg, {}, seed);
  if (isPlanFailure(result)) {
    throw new Error(`the default config did not plan: ${result.map((e) => e.message).join('; ')}`);
  }
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('D1 — Configure to Play, a full 20-minute session, unattended', () => {
  it('the first-run config plans a real 20-minute session', () => {
    const feedback = buildFeedback({ corpus, config, seed: 47 });

    expect(feedback.refusal).toBeNull();
    expect(feedback.planErrors).toEqual([]);
    expect(feedback.canStart).toBe(true);
    expect(feedback.plan).not.toBeNull();

    const { meta } = feedback.plan!;
    expect(meta.length).toBe(353);
    // A12: zero lane starvation on a config the app itself hands a new user.
    expect(feedback.diagnostics.filter((d) => d.kind === 'lane-starved')).toEqual([]);
    // Twenty minutes of content, plus the quiet tail and the closing fade.
    expect(meta.totalMs).toBeGreaterThan(19 * 60_000);
    expect(meta.totalMs).toBe(meta.contentMs + meta.tailQuietMs + meta.tailFadeMs);
  });

  it('the live sample is drawn from the plan Begin will actually hand to Play', () => {
    // The seam D3 exists to close: the sample and the session must be the same
    // object, not two plans that happen to share a seed.
    const feedback = buildFeedback({ corpus, config, seed: 47 });
    const samples = sampleTicks(feedback.sampleTicks);

    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      expect(feedback.plan!.ticks[sample.step]).toBe(sample);
      // The centre is always second person — the anchor never titrates (§4.6).
      expect(sample.center.person).toBe('second');
    }
  });

  it('plays the whole session to its ending with no console errors', () => {
    const sessionPlan = planOrThrow();

    // Captured for the WHOLE run: an error at minute eighteen is the defect D1
    // names, and it is invisible to a test that only inspects the ending.
    const errors: unknown[][] = [];
    const warnings: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });

    const driver = new FakeFrameDriver();
    const doc = fakeDocument();
    const root = new FakeElement('div');
    let ends = 0;
    // WHEN the ending fired, on the fake clock. Without this the test passes for
    // a session that ended after thirty seconds — `onEnd` firing at all is a
    // much weaker claim than the twenty-minute one D1 makes.
    let endedAtMs = -1;
    const progress: number[] = [];
    const bed = { starts: 0, stops: 0 };

    const handle = mountSession(
      root as unknown as HTMLElement,
      sessionPlan,
      {
        onEnd: () => {
          ends += 1;
          endedAtMs = driver.time;
        },
        onProgress: (p) => progress.push(p),
      },
      {
        now: driver.now,
        scheduler: driver.scheduler,
        visibility: new FakeVisibility(),
        documentRef: doc,
        keyTarget: new FakeKeyTarget(),
        reducedMotion: false,
        bed: {
          start: () => {
            bed.starts += 1;
          },
          stop: () => {
            bed.stops += 1;
          },
          setGain: () => {},
        },
      },
    );

    // The threshold, the whole plan, and generous headroom for §6.6's exit.
    const budgetMs = sessionPlan.meta.totalMs + 30_000;
    driver.run(budgetMs, 16);

    expect(ends, 'the session never reached its ending').toBe(1);
    expect(errors, `console.error during the session: ${JSON.stringify(errors)}`).toEqual([]);
    expect(warnings, `console.warn during the session: ${JSON.stringify(warnings)}`).toEqual([]);

    // THE TWENTY MINUTES, asserted as a duration rather than as an event. The
    // ending must land after the whole plan has played — content, quiet tail and
    // fade — and not materially later.
    expect(endedAtMs).toBeGreaterThanOrEqual(sessionPlan.meta.totalMs);
    expect(endedAtMs).toBeLessThan(sessionPlan.meta.totalMs + 30_000);
    expect(endedAtMs).toBeGreaterThan(20 * 60_000);

    // It really did play: progress swept the whole arc, once, at ~60fps for the
    // full duration rather than in a burst.
    expect(progress.length).toBeGreaterThan(sessionPlan.meta.totalMs / 16 - 1000);
    expect(progress[0]).toBeLessThan(0.01);
    expect(Math.max(...progress)).toBeCloseTo(1, 5);
    // Monotone: progress never goes backwards, so the plan was played once
    // through rather than restarted.
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }

    // The bed started on the gesture and was stopped by the ending, once each —
    // a tone still playing over a black screen is the failure (§6.6).
    expect(bed.starts).toBe(1);
    expect(bed.stops).toBeGreaterThanOrEqual(1);

    handle.dispose();
    expect(ends, 'dispose after the ending fired onEnd a second time').toBe(1);
  });

  it('unison plays to its ending too — both modes are tested paths, not one and a hedge', () => {
    const unison = planOrThrow({ ...config, mode: 'unison' }, 11);

    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    const driver = new FakeFrameDriver();
    let ends = 0;

    mountSession(
      new FakeElement('div') as unknown as HTMLElement,
      unison,
      {
        onEnd: () => {
          ends += 1;
        },
        onProgress: () => {},
      },
      {
        now: driver.now,
        scheduler: driver.scheduler,
        visibility: new FakeVisibility(),
        documentRef: fakeDocument(),
        keyTarget: new FakeKeyTarget(),
        reducedMotion: false,
      },
    );

    driver.run(unison.meta.totalMs + 30_000, 16);
    expect(ends).toBe(1);
    expect(errors).toEqual([]);
  });

  it('a session with no field and no bed still runs — the shell degrades, it does not fail', () => {
    // §6.7: audio unavailable is silence with an explanation, never a broken
    // session. `PlayRoute` passes both through as optional for this reason.
    const sessionPlan = planOrThrow(config, 3);
    const driver = new FakeFrameDriver();
    let ends = 0;

    mountSession(
      new FakeElement('div') as unknown as HTMLElement,
      sessionPlan,
      {
        onEnd: () => {
          ends += 1;
        },
        onProgress: () => {},
      },
      {
        now: driver.now,
        scheduler: driver.scheduler,
        visibility: new FakeVisibility(),
        documentRef: fakeDocument(),
        keyTarget: new FakeKeyTarget(),
        reducedMotion: true,
      },
    );

    driver.run(sessionPlan.meta.totalMs + 30_000, 16);
    expect(ends).toBe(1);
  });
});

describe('D2 — session:dump renders a readable transcript showing the arc', () => {
  const sessionPlan = planOrThrow(config, 47);
  const dump = renderDump(sessionPlan, config);

  it('names the five stages a reviewer is asked to confirm', () => {
    for (const stage of ['open', 'build', 'peak', 'wean', 'wake']) {
      expect(dump).toContain(stage);
    }
  });

  it('shows the session shape: phases, arc traces, drift and the theme walk', () => {
    expect(dump).toContain('SESSION');
    expect(dump).toContain('PHASES');
    expect(dump).toContain('ARC');
    expect(dump).toContain('PERSON DRIFT');
    expect(dump).toContain('THEME WALK');
    expect(dump).toContain('DIAGNOSTICS');
  });

  it('substitutes the user’s names — an unsubstituted dump reviews a session no one sees', () => {
    expect(dump).toContain(config.names.subject);
    expect(dump).not.toContain('{subject}');
    expect(dump).not.toContain('{operator}');
  });

  it('opens on induction and closes on emergence — the "wide awake at line 2" regression', () => {
    const runs = themeRuns(sessionPlan.ticks);
    expect(runs[0].theme).toBe('induction');
    expect(runs[runs.length - 1].theme).toBe('emergence');
  });

  it('the intensity trace is unimodal — it rises once and falls once (A4)', () => {
    const intensities = sessionPlan.ticks.map((t) => t.intensity);
    const peak = intensities.indexOf(Math.max(...intensities));
    for (let i = 1; i <= peak; i += 1) {
      expect(intensities[i]).toBeGreaterThanOrEqual(intensities[i - 1]);
    }
    for (let i = peak + 1; i < intensities.length; i += 1) {
      expect(intensities[i]).toBeLessThanOrEqual(intensities[i - 1]);
    }
  });

  it('the person drift goes out AND comes back (A9)', () => {
    const { named } = personDeciles(sessionPlan.ticks);
    // The return is asserted, not merely permitted: a session that leaves you
    // dissociated is one you resent afterward (§4.6).
    expect(named[0]).toBeLessThan(0.35);
    expect(Math.max(...named.slice(4, 7))).toBeGreaterThan(0.55);
    expect(named[9]).toBeLessThan(Math.max(...named.slice(4, 7)));
  });

  it('reports diagnostics alongside rather than folded into the transcript', () => {
    expect(dump).toContain('DIAGNOSTICS');
    expect(dump).toContain('none — the plan degraded nowhere.');
  });

  it('--full prints every step, and the summary does not', () => {
    const full = renderDump(sessionPlan, config, { full: true });
    expect(full).toContain('TRANSCRIPT');
    expect(full.split('\n').length).toBeGreaterThan(sessionPlan.meta.length * 4);
    expect(dump.split('\n').length).toBeLessThan(full.split('\n').length);
  });

  it('a sparkline shows shape rather than absolute level', () => {
    // Self-normalizing: a bell between 0.3 and 0.7 must not render flat.
    const bell = [0.3, 0.4, 0.55, 0.7, 0.55, 0.4, 0.3];
    const line = sparkline(bell, 7);
    expect(new Set(line).size).toBeGreaterThan(1);
    expect(sparkline([0.5, 0.5, 0.5], 3)).toBe('   ');
  });
});

describe('session:dump argument handling', () => {
  it('parses the documented invocation', () => {
    const args = parseArgs(['--config', 'fixtures/config.reference.json', '--seed', '47']);
    expect(args.configPath).toBe('fixtures/config.reference.json');
    expect(args.seed).toBe(47);
    expect(args.full).toBe(false);
  });

  it('rejects an unknown flag rather than ignoring it', () => {
    // A typo'd `--seeed` that silently dumped seed 0 would have a reviewer sign
    // off on the wrong session.
    expect(() => parseArgs(['--seeed', '47'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--seed', 'forty-seven'])).toThrow(/needs a number/);
    expect(() => parseArgs(['--length', '0'])).toThrow(/positive integer/);
  });
});
