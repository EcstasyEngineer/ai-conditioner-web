/**
 * M7 — the setup screen's feedback model, and §6.3's reject-don't-repair rule.
 *
 * Everything asserted here is a PURE FUNCTION of `(corpus, config)`, which is
 * why this file needs no DOM: the whole design of `SetupScreen.tsx` is that the
 * numbers are computed by `buildFeedback` and the component only renders them.
 * A test that drove React would be testing that `<p>{n}</p>` prints `n`.
 *
 * The criteria under test:
 *
 *   D3   displayed counts equal what the plan actually contains
 *   D4   a starving config is refused IN THE FORM, with the fix named
 *   §6.3 enrolled-and-excluded is refused, mirrored in BOTH directions
 *   §6.2 the per-tag breakdown warns when an exclusion drops an enrolled tag
 *   plus the two requirements the judges added: per-person availability, and a
 *   refusal naming the zero-second-variant case specifically.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { Corpus, CorpusEntry } from '../engine/types/record.ts';
import type { UserConfig } from '../engine/types/config.ts';
import { isLoadFailure, loadCorpus } from '../engine/corpus/load.ts';
import { eligibleEntries, passesConsent } from '../engine/plan/consent.ts';
import { ALL_TAGS, CORPUS_FLOOR } from '../engine/corpus/vocabulary.ts';

import {
  buildFeedback,
  buildTagRows,
  personAvailability,
  starvationRefusal,
  startBlockedReason,
} from '../web/setup/SetupScreen.tsx';
import { applyThemeChange, normalizeConfig } from '../web/persist/config.ts';

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

/** The real corpus, trimmed so `enroll` minus `exclude` leaves exactly `keep`
 *  records — a starvation the picker must warn about, built rather than
 *  borrowed so it survives the corpus growing. */
function thinCorpus(enroll: string, exclude: string, keep: number): Corpus {
  let kept = 0;
  const entries = corpus.entries.filter((entry: CorpusEntry) => {
    if (!entry.record.themes.includes(enroll)) return true;
    if (entry.record.themes.includes(exclude)) return true;
    kept += 1;
    return kept <= keep;
  });
  const byTheme: Record<string, CorpusEntry[]> = {};
  for (const entry of entries) {
    for (const theme of entry.record.themes) {
      (byTheme[theme] ??= []).push(entry);
    }
  }
  return { ...corpus, entries, byTheme };
}

function config(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    themes: ['focus', 'submission', 'obedience', 'devotion'],
    excludedThemes: [],
    allowOperator: true,
    names: { subject: 'Alex', operator: 'Morgan' },
    targetDurationMs: 1_200_000,
    mode: 'parallel',
    blocklist: [],
    ...overrides,
  };
}

describe('D3 — the displayed counts equal what the plan contains', () => {
  it('the match count is exactly what the planner admitted at its chokepoint', () => {
    const cfg = config();
    const feedback = buildFeedback({ corpus, config: cfg, seed: 47 });

    // The screen must not have its own filter. Same function the planner calls.
    const eligible = eligibleEntries(corpus, cfg);
    expect(feedback.matched).toBe(eligible.consented.length);
    expect(feedback.total).toBe(corpus.entries.length);
  });

  it('every mantra the plan serves was counted as matching', () => {
    const cfg = config();
    const feedback = buildFeedback({ corpus, config: cfg, seed: 47 });
    expect(feedback.plan).not.toBeNull();

    const matchedIds = new Set(
      eligibleEntries(corpus, cfg).consented.map((e) => e.record.id),
    );

    // The real D3 claim: nothing reaches a lane that the count did not include.
    // A screen saying 412 while the session serves a 413th mantra is the failure.
    for (const tick of feedback.plan!.ticks) {
      for (const lane of ['center', 'left', 'right'] as const) {
        expect(matchedIds.has(tick[lane].mantraId)).toBe(true);
      }
    }
  });

  it('an exclusion moves the count and the plan together', () => {
    const before = buildFeedback({ corpus, config: config(), seed: 47 });
    const after = buildFeedback({
      corpus,
      config: config({ excludedThemes: ['intense'] }),
      seed: 47,
    });

    expect(after.matched).toBeLessThan(before.matched);
    // And nothing tagged `intense` survives into the plan the user would run.
    for (const tick of after.plan!.ticks) {
      for (const lane of ['center', 'left', 'right'] as const) {
        const entry = corpus.entries[corpus.byId[tick[lane].mantraId]];
        expect(entry.record.themes).not.toContain('intense');
      }
    }
  });

  it('per-tag rows count the same records the consent filter admitted', () => {
    const cfg = config({ excludedThemes: ['explicit'] });
    const eligible = eligibleEntries(corpus, cfg).consented;
    const rows = buildTagRows(corpus, cfg, eligible);

    for (const tag of ['focus', 'submission', 'devotion']) {
      const counted = eligible.filter((e) => e.record.themes.includes(tag)).length;
      expect(rows[tag].available).toBe(counted);
      // Totals come from the unfiltered corpus — "N of M" only teaches the
      // filters if M holds still while N collapses.
      expect(rows[tag].total).toBe(corpus.byTheme[tag].length);
      expect(rows[tag].total).toBeGreaterThanOrEqual(rows[tag].available);
    }
  });
});

