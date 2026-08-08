/**
 * M2 acceptance against the PRODUCTION corpus.
 *
 * `tests/planner.test.ts` runs on `fixtures/corpus.mini.json`, which is 47
 * hand-authored records — small enough that a failure is diagnosable by
 * reading it, and far too small to prove a property. The blocks there hold 8-9
 * records, so the shuffler window clamps to 4 and spans barely one round of
 * three lanes.
 *
 * The real pool is 2,639 records across 25 tags with blocks of 80-358, where
 * the window is the full 12 and spans three whole rounds. That is where
 * anti-repeat has teeth, where A11's performance budget is meaningful, and
 * where A7's consent sweep runs against genuinely multi-tagged data.
 *
 * This file reads `corpus/pool.json` from disk, which the ENGINE may not do —
 * so the reading happens here, in a test, and the engine is handed parsed
 * values. That is the same seam `web/` and `tools/` use.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { plan, isPlanFailure } from '../engine/plan/plan.ts';
import { frameAt } from '../engine/conduct/frameAt.ts';
import { windowFor } from '../engine/plan/shuffler.ts';
import { loadCorpus, isLoadFailure } from '../engine/corpus/load.ts';
import { ENROLLABLE_TAGS, EXCLUSION_ONLY_TAGS } from '../engine/corpus/vocabulary.ts';
import { DEFAULT_SESSION_OPTIONS, type SessionOptions, type UserConfig } from '../engine/types/config.ts';
import { CHANNEL_COUNT, LANE_IDS } from '../engine/types/frame.ts';
import type { Corpus } from '../engine/types/record.ts';
import type { SessionPlan } from '../engine/types/plan.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8')) as unknown;

const loaded = loadCorpus(
  readJson('corpus/pool.json'),
  readJson('corpus/persons.json'),
  readJson('corpus/provenance.json'),
);
if (isLoadFailure(loaded)) {
  throw new Error(`the production corpus failed to load: ${JSON.stringify(loaded.slice(0, 5))}`);
}
const corpus: Corpus = loaded;

const NO_DRIFT: Partial<SessionOptions> = {
  pacing: { ...DEFAULT_SESSION_OPTIONS.pacing, driftPct: 0 },
};

/** A realistic 20-minute sitting on four enrolled tags. */
const baseConfig: UserConfig = {
  themes: ['submission', 'obedience', 'focus', 'devotion'],
  excludedThemes: [],
  allowOperator: true,
  names: { subject: 'Alex', operator: 'Morgan' },
  targetDurationMs: 20 * 60 * 1000,
  mode: 'parallel',
  blocklist: [],
};

