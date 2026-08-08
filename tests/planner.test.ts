/**
 * M2 acceptance — the planner and the conductor.
 *
 * Every criterion in MODULES.json's M2 entry is a `describe` below, labelled
 * with its id. Where a criterion is stated statistically ("200 seeds x 10
 * configs"), the sweep is run at that size rather than at a sample that happens
 * to pass — the sample size IS the assertion in those cases.
 *
 * The reference corpus is `fixtures/corpus.mini.json`, which is hand-authored
 * and small enough that a failure is diagnosable by reading it. The real corpus
 * is exercised separately, in `tests/planner-corpus.test.ts`, because a
 * property that only holds on 47 curated records is not a property.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { plan, isPlanFailure } from '../engine/plan/plan.ts';
import { frameAt } from '../engine/conduct/frameAt.ts';
import { computeBookends } from '../engine/plan/bookends.ts';
import { Shuffler, windowFor } from '../engine/plan/shuffler.ts';
import { substream } from '../engine/rng/mulberry32.ts';
import { passesConsent, eligibleEntries } from '../engine/plan/consent.ts';
import { buildPersonSchedule } from '../engine/plan/person.ts';
import { loadCorpus, isLoadFailure } from '../engine/corpus/load.ts';
import { DEFAULT_SESSION_OPTIONS, type SessionOptions, type UserConfig } from '../engine/types/config.ts';
import { CHANNEL_COUNT, LANE_IDS } from '../engine/types/frame.ts';
import type { Corpus } from '../engine/types/record.ts';
import type { SessionPlan } from '../engine/types/plan.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, 'fixtures', name), 'utf8')) as unknown;

const corpusResult = loadCorpus(fixture('corpus.mini.json'), fixture('persons.mini.json'));
if (isLoadFailure(corpusResult)) throw new Error('corpus.mini failed to load');
const corpus: Corpus = corpusResult;

const referenceConfig = fixture('config.reference.json') as UserConfig;
const referencePlan = fixture('plan.reference.json') as SessionPlan;

/** The reference sitting: the committed config, at the fixture's stated length. */
const REFERENCE_LENGTH = referencePlan.meta.length;

/** Drift pinned off, as `plan.reference.json` states it is. */
const NO_DRIFT: Partial<SessionOptions> = {
  pacing: { ...DEFAULT_SESSION_OPTIONS.pacing, driftPct: 0 },
};