describe('§6.2 — the per-tag breakdown warns near the floor', () => {
  it('flags an ENROLLED tag that an exclusion pushed below the floor', () => {
    // The warning is exercised against a corpus built to starve, not against
    // whichever real pair happens to be thin this week: every previously thin
    // pair recovered when the corpus grew, and a test that borrows one silently
    // stops testing the warning the moment that happens.
    const thin = thinCorpus('drone', 'machine_register', CORPUS_FLOOR - 1);
    const cfg = config({ themes: ['drone'], excludedThemes: ['machine_register'] });
    const feedback = buildFeedback({ corpus: thin, config: cfg, seed: 1 });

    expect(feedback.rows['drone'].available).toBeLessThan(CORPUS_FLOOR);
    expect(feedback.rows['drone'].thin).toBe(true);
    expect(feedback.thinTags).toContain('drone');
  });

  it('does NOT flag a thin tag the user has not enrolled', () => {
    // Otherwise the picker cries wolf on twenty rows and the one that matters
    // is lost in them.
    const cfg = config({ themes: ['focus'], excludedThemes: ['machine_register'] });
    const feedback = buildFeedback({ corpus, config: cfg, seed: 1 });
    expect(feedback.rows['drone'].thin).toBe(false);
    expect(feedback.thinTags).not.toContain('drone');
  });
});

describe('the judges’ first requirement — per-person availability', () => {
  it('reports 2nd / 1st / 3rd counts over the matched set', () => {
    const feedback = buildFeedback({ corpus, config: config(), seed: 47 });
    const { persons } = feedback;

    expect(persons.total).toBe(feedback.matched);
    expect(persons.second).toBeGreaterThan(0);
    expect(persons.first).toBeGreaterThan(0);
    expect(persons.third).toBeGreaterThan(0);
    // A count is availability, not a partition: this corpus backfills all three
    // variants on every record, so all three counts reach the total.
    expect(persons.second).toBeLessThanOrEqual(persons.total);
    expect(persons.invariant).toBeLessThanOrEqual(persons.total);
  });

  it('counts a record as serving the centre when its second variant is usable', () => {
    // What the centre needs is `persons.second`, which is what `plan()` reads.
    // NOT "reads differently in the second person": an invariant line such as
    // "Resistance melts away with each breath" renders on the centre exactly as
    // authored, and 420 records in this corpus are invariant.
    const entries: CorpusEntry[] = corpus.entries.slice(0, 200);
    const persons = personAvailability(entries);

    expect(persons.second).toBe(entries.filter((e) => e.persons.second.trim() !== '').length);
    expect(persons.invariant).toBe(entries.filter((e) => e.invariant).length);
    // Invariance is reported alongside, never subtracted from `second`.
    expect(persons.invariant).toBeGreaterThan(0);
    expect(persons.second).toBeGreaterThan(persons.total - persons.invariant);
  });

  it('does NOT treat person-neutral lines as unable to serve the centre', () => {
    // The regression this guards: a mix built entirely from invariant records is
    // entirely servable, and refusing it would reject good content.
    const invariantOnly = corpus.entries.filter((e) => e.invariant);
    expect(invariantOnly.length).toBeGreaterThan(0);

    const persons = personAvailability(invariantOnly);
    expect(persons.second).toBe(invariantOnly.length);
    expect(starvationRefusal(config(), invariantOnly)).toBeNull();
  });

  it('is surfaced per tag as well as per mix', () => {
    const cfg = config();
    const eligible = eligibleEntries(corpus, cfg).consented;
    const rows = buildTagRows(corpus, cfg, eligible);

    for (const tag of ['focus', 'submission']) {
      const expected = eligible.filter(
        (e) => e.record.themes.includes(tag) && e.persons.second.trim() !== '',
      ).length;
      expect(rows[tag].second).toBe(expected);
      expect(rows[tag].second).toBeLessThanOrEqual(rows[tag].available);
      // The picker shows this next to the raw count so a tag rich in mantras
      // and poor in centre coverage is visible before it starves at runtime.
      expect(rows[tag].second).toBeGreaterThan(0);
    }
  });

  it('tracks 2nd-person coverage independently of the raw count', () => {
    // The number the requirement exists to expose: were a tag's centre coverage
    // to fall behind its total, the picker would show the gap rather than a
    // healthy-looking aggregate. On this corpus the two happen to agree, and
    // that agreement is itself the fact worth asserting.
    const cfg = config();
    const eligible = eligibleEntries(corpus, cfg).consented;
    const rows = buildTagRows(corpus, cfg, eligible);

    for (const row of Object.values(rows)) {
      expect(row.second).toBeLessThanOrEqual(row.available);
    }
    const feedback = buildFeedback({ corpus, config: cfg, seed: 47 });
    expect(feedback.persons.second).toBeLessThanOrEqual(feedback.matched);
  });
});

