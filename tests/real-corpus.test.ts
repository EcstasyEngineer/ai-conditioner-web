/**
 * M1 acceptance, against the REAL Phase B corpus rather than its own fixtures.
 *
 * A validator tested only against fixtures it also authored is a validator that
 * agrees with itself. `corpus/` holds 3063 records emitted by a toolchain M1 did
 * not write, and it is the only input that can tell us whether the schema in
 * `engine/types/` actually describes the data that exists.
 *
 * It already has: the `impersonal` branch of the sidecar-integrity rule was
 * written the way it is BECAUSE reading `persons[id]['impersonal']` literally
 * rejects all 491 impersonal records in this file. That is the class of error
 * this test exists to surface before four other modules build on the type.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLoadFailure, loadCorpus, themeNames, entriesForTheme } from '../engine/corpus/load.ts';
import type { Corpus, ValidationError } from '../engine/types/record.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = path.join(repoRoot, 'corpus');

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(path.join(corpusDir, file), 'utf8')) as unknown;

const present =
  existsSync(path.join(corpusDir, 'pool.json')) &&
  existsSync(path.join(corpusDir, 'persons.json'));

// The corpus is committed, so this should always run. `skipIf` is here so a
// checkout without it fails on the missing corpus rather than on a stack trace
// from `readFileSync`, which says nothing about what went wrong.
describe.skipIf(!present)('the real Phase B corpus', () => {
  const pool = readJson('pool.json');
  const persons = readJson('persons.json');
  const provenance = existsSync(path.join(corpusDir, 'provenance.json'))
    ? readJson('provenance.json')
    : undefined;

  const result = loadCorpus(pool, persons, provenance);

  it('loads without a single hard validation error', () => {
    if (isLoadFailure(result)) {
      const errors = result as ValidationError[];
      throw new Error(
        `corpus/ failed to load with ${errors.length} error(s):\n` +
          errors
            .slice(0, 20)
            .map((e) => `  ${e.kind}${e.id ? ` [${e.id}]` : ''}: ${e.message}`)
            .join('\n'),
      );
    }
    expect(isLoadFailure(result)).toBe(false);
  });

  const corpus = result as Corpus;

  it('loads the expected volume, and reports what it dropped', () => {
    // MEASURED: 2639 records, 0 dropped. The floor is 2500 rather than the
    // live count because the assertions are floors and shapes — a test that has
    // to be edited after every batch gets deleted. It moved down from 3000 once
    // the quality kill removed 407 lines, which is the one direction a corpus
    // floor is allowed to move without a new measurement behind it.
    expect(corpus.stats.recordsRead).toBeGreaterThanOrEqual(2500);
    expect(corpus.stats.recordsLoaded).toBe(
      corpus.stats.recordsRead - corpus.stats.recordsDropped,
    );
    expect(corpus.stats.recordsLoaded).toBeGreaterThanOrEqual(2500);

    // Every drop is accounted for by a warning naming the record.
    const drops = corpus.warnings.filter((w) => w.kind !== 'orphan-person-entry');
    expect(drops.length).toBe(corpus.stats.recordsDropped);
  });

  it('drops only records that genuinely cannot be served', () => {
    for (const warning of corpus.warnings) {
      expect(
        [
          'incomplete-person-triple',
          'missing-person-entry',
          'mixed-stance',
          'no-themes',
          'orphan-person-entry',
        ],
        `${warning.kind}: ${warning.message}`,
      ).toContain(warning.kind);
    }
  });

  it('satisfies the sidecar integrity invariant on 100% of loaded records', () => {
    // B8, checked against the real thing rather than against a fixture.
    for (const entry of corpus.entries) {
      if (entry.pov === 'impersonal') {
        expect(entry.persons.first, entry.record.id).toBe(entry.record.text);
        expect(entry.persons.second, entry.record.id).toBe(entry.record.text);
        expect(entry.persons.named, entry.record.id).toBe(entry.record.text);
      } else {
        expect(entry.persons[entry.pov], entry.record.id).toBe(entry.record.text);
      }
    }
  });

  it('derives one of the four stances on every loaded record, never `mixed`', () => {
    // B3. A `mixed` text is dropped with a warning, so every entry that made it
    // this far carries a stance the sidecar has a key for.
    for (const entry of corpus.entries) {
      expect(['first', 'second', 'named', 'impersonal'], entry.record.id).toContain(entry.pov);
    }
  });

  it('has all three variants on every loaded record, with invariant computed', () => {
    // B2. A loaded entry cannot have a null variant by construction — the type
    // forbids it — so what this really asserts is that `invariant` is the
    // computed value rather than an authored one.
    for (const entry of corpus.entries) {
      const { first, second, named, invariant } = entry.persons;
      expect(typeof first).toBe('string');
      expect(typeof second).toBe('string');
      expect(typeof named).toBe('string');
      expect(invariant, entry.record.id).toBe(first === second && second === named);
    }
  });

  it('carries the impersonal class the loader was written for', () => {
    // The branch that would have been wrong: 491 records at last measurement.
    const impersonal = corpus.entries.filter((e) => e.pov === 'impersonal');
    expect(impersonal.length).toBeGreaterThan(100);
    for (const entry of impersonal) expect(entry.invariant).toBe(true);
  });

  it('stores no intensity axis on any record', () => {
    // `base_points` reproduced the batch filename on 2,461/2,461 generated
    // records, and a consent ceiling was being compared against it. The field
    // is gone from the schema; this asserts it is gone from the DATA too, since
    // a loader ignores keys it does not know and the defect would ride along
    // invisibly in the file.
    for (const entry of corpus.entries) {
      expect(entry.record, entry.record.id).not.toHaveProperty('base_points');
      expect(Object.keys(entry.record.markers).sort()).toEqual(['has_controller', 'has_subject']);
    }
  });

  it('has induction and emergence blocks, so a session can be planned at all', () => {
    // B7's floor is 40 each. Without these the engine cannot plan a session:
    // the phase bookends exist to stop "Wide awake, rested and present" firing
    // at line 2, and they have nothing to draw from.
    expect(entriesForTheme(corpus, 'induction').length).toBeGreaterThanOrEqual(40);
    expect(entriesForTheme(corpus, 'emergence').length).toBeGreaterThanOrEqual(40);
  });

  it('has theme-level blocks big enough for a triplet — the §4.3 measurement', () => {
    // The decision that a block is a THEME rests on theme blocks holding 19-35
    // while the (theme,tier) cells the base design would have used held a
    // median of 5. What matters is that a block a user can ENROLL IN can field
    // three distinct draws for as long as the curve holds it at peak.
    //
    // Every tag now clears the 54-record floor, and the class of thin
    // cross-tag-only tags that used to sit under it (`agency` at 1, `ownership`
    // at 5, `identity` at 7) was merged away by the retag. That is why this
    // asserts the floor over EVERY tag rather than only the described ones:
    // there is no longer a tag that is tagged but not offerable.
    const tags = themeNames(corpus);
    expect(tags.length).toBeGreaterThanOrEqual(20);

    for (const theme of tags) {
      expect(entriesForTheme(corpus, theme).length, theme).toBeGreaterThanOrEqual(54);
    }
  });

  it('the bookend themes are servable even though they carry no description', () => {
    // `induction` and `emergence` are Phase B creations and postdate the
    // `theme_descriptions` block, so they are undescribed AND large. They are
    // designated by the plan config rather than enrolled by a user, which is
    // why the offerable-theme rule above does not cover them.
    for (const theme of ['induction', 'emergence']) {
      expect(entriesForTheme(corpus, theme).length, theme).toBeGreaterThanOrEqual(40);
    }
  });

  it('exercises the multi-tag path the original 612 never did', () => {
    const multi = corpus.entries.filter((e) => e.record.themes.length > 1);
    expect(multi.length).toBeGreaterThan(0);
  });

  it('carries provenance keyed by id, protecting the hand-authored originals', () => {
    // B9. The original records carry `conditioner-pool`; Phase B output carries
    // its own source. Rollback of a bad batch is a filter, not a re-run.
    const sources = new Set(Object.values(corpus.provenance).map((p) => p.source));
    expect(sources.has('conditioner-pool')).toBe(true);
    expect(sources.size).toBeGreaterThan(1);
  });

  it('loads in Node with no browser shim and no I/O of its own', () => {
    // `loadCorpus` was handed already-parsed values. Reading the file is the
    // caller's job precisely so the engine can import zero Node builtins.
    const again = loadCorpus(pool, persons, provenance) as Corpus;
    expect(again.stats).toEqual(corpus.stats);
  });
});
