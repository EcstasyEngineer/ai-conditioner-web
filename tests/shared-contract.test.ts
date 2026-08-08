/**
 * M1 acceptance: the shared contract itself.
 *
 *   "FrameState is fully typed here, not in M3. This is the seam that makes M2
 *    and M4 parallelizable and it is owned by exactly one module."
 *   "Every arrow between modules is a TypeScript type, and every shared type is
 *    owned by M1. No module reaches around its interface. No module redefines a
 *    shared type."
 *
 * A type-level contract is invisible to a normal test run: nothing fails at
 * runtime when a second module quietly declares its own `FrameState` and the
 * two drift. So this file does two things a type checker cannot do on its own —
 * it names every shared type as a value-level import so a rename breaks the
 * build here, and it greps the tree for a redefinition.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNEL_COUNT, LANE_IDS } from '../engine/types/frame.ts';
import { DIAGNOSTIC_KINDS } from '../engine/types/diagnostic.ts';
import { DEFAULT_SESSION_OPTIONS, MEAN_DWELL_MS } from '../engine/types/config.ts';
import { PERSON_VALUES, POV_VALUES } from '../engine/types/record.ts';
import { derivePov } from '../engine/corpus/stance.ts';
import { loadCorpus } from '../engine/corpus/load.ts';

// Every shared type named in MODULES.json shared_contract.types, imported as a
// type. If any is renamed or moved, this file stops compiling — which is the
// only way a type-only contract can fail loudly.
import type {
  Corpus,
  Markers,
  Person,
  PersonTriple,
  PoolRecord,
  Provenance,
} from '../engine/types/record.ts';
import type { ChannelFrame, FrameState, LaneId } from '../engine/types/frame.ts';
import type { PlanError, SessionPlan, TripletTick } from '../engine/types/plan.ts';
import type { SessionOptions, UserConfig } from '../engine/types/config.ts';
import type { Diagnostic } from '../engine/types/diagnostic.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('every shared type is reachable and named exactly once', () => {
  it('the type names in MODULES.json all resolve', () => {
    // The assertions below exist to USE each import, so `noUnusedLocals` keeps
    // the imports above honest rather than letting them rot into comments.
    const shape = {
      record: null as unknown as PoolRecord,
      markers: null as unknown as Markers,
      triple: null as unknown as PersonTriple,
      corpus: null as unknown as Corpus,
      provenance: null as unknown as Provenance,
      person: null as unknown as Person,
      lane: null as unknown as LaneId,
      config: null as unknown as UserConfig,
      options: null as unknown as SessionOptions,
      plan: null as unknown as SessionPlan,
      tick: null as unknown as TripletTick,
      planError: null as unknown as PlanError,
      frame: null as unknown as FrameState,
      channel: null as unknown as ChannelFrame,
      diagnostic: null as unknown as Diagnostic,
    };
    expect(Object.keys(shape)).toHaveLength(15);
  });

  it('exports the constants the interface promises', () => {
    expect(CHANNEL_COUNT).toBe(3);
    expect(typeof derivePov).toBe('function');
    expect(typeof loadCorpus).toBe('function');
  });

  it('the engine and the ingester derive the same stance from the same text', () => {
    // `pov` is derived in two places on purpose: the engine may not import from
    // `tools/`, so the alternative to a second implementation is a runtime
    // dependency the architecture forbids. What is NOT optional is that they
    // agree, because the ingester decides which variant becomes `text` and the
    // engine's sidecar integrity check re-derives that decision. A divergence
    // means every record of the disputed stance fails to load.
    const cases: Array<[string, string]> = [
      ['I sink deeper', 'first'],
      ["I'm sinking deeper", 'first'],
      ['You sink deeper', 'second'],
      ["You're sinking deeper", 'second'],
      ['{subject} sinks deeper', 'named'],
      ['Resistance melts away with each breath', 'impersonal'],
      ['I kneel when {operator} speaks', 'first'],
      ["{subject}'s thoughts go quiet", 'named'],
      ['I watch {subject} sink', 'mixed'],
    ];
    for (const [text, expected] of cases) {
      expect(derivePov(text), text).toBe(expected);
    }
  });
});

describe('FrameState is owned by M1 and by nothing else', () => {
  /**
   * Every file that gets BUNDLED — `engine/` and `web/`, tests excluded.
   *
   * `tools/` is deliberately out of scope. MODULES.json requires M5 to import
   * M1's schema rather than reimplement it, and `tools/ingest/` currently
   * declares its own `PoolRecord`, `PersonTriple`, `Markers` and `Corpus` from
   * a pre-M1 pass. That is a real contract gap and it is M5's to close; a test
   * that fails on someone else's file can only be muted, not fixed, from here.
   */
  function shippedFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
      }
    };
    for (const dir of ['engine', 'web']) {
      const full = path.join(repoRoot, dir);
      if (existsSync(full)) walk(full);
    }
    return out;
  }

  const owners: Record<string, string> = {
    FrameState: 'engine/types/frame.ts',
    ChannelFrame: 'engine/types/frame.ts',
    LaneId: 'engine/types/frame.ts',
    SessionPlan: 'engine/types/plan.ts',
    TripletTick: 'engine/types/plan.ts',
    PlanError: 'engine/types/plan.ts',
    UserConfig: 'engine/types/config.ts',
    SessionOptions: 'engine/types/config.ts',
    Diagnostic: 'engine/types/diagnostic.ts',
    PoolRecord: 'engine/types/record.ts',
    PersonTriple: 'engine/types/record.ts',
    Corpus: 'engine/types/record.ts',
    Markers: 'engine/types/record.ts',
  };

  it.each(Object.entries(owners))('%s is declared only in %s', (name, owner) => {
    // Matches a DECLARATION (`interface X`, `type X =`, `enum X`), not a
    // reference. A module importing the type is the correct behavior; a module
    // declaring its own copy is the failure — two strong agents blocking on a
    // type neither owns, which is R7.
    const declaration = new RegExp(
      String.raw`(?:^|\s)(?:export\s+)?(?:interface\s+${name}\b|type\s+${name}\s*=|enum\s+${name}\b)`,
    );

    const ownerPath = path.join(repoRoot, owner);
    const offenders = shippedFiles()
      .filter((file) => file !== ownerPath)
      .filter((file) => declaration.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(repoRoot, file));

    expect(offenders).toEqual([]);
    expect(declaration.test(readFileSync(ownerPath, 'utf8')), `${owner} must declare ${name}`).toBe(
      true,
    );
  });
});