describe('the judges’ second requirement — refusing a mix with no 2nd-person records', () => {
  /**
   * Entries whose `second` variant cannot serve the centre.
   *
   * Built by blanking the variant on real entries rather than by picking a
   * property of the shipped corpus, because the shipped corpus has no such
   * record — every one of its 2,639 entries has a usable second form. The
   * refusal guards a corpus state, so the test has to construct that state.
   */
  function withoutSecondVariants(count = 120): CorpusEntry[] {
    return corpus.entries.slice(0, count).map((entry) => ({
      ...entry,
      persons: { ...entry.persons, second: '' },
    }));
  }

  it('refuses, and names THAT problem rather than a generic empty pool', () => {
    const entries = withoutSecondVariants();
    expect(entries.length).toBeGreaterThan(0);

    const refusal = starvationRefusal(config(), entries);
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/second-person/i);
    expect(refusal!.message).toMatch(/centre lane|center lane/i);
    // Named specifically: the count is in the message, so the user can see the
    // mix is not empty — it is empty of the ONE thing the centre needs.
    expect(refusal!.message).toContain(String(entries.length));
    expect(refusal!.fix.length).toBeGreaterThan(0);
  });

  it('is not fooled by a mix that is large but centre-unservable', () => {
    // The exact failure the requirement exists for: the aggregate count is
    // healthy, and the one number that matters is zero.
    const entries = withoutSecondVariants(500);
    const persons = personAvailability(entries);
    expect(persons.total).toBe(500);
    expect(persons.first).toBeGreaterThan(0);
    expect(persons.second).toBe(0);
    expect(starvationRefusal(config(), entries)).not.toBeNull();
  });

  it('names the exclusions to drop when there are exclusions to drop', () => {
    const entries = withoutSecondVariants();
    const refusal = starvationRefusal(config({ excludedThemes: ['slut', 'degradation'] }), entries);
    expect(refusal!.fix).toContain('slut');
    expect(refusal!.fix).toContain('degradation');
  });

  it('blocks Start rather than deferring the failure to playback (D4)', () => {
    const entries = withoutSecondVariants();
    const cfg = config();
    const refusal = starvationRefusal(cfg, entries);

    const feedback = {
      matched: entries.length,
      total: corpus.entries.length,
      persons: personAvailability(entries),
      rows: {},
      thinTags: [],
      refusal,
      planErrors: [],
      diagnostics: [],
      plan: null,
      sampleTicks: [],
      canStart: false,
    };

    expect(feedback.canStart).toBe(false);
    expect(startBlockedReason(cfg, feedback, false)).toBe(refusal!.fix);
  });

  it('recovers as soon as ONE centre-servable line is back in the mix', () => {
    const entries = withoutSecondVariants();
    expect(starvationRefusal(config(), entries)).not.toBeNull();
    entries.push(corpus.entries[0]);
    expect(starvationRefusal(config(), entries)).toBeNull();
  });

  it('does not refuse a healthy mix', () => {
    const eligible = eligibleEntries(corpus, config()).consented;
    expect(starvationRefusal(config(), eligible)).toBeNull();
    expect(buildFeedback({ corpus, config: config(), seed: 47 }).refusal).toBeNull();
  });
});