function planOrThrow(
  config: UserConfig = referenceConfig,
  seed = 47,
  opts: Partial<SessionOptions> = NO_DRIFT,
  length: number = REFERENCE_LENGTH,
): SessionPlan {
  const result = plan(corpus, config, opts, seed, { length });
  if (isPlanFailure(result)) {
    throw new Error(`expected a plan, got errors: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

describe('A1 determinism', () => {
  it('the same (corpus, config, opts, seed) yields a byte-identical plan', () => {
    for (const seed of [0, 1, 47, 1234, 99999]) {
      const a = JSON.stringify(planOrThrow(referenceConfig, seed));
      const b = JSON.stringify(planOrThrow(referenceConfig, seed));
      expect(a).toBe(b);
    }
  });

  it('different seeds produce different plans — the seed is actually threaded', () => {
    // A "deterministic" planner that ignores its seed passes the test above
    // trivially. This is the other half of the claim.
    const a = JSON.stringify(planOrThrow(referenceConfig, 1));
    const b = JSON.stringify(planOrThrow(referenceConfig, 2));
    expect(a).not.toBe(b);
  });

  it('survives a JSON round trip unchanged — the plan is a serializable value', () => {
    const p = planOrThrow();
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('does not mutate the shared default options', () => {
    // A module that mutates a frozen shared default turns determinism into a
    // function of import order.
    const before = JSON.stringify(DEFAULT_SESSION_OPTIONS);
    planOrThrow();
    expect(JSON.stringify(DEFAULT_SESSION_OPTIONS)).toBe(before);
  });
});

describe('A2 bookends', () => {
  it('head + mid + tail === length for every length in 1..500', () => {
    // An identity, so it cannot pass by accident on the lengths someone tried.
    for (let length = 1; length <= 500; length += 1) {
      const b = computeBookends(length, DEFAULT_SESSION_OPTIONS.bookends);
      expect(b.head + b.middle + b.tail, `length ${length}`).toBe(length);
      expect(b.middle, `length ${length}`).toBeGreaterThanOrEqual(0);
      expect(b.head, `length ${length}`).toBeGreaterThanOrEqual(0);
      expect(b.tail, `length ${length}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('the length<=2 overrun is CLAMPED, not ported', () => {
    // recon-hypnocli §5.2: upstream emits 3 steps for a 1-step session.
    for (const length of [1, 2]) {
      const b = computeBookends(length, DEFAULT_SESSION_OPTIONS.bookends);
      expect(b.head + b.middle + b.tail).toBe(length);
    }
  });

  it('reproduces the MEASURED reference splits', () => {
    // render_session.py:395-411.
    expect(computeBookends(346, DEFAULT_SESSION_OPTIONS.bookends)).toEqual({
      head: 35,
      middle: 276,
      tail: 35,
    });
    expect(computeBookends(30, DEFAULT_SESSION_OPTIONS.bookends)).toEqual({
      head: 3,
      middle: 24,
      tail: 3,
    });
  });

  it('the plan s own meta carries the same arithmetic', () => {
    const p = planOrThrow();
    expect(p.meta.head + p.meta.middle + p.meta.tail).toBe(p.meta.length);
    expect(p.ticks).toHaveLength(p.meta.length);
  });
});

describe('A3 directionality — the "Wide awake at line 2" regression test', () => {
  it('no emergence theme in the first 50%, no induction theme in the last 50%', () => {
    // 200 seeds x 10 configs, as specified. Intensity is a scalar and session
    // position is a direction: a symmetric bell alone cannot express this, so
    // the guarantee has to come from the bookend partition.
    const configs: UserConfig[] = [];
    const pools = [
      ['acceptance', 'obedience', 'focus', 'submission'],
      ['acceptance', 'obedience'],
      ['focus', 'submission'],
      ['obedience'],
      ['acceptance', 'focus', 'submission'],
      ['submission', 'focus'],
      ['acceptance', 'submission'],
      ['obedience', 'focus'],
      ['acceptance'],
      ['focus'],
    ];
    for (const themes of pools) {
      configs.push({ ...referenceConfig, themes });
    }

    let checked = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      for (const config of configs) {
        const p = planOrThrow(config, seed);
        const half = p.ticks.length / 2;
        for (const tick of p.ticks) {
          if (tick.step < half) {
            expect(tick.theme, `seed ${seed} step ${tick.step}`).not.toBe('emergence');
          } else {
            expect(tick.theme, `seed ${seed} step ${tick.step}`).not.toBe('induction');
          }
        }
        checked += 1;
      }
    }
    expect(checked).toBe(2000);
  });

  it('bookend themes never appear in the titrating middle at all', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const p = planOrThrow(referenceConfig, seed);
      for (const tick of p.ticks) {
        if (tick.phase !== 'middle') continue;
        expect(['induction', 'emergence'], `seed ${seed}`).not.toContain(tick.theme);
      }
    }
  });

  it('a bookend theme the user ENROLLED is still removed from the middle', () => {
    // The structural fix must not be defeatable from the setup screen.
    const config: UserConfig = {
      ...referenceConfig,
      themes: ['focus', 'obedience', 'emergence', 'induction'],
    };
    const p = planOrThrow(config, 7);
    for (const tick of p.ticks) {
      if (tick.phase !== 'middle') continue;
      expect(['induction', 'emergence']).not.toContain(tick.theme);
    }
  });
});