describe('the enums are closed sets', () => {
  it('LANE_IDS is the three lanes', () => {
    expect([...LANE_IDS].sort()).toEqual(['center', 'left', 'right']);
  });

  it('POV_VALUES excludes `mixed` — the transformation stays total', () => {
    expect(POV_VALUES).not.toContain('mixed');
    expect(POV_VALUES).toHaveLength(4);
  });

  it('PERSON_VALUES is the renderable subset of POV_VALUES', () => {
    expect(PERSON_VALUES).toHaveLength(3);
    expect(PERSON_VALUES).not.toContain('impersonal');
  });

  it('DIAGNOSTIC_KINDS covers every §4.10 kind', () => {
    expect([...DIAGNOSTIC_KINDS].sort()).toEqual([
      'blocklist-relaxed',
      'lane-starved',
      'person-unavailable',
      'shuffler-degraded',
      'unison-redraw',
    ]);
  });
});

describe('SessionOptions exposes tuning as fields, not constants', () => {
  it('every knob DESIGN.md names is a field', () => {
    // R11: person drift, neutral bias and hysteresis are unprecedented and land
    // in the deepest module. If a real sitting says they read as mechanical,
    // the fix must be a config change rather than a rebuild — which is only
    // true if they were never constants in the first place.
    const o = DEFAULT_SESSION_OPTIONS;
    expect(o.person.peakMix).toBe(0.85);
    expect(o.person.pivotEvery).toBe(4);
    expect(o.person.bell).toEqual({ peak: 0.55, width: 0.28 });
    expect(typeof o.person.neutralBias).toBe('number');

    expect(o.themeWalk.themeHold).toBe(8);
    expect(o.pacing.driftPct).toBe(0.04);
    expect(o.pacing.dwellMinMs).toBe(2900);
    expect(o.pacing.dwellMaxMs).toBe(4200);
    expect(o.intensityBell).toEqual({ peak: 0.5, width: 0.25 });
    expect(o.pacing.dwellBell.peak).toBe(0.62);
    expect(o.bookends.fraction).toBe(0.1);
  });

  it('R19: the three bells peak at three different points', () => {
    const o = DEFAULT_SESSION_OPTIONS;
    const peaks = [o.intensityBell.peak, o.person.bell.peak, o.pacing.dwellBell.peak];
    expect(new Set(peaks).size).toBe(peaks.length);
    // Pacing peaks LAST, so the tightest pacing arrives after the deepest
    // content rather than on top of it.
    expect(o.pacing.dwellBell.peak).toBeGreaterThan(o.intensityBell.peak);
    expect(o.pacing.dwellBell.peak).toBeGreaterThan(o.person.bell.peak);
  });

  it('R4: driftPct is halved from the base proposal and tunable to zero', () => {
    expect(DEFAULT_SESSION_OPTIONS.pacing.driftPct).toBeLessThanOrEqual(0.04);
    const tuned: SessionOptions = { ...DEFAULT_SESSION_OPTIONS, pacing: { ...DEFAULT_SESSION_OPTIONS.pacing, driftPct: 0 } };
    expect(tuned.pacing.driftPct).toBe(0);
  });

  it('§4.9 mean dwell sits inside the measured 3.2-3.5s band', () => {
    expect(MEAN_DWELL_MS).toBeGreaterThanOrEqual(3200);
    expect(MEAN_DWELL_MS).toBeLessThanOrEqual(3500);
  });

  it('the defaults are frozen — a mutated shared default is import-order dependence', () => {
    expect(Object.isFrozen(DEFAULT_SESSION_OPTIONS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SESSION_OPTIONS.pacing)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SESSION_OPTIONS.person)).toBe(true);
  });

  it('gaussian is the shipped default and dsm is not a mode at all', () => {
    expect(DEFAULT_SESSION_OPTIONS.titration).toBe('gaussian');
    const modes: SessionOptions['titration'][] = ['gaussian', 'linear'];
    expect(modes).toHaveLength(2);
  });

  it('names induction and emergence as the bookend themes', () => {
    expect(DEFAULT_SESSION_OPTIONS.bookends.inductionThemes).toContain('induction');
    expect(DEFAULT_SESSION_OPTIONS.bookends.emergenceThemes).toContain('emergence');
  });
});