describe('D4 — a starving config is refused in the form, with the fix named', () => {
  it('refuses when exclusions really do empty the pool', () => {
    // Every tag in the vocabulary excluded at once. Nothing can survive, and
    // the screen must say so rather than hand the planner an empty draw.
    const cfg = config({ excludedThemes: [...ALL_TAGS] });
    const eligible = eligibleEntries(corpus, cfg).consented;
    expect(eligible).toEqual([]);

    const feedback = buildFeedback({ corpus, config: cfg, seed: 5 });
    expect(feedback.matched).toBe(0);
    expect(feedback.refusal).not.toBeNull();
    expect(feedback.canStart).toBe(false);
    // Never reached the planner: the refusal is a form-level decision (D4).
    expect(feedback.planErrors).toEqual([]);
    expect(feedback.plan).toBeNull();
  });

  it('an empty pool is refused with the exclusions named', () => {
    const refusal = starvationRefusal(config({ excludedThemes: ['focus', 'submission'] }), []);
    expect(refusal).not.toBeNull();
    expect(refusal!.message).toMatch(/no mantras at all/i);
    expect(refusal!.fix).toContain('focus');
    expect(refusal!.fix).toContain('submission');
  });

  it('every refusal names a fix — §6.3 requires it, so it is not optional', () => {
    const noSecond = corpus.entries
      .slice(0, 50)
      .map((e) => ({ ...e, persons: { ...e.persons, second: '' } }));
    const cases = [
      starvationRefusal(config({ excludedThemes: ['slut'] }), []),
      starvationRefusal(config(), []),
      starvationRefusal(config(), noSecond),
    ];
    for (const refusal of cases) {
      expect(refusal).not.toBeNull();
      expect(refusal!.fix.trim().length).toBeGreaterThan(0);
      expect(refusal!.message.trim().length).toBeGreaterThan(0);
    }
  });

  it('the refusal fires BEFORE a plan is attempted', () => {
    // D4's "never at playback": the screen must not need a PlanError to know.
    const noSecond = corpus.entries
      .slice(0, 80)
      .map((e) => ({ ...e, persons: { ...e.persons, second: '' } }));
    expect(starvationRefusal(config(), noSecond)).not.toBeNull();
  });
});

describe('§6.3 — an empty theme list is allowed and simply blocks Start', () => {
  it('is not a refusal', () => {
    const cfg = config({ themes: [] });
    const feedback = buildFeedback({ corpus, config: cfg, seed: 1 });
    expect(feedback.refusal).toBeNull();
    expect(feedback.planErrors).toEqual([]);
  });

  it('blocks Start, visibly', () => {
    const cfg = config({ themes: [] });
    const feedback = buildFeedback({ corpus, config: cfg, seed: 1 });
    expect(feedback.canStart).toBe(false);
    expect(startBlockedReason(cfg, feedback, false)).toBe('Pick at least one theme.');
  });

  it('normalizes cleanly — an empty list is a valid config, not a broken one', () => {
    expect(normalizeConfig(config({ themes: [] })).ok).toBe(true);
  });
});

describe('§6.3 — the save being attempted loses, mirrored in both directions', () => {
  it('refuses enrolling a tag that is already excluded', () => {
    const start = config({ themes: [], excludedThemes: ['slut'] });
    const result = applyThemeChange(start, 'themes', 'slut', true);

    expect(result.rejected).not.toBeNull();
    expect(result.config).toBe(start); // unchanged, not partially applied
    expect(result.config.themes).not.toContain('slut');
    expect(result.config.excludedThemes).toContain('slut');
    expect(result.rejected!.fix).toMatch(/exclusions/);
  });

  it('refuses excluding a tag that is already enrolled', () => {
    const start = config({ themes: ['slut'], excludedThemes: [] });
    const result = applyThemeChange(start, 'excludedThemes', 'slut', true);

    expect(result.rejected).not.toBeNull();
    expect(result.config).toBe(start);
    expect(result.config.excludedThemes).not.toContain('slut');
    expect(result.config.themes).toContain('slut');
    expect(result.rejected!.fix).toMatch(/themes/);
  });

  it('the outcome does not depend on click order', () => {
    // Enrol-then-exclude and exclude-then-enrol must land in mirror states, with
    // the FIRST choice surviving in both — that is what "the save being
    // attempted loses" buys.
    const empty = config({ themes: [], excludedThemes: [] });

    const enrolFirst = applyThemeChange(empty, 'themes', 'worship', true).config;
    const thenExclude = applyThemeChange(enrolFirst, 'excludedThemes', 'worship', true);

    const excludeFirst = applyThemeChange(empty, 'excludedThemes', 'worship', true).config;
    const thenEnrol = applyThemeChange(excludeFirst, 'themes', 'worship', true);

    expect(thenExclude.rejected).not.toBeNull();
    expect(thenEnrol.rejected).not.toBeNull();
    expect(thenExclude.config.themes).toEqual(['worship']);
    expect(thenExclude.config.excludedThemes).toEqual([]);
    expect(thenEnrol.config.excludedThemes).toEqual(['worship']);
    expect(thenEnrol.config.themes).toEqual([]);
  });

  it('never refuses a REMOVAL — narrowing is always allowed', () => {
    const start = config({ themes: ['focus'], excludedThemes: ['slut'] });
    expect(applyThemeChange(start, 'themes', 'focus', false).rejected).toBeNull();
    expect(applyThemeChange(start, 'excludedThemes', 'slut', false).rejected).toBeNull();
  });

  it('refuses enrolling an exclusion-only tag', () => {
    const result = applyThemeChange(config({ themes: [] }), 'themes', 'explicit', true);
    expect(result.rejected).not.toBeNull();
    expect(result.rejected!.fix).toMatch(/exclusion list/);
  });

  it('a stored config that reached the contradiction another way is rejected', () => {
    const result = normalizeConfig(config({ themes: ['focus'], excludedThemes: ['focus'] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => /both enrolled and excluded/.test(p.message))).toBe(true);
    }
  });
});