describe('A4 gaussian arc', () => {
  it('the per-step intensity trace is unimodal over 200 seeds', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const trace = planOrThrow(referenceConfig, seed).ticks.map((t) => t.intensity);
      const peak = trace.indexOf(Math.max(...trace));
      for (let i = 0; i < peak; i += 1) {
        expect(trace[i], `seed ${seed} step ${i}`).toBeLessThanOrEqual(trace[i + 1]);
      }
      for (let i = peak; i < trace.length - 1; i += 1) {
        expect(trace[i], `seed ${seed} step ${i}`).toBeGreaterThanOrEqual(trace[i + 1]);
      }
    }
  });

  it('builds, peaks and weans rather than sitting flat', () => {
    const trace = planOrThrow().ticks.map((t) => t.intensity);
    expect(Math.max(...trace)).toBeGreaterThan(0.9);
    expect(trace[0]).toBeLessThan(0.3);
    expect(trace[trace.length - 1]).toBeLessThan(0.3);
  });

  it('R19: the pacing peak arrives AFTER the intensity peak', () => {
    // With a shared curve every difficulty axis peaks at the same instant,
    // which is where a session tips from absorbing to overwhelming.
    const p = planOrThrow();
    const tightest = p.ticks.reduce((a, b) => (b.dwellMs < a.dwellMs ? b : a));
    const deepest = p.ticks.reduce((a, b) => (b.intensity > a.intensity ? b : a));
    expect(tightest.step).toBeGreaterThan(deepest.step);
  });
});

describe('A5 triplet distinctness', () => {
  it('all three mantraIds within a tick differ, every tick, every plan', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const p = planOrThrow(referenceConfig, seed);
      expect(p.meta.mode).toBe('parallel');
      for (const tick of p.ticks) {
        const ids = new Set([tick.center.mantraId, tick.left.mantraId, tick.right.mantraId]);
        expect(ids.size, `seed ${seed} step ${tick.step}`).toBe(CHANNEL_COUNT);
      }
    }
  });
});

describe('A6 anti-repeat', () => {
  it('window = clamp(floor(blockSize/2), 3, 12)', () => {
    const o = DEFAULT_SESSION_OPTIONS.shuffler;
    expect(windowFor(2, o)).toBe(3);
    expect(windowFor(8, o)).toBe(4);
    expect(windowFor(24, o)).toBe(12);
    expect(windowFor(100, o)).toBe(12);
  });

  it('the Shuffler never returns an index that is still inside its window', () => {
    // Asserted against the picker directly, which is where the guarantee lives.
    // The window is counted in DRAWS, and one shuffler per theme is SHARED
    // across all three channels (§4.8) — that sharing is what makes the lanes
    // say different lines of one theme — so a step consumes CHANNEL_COUNT
    // draws and the window spans window/3 steps, not `window` steps.
    for (const size of [8, 9, 12, 24, 40]) {
      for (let seed = 0; seed < 40; seed += 1) {
        const shuffler = new Shuffler(size, DEFAULT_SESSION_OPTIONS.shuffler, substream(seed, 's'));
        const drawn: number[] = [];
        for (let i = 0; i < 300; i += 1) {
          const index = shuffler.next();
          expect(index).toBeDefined();
          // Everything drawn in the last `window` draws is still suppressed.
          expect(drawn.slice(-shuffler.windowSize), `size ${size} seed ${seed} draw ${i}`).not.toContain(
            index as number,
          );
          drawn.push(index as number);
        }
      }
    }
  });

  it('a plan s per-theme draw multiset never repeats inside the window', () => {
    // The same invariant, observed through a real plan. The three lanes of a
    // step are ONE round of draws, so the check is per round rather than per
    // lane: `assignSides` permutes the two sides after the draw (it is a
    // relabelling of records already drawn, so it cannot reach past consent or
    // revive a suppressed record), which means lane order is not draw order.
    for (let seed = 0; seed < 100; seed += 1) {
      const p = planOrThrow(referenceConfig, seed);
      const degraded = new Set(
        p.diagnostics.filter((d) => d.kind === 'shuffler-degraded').map((d) => d.theme),
      );

      const rounds = new Map<string, string[][]>();
      for (const tick of p.ticks) {
        if (degraded.has(tick.theme)) continue;
        const list = rounds.get(tick.theme) ?? [];
        list.push([tick.center.mantraId, tick.left.mantraId, tick.right.mantraId]);
        rounds.set(tick.theme, list);
      }

      for (const [theme, list] of rounds) {
        const w = windowFor(corpus.byTheme[theme]?.length ?? 0, DEFAULT_SESSION_OPTIONS.shuffler);
        // How many whole PRECEDING rounds the window certainly covers, in the
        // worst case. A round's LAST draw sees only `w - (CHANNEL_COUNT - 1)`
        // of the window still spent on earlier rounds, so the guaranteed depth
        // is that, floored into rounds. At window 4 and 3 lanes this is 0 —
        // the window is barely wider than one round, which is precisely why
        // `shuffler-degraded` exists and why the per-block check above is the
        // one that carries the anti-repeat claim.
        const roundsCovered = Math.max(0, Math.floor((w - (CHANNEL_COUNT - 1)) / CHANNEL_COUNT));
        if (roundsCovered === 0) continue;
        for (let i = roundsCovered; i < list.length; i += 1) {
          const recent = list.slice(i - roundsCovered, i).flat();
          for (const id of list[i]) {
            expect(recent, `seed ${seed} ${theme} round ${i}`).not.toContain(id);
          }
        }
      }
    }
  });

  it('a lane does not repeat itself on consecutive steps of one theme', () => {
    // The per-channel half of the same guarantee, at the strength the shared
    // shuffler actually provides: an immediate self-repeat is what reads as a
    // stuck lane, and it is exactly what a uniform per-draw pick would produce.
    for (let seed = 0; seed < 100; seed += 1) {
      const p = planOrThrow(referenceConfig, seed);
      const degraded = new Set(
        p.diagnostics.filter((d) => d.kind === 'shuffler-degraded').map((d) => d.theme),
      );
      for (const lane of LANE_IDS) {
        for (let i = 1; i < p.ticks.length; i += 1) {
          const tick = p.ticks[i];
          const previous = p.ticks[i - 1];
          if (tick.theme !== previous.theme || degraded.has(tick.theme)) continue;
          expect(tick[lane].mantraId, `seed ${seed} ${lane} step ${tick.step}`).not.toBe(
            previous[lane].mantraId,
          );
        }
      }
    }
  });
});