function planOrThrow(config: UserConfig = baseConfig, seed = 47, length?: number): SessionPlan {
  const result = plan(corpus, config, NO_DRIFT, seed, length === undefined ? {} : { length });
  if (isPlanFailure(result)) {
    throw new Error(`expected a plan, got: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

describe('the production corpus is plannable', () => {
  it('loads without errors and carries the expected scale', () => {
    expect(corpus.entries.length).toBeGreaterThan(2000);
    expect(corpus.stats.themeCount).toBeGreaterThanOrEqual(20);
  });

  it('a default 20-minute sitting plans to ~353 steps', () => {
    const p = planOrThrow();
    expect(p.meta.length).toBe(Math.round((20 * 60 * 1000) / 3400));
    expect(p.meta.head + p.meta.middle + p.meta.tail).toBe(p.meta.length);
  });

  it('every enrollable tag can carry a session on its own', () => {
    // A tag that reaches the picker but cannot field a triplet is a starve the
    // user meets at the end of the setup screen, so it is asserted here rather
    // than discovered there.
    for (const tag of ENROLLABLE_TAGS) {
      if (tag === 'induction' || tag === 'emergence') continue; // bookend roles
      const result = plan(corpus, { ...baseConfig, themes: [tag] }, NO_DRIFT, 3);
      expect(isPlanFailure(result), `${tag} could not plan`).toBe(false);
    }
  });
});

describe('A6 anti-repeat, where the window actually spans rounds', () => {
  it('no id repeats within the window on real block sizes', () => {
    // Blocks here are 80-358, so `window` clamps to 12 and covers three whole
    // rounds of three lanes — a real anti-repeat assertion rather than a
    // vacuous one.
    for (let seed = 0; seed < 20; seed += 1) {
      const p = planOrThrow(baseConfig, seed);
      const rounds = new Map<string, string[][]>();
      for (const tick of p.ticks) {
        const list = rounds.get(tick.theme) ?? [];
        list.push([tick.center.mantraId, tick.left.mantraId, tick.right.mantraId]);
        rounds.set(tick.theme, list);
      }

      for (const [theme, list] of rounds) {
        const w = windowFor(corpus.byTheme[theme]?.length ?? 0, DEFAULT_SESSION_OPTIONS.shuffler);
        const covered = Math.max(0, Math.floor((w - (CHANNEL_COUNT - 1)) / CHANNEL_COUNT));
        expect(covered, `${theme} should span whole rounds on the real corpus`).toBeGreaterThan(0);
        for (let i = covered; i < list.length; i += 1) {
          const recent = list.slice(i - covered, i).flat();
          for (const id of list[i]) {
            expect(recent, `seed ${seed} ${theme} round ${i}`).not.toContain(id);
          }
        }
      }
    }
  });

  it('emits no shuffler-degraded diagnostic on healthy blocks', () => {
    const p = planOrThrow();
    expect(p.diagnostics.filter((d) => d.kind === 'shuffler-degraded')).toEqual([]);
  });
});

describe('A7 consent on real, multi-tagged data — ZERO TOLERANCE', () => {
  // A7 specifies the sweep size, so the sweep runs at that size and the budget
  // moves rather than the sample: 1000 plans over 2,639 records against every
  // lane of every tick is genuinely a lot of assertions, and shrinking it to
  // fit a default timeout would be quietly weakening the criterion that says
  // one violation blocks 1.0.
  it('1000 configs: no excluded tag and no operator mantra ever reaches a lane', { timeout: 120_000 }, () => {
    const enrollable = ENROLLABLE_TAGS.filter((t) => t !== 'induction' && t !== 'emergence');
    const excludable = [...ENROLLABLE_TAGS, ...EXCLUSION_ONLY_TAGS];

    let planned = 0;
    let withExclusions = 0;

    for (let n = 0; n < 1000; n += 1) {
      // A deterministic spread over enrolments and exclusions, so a failure is
      // replayable from `n` alone.
      const themes = enrollable.filter((_, i) => (i + n) % 7 === 0);
      const excludedThemes = excludable.filter((t, i) => (i + n) % 5 === 0 && !themes.includes(t));
      if (themes.length === 0) continue;

      const config: UserConfig = {
        ...baseConfig,
        themes,
        excludedThemes,
        allowOperator: n % 3 !== 0,
      };

      const result = plan(corpus, config, NO_DRIFT, n, { length: 60 });
      if (isPlanFailure(result)) continue;
      planned += 1;
      if (excludedThemes.length > 0) withExclusions += 1;

      for (const tick of result.ticks) {
        for (const lane of LANE_IDS) {
          const entry = corpus.entries[corpus.byId[tick[lane].mantraId]];
          expect(entry, `config ${n}: id not in corpus`).toBeDefined();

          if (!config.allowOperator) {
            expect(
              entry.record.markers.has_operator,
              `config ${n} step ${tick.step} ${lane}: operator mantra with the toggle off`,
            ).toBe(false);
          }

          // The FULL tag list, never the bucket it was drawn under. On this
          // corpus that is a live check: records carry real multi-tag sets.
          for (const excluded of config.excludedThemes) {
            expect(
              entry.record.themes,
              `config ${n} step ${tick.step} ${lane}: ${tick[lane].mantraId} carries excluded ${excluded}`,
            ).not.toContain(excluded);
          }
        }
      }
    }

    expect(planned, 'the sweep must actually plan sessions').toBeGreaterThan(100);
    expect(withExclusions, 'and most of them must carry exclusions').toBeGreaterThan(50);
  });

  it('excluding an exclusion-only tag removes it without being selectable', () => {
    // `machine_register` and `explicit` may be excluded and never enrolled.
    for (const tag of EXCLUSION_ONLY_TAGS) {
      const p = planOrThrow({ ...baseConfig, excludedThemes: [tag] }, 9);
      for (const tick of p.ticks) {
        for (const lane of LANE_IDS) {
          const entry = corpus.entries[corpus.byId[tick[lane].mantraId]];
          expect(entry.record.themes, `${tag} leaked at step ${tick.step}`).not.toContain(tag);
        }
      }
    }
  });

  it('a cross-tagged record is invisible to a user who excluded its OTHER tag', () => {
    // The cross-tag leak, stated directly: a record tagged {A,B} must not reach
    // a user enrolled in A who wants nothing from B.
    const multi = corpus.entries.filter((e) => e.record.themes.length > 1);
    expect(multi.length, 'the corpus should carry multi-tagged records').toBeGreaterThan(0);

    const sample = multi[0];
    const [enrol, exclude] = sample.record.themes;
    const result = plan(
      corpus,
      { ...baseConfig, themes: [enrol], excludedThemes: [exclude] },
      NO_DRIFT,
      2,
      { length: 60 },
    );
    if (!isPlanFailure(result)) {
      for (const tick of result.ticks) {
        for (const lane of LANE_IDS) {
          expect(tick[lane].mantraId).not.toBe(sample.record.id);
        }
      }
    }
  });
});

describe('A11 performance on the full corpus', () => {
  it('plan() p95 <= 40ms for a 500-step plan', () => {
    const samples: number[] = [];
    for (let seed = 0; seed < 25; seed += 1) {
      const started = performance.now();
      const result = plan(corpus, baseConfig, NO_DRIFT, seed, { length: 500 });
      samples.push(performance.now() - started);
      expect(isPlanFailure(result)).toBe(false);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    expect(p95, `p95 was ${p95.toFixed(1)}ms`).toBeLessThanOrEqual(40);
  });

  it('frameAt is cheap enough to call every frame', () => {
    // The browser calls this from requestAnimationFrame, so a 500-step plan
    // must resolve a frame in well under a 16ms budget.
    const p = planOrThrow(baseConfig, 1, 500);
    const started = performance.now();
    for (let i = 0; i < 600; i += 1) frameAt(p, i * 1000);
    const perCall = (performance.now() - started) / 600;
    expect(perCall, `frameAt averaged ${perCall.toFixed(3)}ms`).toBeLessThan(2);
  });
});

describe('A3 directionality at production scale', () => {
  it('no emergence in the first half, no induction in the second, over 200 seeds', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const p = planOrThrow(baseConfig, seed, 60);
      const half = p.ticks.length / 2;
      for (const tick of p.ticks) {
        if (tick.step < half) expect(tick.theme, `seed ${seed}`).not.toBe('emergence');
        else expect(tick.theme, `seed ${seed}`).not.toBe('induction');
      }
    }
  });
});