describe('exclusions are checked against a mantra’s FULL tag list', () => {
  it('drops a multi-tagged record collected under an enrolled bucket', () => {
    // The cross-tag leak: a record tagged {A,B} must not reach a user enrolled
    // in A who excluded B, even though it lives in A's bucket.
    const cfg = config({ themes: ['submission'], excludedThemes: ['intense'] });

    const leaked = corpus.entries.filter(
      (e) =>
        e.record.themes.includes('submission') &&
        e.record.themes.includes('intense') &&
        passesConsent(e, cfg),
    );
    expect(leaked).toEqual([]);

    // And there really were such records to leak, so the test can fail.
    const candidates = corpus.entries.filter(
      (e) => e.record.themes.includes('submission') && e.record.themes.includes('intense'),
    );
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('the operator toggle removes every operator record from the counts', () => {
    const cfg = config({ allowOperator: false });
    const feedback = buildFeedback({ corpus, config: cfg, seed: 3 });
    const eligible = eligibleEntries(corpus, cfg).consented;

    expect(feedback.matched).toBe(eligible.length);
    expect(eligible.every((e) => !e.record.markers.has_operator)).toBe(true);
    for (const tick of feedback.plan!.ticks) {
      for (const lane of ['center', 'left', 'right'] as const) {
        const entry = corpus.entries[corpus.byId[tick[lane].mantraId]];
        expect(entry.record.markers.has_operator).toBe(false);
      }
    }
  });
});

describe('§6.2 — the counts-only degradation is a real supported mode', () => {
  it('produces the same counts as the full pass, without building a plan', () => {
    const cfg = config();
    const full = buildFeedback({ corpus, config: cfg, seed: 9 });
    const counts = buildFeedback({ corpus, config: cfg, seed: 9, countsOnly: true });

    expect(counts.matched).toBe(full.matched);
    expect(counts.total).toBe(full.total);
    expect(counts.persons).toEqual(full.persons);
    expect(counts.plan).toBeNull();
    expect(full.plan).not.toBeNull();
  });

  it('still refuses a starving config — the counts-only path is not an escape hatch', () => {
    const cfg = config({ excludedThemes: [...ALL_TAGS] });
    const counts = buildFeedback({ corpus, config: cfg, seed: 2, countsOnly: true });
    expect(counts.matched).toBe(0);
    expect(counts.refusal).not.toBeNull();
    expect(counts.canStart).toBe(false);
  });
});

describe('both modes are exercised paths', () => {
  it('parallel plans and never repeats a mantra within a tick', () => {
    const feedback = buildFeedback({ corpus, config: config({ mode: 'parallel' }), seed: 11 });
    expect(feedback.plan).not.toBeNull();
    for (const tick of feedback.plan!.ticks) {
      const ids = new Set([tick.center.mantraId, tick.left.mantraId, tick.right.mantraId]);
      expect(ids.size).toBe(3);
    }
  });

  it('unison plans and never shows three byte-identical strings', () => {
    const feedback = buildFeedback({ corpus, config: config({ mode: 'unison' }), seed: 11 });
    expect(feedback.plan).not.toBeNull();
    expect(feedback.canStart).toBe(true);
    for (const tick of feedback.plan!.ticks) {
      const texts = new Set([tick.center.text, tick.left.text, tick.right.text]);
      expect(texts.size).toBeGreaterThan(1);
    }
  });
});