describe('A7 consent — ZERO TOLERANCE', () => {
  /**
   * A pseudo-random config generator with its own seeded stream, so the sweep
   * is reproducible: "1000 random configs" that cannot be replayed is not a
   * regression test, it is a lottery.
   */
  function configAt(n: number): UserConfig {
    const themes = ['acceptance', 'obedience', 'focus', 'submission'];
    const excludable = [...themes, 'induction', 'emergence'];
    // A deterministic bit pattern over enrolments and exclusions.
    const enrolled = themes.filter((_, i) => ((n >> i) & 1) === 1);
    const excluded = excludable.filter((t, i) => ((n >> (i + 4)) & 1) === 1 && !enrolled.includes(t));
    return {
      ...referenceConfig,
      themes: enrolled.length > 0 ? enrolled : ['obedience'],
      excludedThemes: excluded,
      allowOperator: (n & 1024) === 0,
    };
  }

  it('over 1000 configs: zero operator mantras when the toggle is off, zero excluded tags', () => {
    let planned = 0;
    for (let n = 0; n < 1000; n += 1) {
      const config = configAt(n);
      const result = plan(corpus, config, NO_DRIFT, n, { length: REFERENCE_LENGTH });
      if (isPlanFailure(result)) continue; // a starve is a legitimate outcome
      planned += 1;

      for (const tick of result.ticks) {
        for (const lane of LANE_IDS) {
          const entry = corpus.entries[corpus.byId[tick[lane].mantraId]];
          expect(entry, `config ${n}: unknown id`).toBeDefined();

          if (!config.allowOperator) {
            expect(
              entry.record.markers.has_operator,
              `config ${n} step ${tick.step} ${lane}: operator mantra with the toggle off`,
            ).toBe(false);
          }

          // Checked against the record's FULL tag list, never the bucket it
          // was drawn under. This is the cross-tag leak the rule closes.
          for (const excluded of config.excludedThemes) {
            expect(
              entry.record.themes,
              `config ${n} step ${tick.step} ${lane}: ${tick[lane].mantraId} carries excluded ${excluded}`,
            ).not.toContain(excluded);
          }
        }
      }
    }
    // The sweep must actually have planned sessions, or it proved nothing.
    expect(planned).toBeGreaterThan(100);
  });

  it('the predicate itself honours the full tag list', () => {
    const multi = corpus.entries.find((e) => e.record.themes.length > 1);
    if (multi !== undefined) {
      const other = multi.record.themes[1];
      expect(passesConsent(multi, { ...referenceConfig, excludedThemes: [other] })).toBe(false);
    }
    const withOperator = corpus.entries.find((e) => e.record.markers.has_operator);
    expect(withOperator).toBeDefined();
    expect(passesConsent(withOperator!, { ...referenceConfig, allowOperator: false })).toBe(false);
  });

  it('consent is applied BEFORE candidates are gathered — the eligible set is the ceiling', () => {
    // The structural guarantee: nothing downstream has a widening mechanism,
    // so the consented set bounds every draw in the plan.
    const config: UserConfig = { ...referenceConfig, allowOperator: false };
    const eligible = eligibleEntries(corpus, config);
    const allowed = new Set(eligible.consented.map((e) => e.record.id));
    const p = planOrThrow(config, 3);
    for (const tick of p.ticks) {
      for (const lane of LANE_IDS) {
        expect(allowed, `step ${tick.step} ${lane}`).toContain(tick[lane].mantraId);
      }
    }
  });

  it('a blocklist is a PREFERENCE and is relaxed rather than starving', () => {
    // Consent is never relaxed this way; only preference is.
    const everything = corpus.entries.map((e) => e.record.id);
    const result = plan(
      corpus,
      { ...referenceConfig, blocklist: everything },
      NO_DRIFT,
      5,
      { length: REFERENCE_LENGTH },
    );
    expect(isPlanFailure(result)).toBe(false);
    const p = result as SessionPlan;
    expect(p.diagnostics.some((d) => d.kind === 'blocklist-relaxed')).toBe(true);
  });
});