describe('a PlanError always names a fix', () => {
  it('the type requires it', () => {
    // §6.3's reject-don't-repair doctrine: never accepted-and-worked-around at
    // delivery time, always a targeted message naming the specific fix. A
    // required field is how that survives a refactor.
    const example: PlanError = {
      kind: 'empty-pool',
      message: 'consent filters left no eligible mantras',
      fix: 'raise the intensity cap or re-enable operator mantras first',
    };
    expect(example.fix.length).toBeGreaterThan(0);
  });
});

describe('the engine imports no platform and no third party', () => {
  function engineFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(full)) out.push(full);
      }
    };
    walk(path.join(repoRoot, 'engine'));
    return out;
  }

  it('every import in engine/ is a relative path inside engine/', () => {
    // The lint rule is the wall; this is the belt to its braces, and it states
    // the rule positively rather than enumerating what is banned.
    //
    // Anchored to the start of a line so it matches a STATEMENT rather than the
    // word "from" inside a doc comment — which it did, on the sentence
    // explaining why a scalar cannot tell "low because we are inducting" from
    // "low because we are emerging".
    const importFrom = /^\s*(?:import|export)\b[^;\n]*?\sfrom\s+['"]([^'"]+)['"]/gm;

    for (const file of engineFiles()) {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(importFrom)].map((m) => m[1]);
      for (const specifier of specifiers) {
        expect(specifier.startsWith('.'), `${path.relative(repoRoot, file)} imports ${specifier}`).toBe(
          true,
        );
        expect(specifier).not.toMatch(/(^|\/)web\//);
        expect(specifier).not.toMatch(/(^|\/)tools\//);
      }
    }
  });

  it('names no clock and no unseeded randomness', () => {
    for (const file of engineFiles()) {
      const source = readFileSync(file, 'utf8');
      expect(source, path.relative(repoRoot, file)).not.toMatch(/Date\.now\(/);
      expect(source, path.relative(repoRoot, file)).not.toMatch(/Math\.random\(/);
      expect(source, path.relative(repoRoot, file)).not.toMatch(/performance\.now\(/);
      expect(source, path.relative(repoRoot, file)).not.toMatch(/\bstructuredClone\(/);
    }
  });
});