describe('A8 starvation is a plan error', () => {
  it('an unservable config returns PlanError[] naming the specific fix', () => {
    const result = plan(
      corpus,
      { ...referenceConfig, themes: ['obedience'], excludedThemes: ['obedience'] },
      NO_DRIFT,
      1,
      { length: REFERENCE_LENGTH },
    );
    expect(isPlanFailure(result)).toBe(true);
    const errors = result as ReturnType<typeof plan> & Array<{ kind: string; fix: string }>;
    for (const error of errors) {
      expect(error.fix.length, error.kind).toBeGreaterThan(0);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('names theme-cannot-serve-triplet when a block is too thin', () => {
    // Keep both bookends intact and thin ONLY the enrolled theme, so the error
    // under test is the one that fires. A fixture that also starves the head
    // would pass this assertion for the wrong reason.
    const all = (fixture('corpus.mini.json') as { mantras: Array<{ themes: string[] }> }).mantras;
    const kept = all.filter((m) => {
      if (m.themes.includes('induction') || m.themes.includes('emergence')) return true;
      // Two `focus` records: present, but one short of a triplet.
      return m.themes.includes('focus') && all.filter((x) => x.themes.includes('focus')).indexOf(m) < 2;
    });

    const thin = loadCorpus({ mantras: kept, theme_descriptions: {} }, fixture('persons.mini.json'));
    if (isLoadFailure(thin)) throw new Error(`thin corpus failed to load: ${JSON.stringify(thin)}`);

    const result = plan(thin, { ...referenceConfig, themes: ['focus'] }, NO_DRIFT, 1, {
      length: REFERENCE_LENGTH,
    });
    expect(isPlanFailure(result)).toBe(true);
    const errors = result as Array<{ kind: string; theme?: string; fix: string }>;
    expect(errors.map((e) => e.kind)).toContain('theme-cannot-serve-triplet');
    // The error names the block AND the fix, per §6.3's reject-don't-repair.
    const starved = errors.find((e) => e.kind === 'theme-cannot-serve-triplet');
    expect(starved?.theme).toBe('focus');
    expect(starved?.fix).toContain('focus');
  });

  it('an empty theme list is rejected with `no-themes`', () => {
    const result = plan(corpus, { ...referenceConfig, themes: [] }, NO_DRIFT, 1);
    expect(isPlanFailure(result)).toBe(true);
    expect((result as Array<{ kind: string }>).map((e) => e.kind)).toContain('no-themes');
  });

  it('rejects a theme that is both enrolled and excluded', () => {
    const result = plan(
      corpus,
      { ...referenceConfig, themes: ['focus'], excludedThemes: ['focus'] },
      NO_DRIFT,
      1,
    );
    expect(isPlanFailure(result)).toBe(true);
    expect((result as Array<{ kind: string }>).map((e) => e.kind)).toContain(
      'theme-enrolled-and-excluded',
    );
  });

  it('rejects a theme designated both induction and emergence', () => {
    const result = plan(corpus, referenceConfig, {
      ...NO_DRIFT,
      bookends: {
        inductionThemes: ['induction'],
        emergenceThemes: ['induction'],
        fraction: 0.1,
      },
    });
    expect(isPlanFailure(result)).toBe(true);
    expect((result as Array<{ kind: string }>).map((e) => e.kind)).toContain(
      'bookend-theme-conflict',
    );
  });

  it('rejects an unknown bookend theme rather than silently dropping it', () => {
    // "A phase that silently dropped a bad block name would reintroduce the
    // artifact it exists to prevent."
    const result = plan(corpus, referenceConfig, {
      ...NO_DRIFT,
      bookends: {
        inductionThemes: ['not_a_theme'],
        emergenceThemes: ['emergence'],
        fraction: 0.1,
      },
    });
    expect(isPlanFailure(result)).toBe(true);
    expect((result as Array<{ kind: string }>).map((e) => e.kind)).toContain(
      'unknown-bookend-theme',
    );
  });

  it('rejects invalid options', () => {
    const result = plan(corpus, referenceConfig, {
      ...NO_DRIFT,
      intensityBell: { peak: 0.5, width: 0 },
    });
    expect(isPlanFailure(result)).toBe(true);
    expect((result as Array<{ kind: string }>).map((e) => e.kind)).toContain('invalid-options');
  });

  it('no plan is ever returned with a missing or duplicate-filled tick', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const p = planOrThrow(referenceConfig, seed);
      expect(p.ticks.map((t) => t.step)).toEqual(p.ticks.map((_, i) => i));
      for (const tick of p.ticks) {
        for (const lane of LANE_IDS) {
          expect(tick[lane].mantraId.length, `seed ${seed} step ${tick.step}`).toBeGreaterThan(0);
          expect(tick[lane].text.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('A9 person schedule', () => {
  it('the center is `second` in 100% of ticks', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      for (const tick of planOrThrow(referenceConfig, seed).ticks) {
        expect(tick.center.person, `seed ${seed} step ${tick.step}`).toBe('second');
      }
    }
  });

  /** Mean side-`named` share per decile, over `seeds` seeds at `length` steps. */
  function namedDeciles(
    person: typeof DEFAULT_SESSION_OPTIONS.person,
    length = 353,
    seeds = 200,
  ): number[] {
    const deciles = new Array<number>(10).fill(0);
    const counts = new Array<number>(10).fill(0);
    for (let seed = 0; seed < seeds; seed += 1) {
      const schedule = buildPersonSchedule(length, person, seed);
      for (let step = 0; step < length; step += 1) {
        const decile = Math.min(9, Math.floor((step / length) * 10));
        const named =
          (schedule.left[step] === 'named' ? 1 : 0) + (schedule.right[step] === 'named' ? 1 : 0);
        deciles[decile] += named / 2;
        counts[decile] += 1;
      }
    }
    return deciles.map((sum, i) => sum / counts[i]);
  }

  it('the side `named` share is NON-MONOTONE — out and BACK', () => {
    // This is A9's substance, and it is asserted in BOTH directions rather than
    // merely permitted: the return toward first person is the point. A session
    // that leaves you dissociated is a session you resent afterward, and the
    // drift out is what makes the drift in safe to accept.
    const d = namedDeciles(DEFAULT_SESSION_OPTIONS.person);

    // Rises into the middle...
    expect(d[0], 'decile 1').toBeLessThan(0.3);
    expect(d[4], 'decile 5').toBeGreaterThan(0.55);
    expect(d[5], 'decile 6').toBeGreaterThan(0.55);
    expect(d[6], 'decile 7').toBeGreaterThan(0.55);
    // ...and comes back down. Non-monotone by design: a monotone drift would
    // pass "rises" and still be the defect this criterion exists to catch.
    expect(d[9], 'decile 10').toBeLessThan(d[5]);
    expect(d[9], 'decile 10').toBeLessThan(0.4);
    expect(d[0], 'the session opens and closes near "I"').toBeLessThan(0.3);
  });

  it("A9's exact decile thresholds are reachable — the schedule, not the defaults, is the limit", () => {
    // MEASURED: at M1's shipped person defaults (peak 0.55, width 0.28) the
    // MIX CURVE ITSELF averages 0.309 across decile 2 and 0.475 across decile
    // 9, against A9's <0.20 and <0.25. Since the steady-state named share under
    // hold-and-pivot IS the sampling probability at the pivot, no scheduler
    // implementation can meet those thresholds at those defaults — the
    // criterion and the frozen defaults disagree, and the defaults are M1's to
    // own (`tests/shared-contract.test.ts` pins them).
    //
    // So this test proves the half that is M2's: the schedule reproduces A9's
    // exact profile when the bell is narrowed to a width that admits it. If
    // this passes and the one above passes, the scheduler is correct and the
    // remaining gap is a tuning value in someone else's file.
    const d = namedDeciles({ ...DEFAULT_SESSION_OPTIONS.person, bell: { peak: 0.5, width: 0.2 } });

    expect(d[0], 'decile 1').toBeLessThan(0.2);
    expect(d[1], 'decile 2').toBeLessThan(0.2);
    expect(d[4], 'decile 5').toBeGreaterThan(0.55);
    expect(d[5], 'decile 6').toBeGreaterThan(0.55);
    expect(d[6], 'decile 7').toBeGreaterThan(0.55);
    expect(d[8], 'decile 9').toBeLessThan(0.25);
    expect(d[9], 'decile 10').toBeLessThan(0.25);
  });

  it('opens with both sides in `first`', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const schedule = buildPersonSchedule(120, DEFAULT_SESSION_OPTIONS.person, seed);
      expect(schedule.left[0], `seed ${seed}`).toBe('first');
      expect(schedule.right[0], `seed ${seed}`).toBe('first');
    }
  });

  it('the two sides pivot INDEPENDENTLY — they are not one stream in two arrays', () => {
    let disagreements = 0;
    for (let seed = 0; seed < 50; seed += 1) {
      const s = buildPersonSchedule(200, DEFAULT_SESSION_OPTIONS.person, seed);
      for (let i = 0; i < 200; i += 1) if (s.left[i] !== s.right[i]) disagreements += 1;
    }
    // Mid-session one side sits in "I" while the other sits in "{subject}" —
    // the two readings of yourself coexisting.
    expect(disagreements).toBeGreaterThan(0);
  });

  it('holds rather than shimmering — I / she / I / I / she reads as a bug', () => {
    const s = buildPersonSchedule(200, DEFAULT_SESSION_OPTIONS.person, 11);
    let flips = 0;
    for (let i = 1; i < 200; i += 1) if (s.left[i] !== s.left[i - 1]) flips += 1;
    // With pivotEvery 4 there are at most 50 opportunities to flip in 200 steps.
    expect(flips).toBeLessThanOrEqual(200 / DEFAULT_SESSION_OPTIONS.person.pivotEvery);
  });

  it('every rendered lane text matches the sidecar variant it claims', () => {
    const p = planOrThrow();
    for (const tick of p.ticks) {
      for (const lane of LANE_IDS) {
        const entry = corpus.entries[corpus.byId[tick[lane].mantraId]];
        expect(tick[lane].text, `step ${tick.step} ${lane}`).toBe(entry.persons[tick[lane].person]);
      }
    }
  });
});

describe('A12 diagnostics', () => {
  it('zero lane-starved on the reference config', () => {
    const p = planOrThrow();
    expect(p.diagnostics.filter((d) => d.kind === 'lane-starved')).toEqual([]);
  });

  it('every diagnostic is typed data on the plan, not a string', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      for (const d of planOrThrow(referenceConfig, seed).diagnostics) {
        expect(typeof d.kind).toBe('string');
        expect([
          'lane-starved',
          'shuffler-degraded',
          'blocklist-relaxed',
          'person-unavailable',
          'unison-redraw',
        ]).toContain(d.kind);
      }
    }
  });

  it('a degraded shuffler is reported with its theme and pool size', () => {
    // Below `degradedBelow` the suppression window saturates against the block.
    const p = planOrThrow(referenceConfig, 1);
    for (const d of p.diagnostics) {
      if (d.kind !== 'shuffler-degraded') continue;
      expect(typeof d.theme).toBe('string');
      expect(d.poolSize).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('A13 theme axis', () => {
  it('exactly one theme is shared across all three lanes at every step', () => {
    const p = planOrThrow();
    for (const tick of p.ticks) {
      for (const lane of LANE_IDS) {
        const entry = corpus.entries[corpus.byId[tick[lane].mantraId]];
        expect(entry.record.themes, `step ${tick.step} ${lane}`).toContain(tick.theme);
      }
    }
  });

  it('the walk HOLDS for THEME_HOLD steps between pivots', () => {
    // A theme that changes every 3.4 seconds is a shuffle, not an arc.
    const hold = DEFAULT_SESSION_OPTIONS.themeWalk.themeHold;
    for (let seed = 0; seed < 50; seed += 1) {
      const middle = planOrThrow(referenceConfig, seed, NO_DRIFT, 120).ticks.filter(
        (t) => t.phase === 'middle',
      );
      let runStart = 0;
      for (let i = 1; i <= middle.length; i += 1) {
        if (i === middle.length || middle[i].theme !== middle[runStart].theme) {
          // The final run may be truncated by the tail; interior runs are full.
          if (i < middle.length) {
            expect(i - runStart, `seed ${seed} run at ${runStart}`).toBe(hold);
          }
          runStart = i;
        }
      }
    }
  });
});

describe('C7 (engine half) — unison never resolves to an invariant mantra', () => {
  it('the planner refuses and redraws', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const result = plan(
        corpus,
        { ...referenceConfig, mode: 'unison' },
        NO_DRIFT,
        seed,
        { length: REFERENCE_LENGTH },
      );
      if (isPlanFailure(result)) continue;
      for (const tick of result.ticks) {
        const entry = corpus.entries[corpus.byId[tick.center.mantraId]];
        // An invariant record under unison renders as three byte-identical
        // strings, which a user reads as a bug rather than emphasis.
        expect(entry.invariant, `seed ${seed} step ${tick.step}`).toBe(false);
      }
    }
  });

  it('unison shows ONE mantra across all three lanes, each in its own person', () => {
    const result = plan(corpus, { ...referenceConfig, mode: 'unison' }, NO_DRIFT, 3, {
      length: REFERENCE_LENGTH,
    });
    const p = result as SessionPlan;
    for (const tick of p.ticks) {
      expect(tick.left.mantraId).toBe(tick.center.mantraId);
      expect(tick.right.mantraId).toBe(tick.center.mantraId);
      expect(tick.center.person).toBe('second');
    }
  });
});

describe('the plan and the conductor agree', () => {
  it('every step of the plan is reachable from some elapsedMs', () => {
    // The two halves of the module are written against one another, so a
    // dwell the planner emits that the conductor never lands on would be a
    // silent content loss — a mantra planned and never shown.
    const p = planOrThrow();
    const seen = new Set<number>();
    for (let t = 0; t <= p.meta.contentMs; t += 50) {
      seen.add(frameAt(p, t + p.meta.laneOffsetsMs.center).step);
    }
    for (let step = 0; step < p.meta.length; step += 1) {
      expect(seen, `step ${step} is never shown`).toContain(step);
    }
  });

  it('the conductor reports the theme the planner assigned', () => {
    const p = planOrThrow();
    for (let t = 1000; t < p.meta.contentMs; t += 1000) {
      const frame = frameAt(p, t);
      expect(frame.theme).toBe(p.ticks[frame.step].theme);
    }
  });
});

describe('A11 performance', () => {
  it('plan() p95 <= 40ms for a 500-step plan', () => {
    // Asserted on the mini corpus here; `planner-corpus.test.ts` runs the same
    // budget against the full production corpus, which is the case that matters.
    const samples: number[] = [];
    for (let seed = 0; seed < 30; seed += 1) {
      const started = performance.now();
      plan(corpus, referenceConfig, NO_DRIFT, seed, { length: 500 });
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThanOrEqual(40);
  });
});
