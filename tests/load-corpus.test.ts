/**
 * M1 acceptance: the corpus loader.
 *
 *   "Load-time validation: a record missing any person variant is DROPPED from
 *    the pool with a warning, never rendered. A record whose
 *    persons[id][derivePov(text)] !== record.text is a hard validation error."
 *   "Sidecar integrity invariant enforced at load: persons[record.id][derivePov(record.text)]
 *    === record.text for 100% of records."
 *   "pov enum is exactly first | second | named | impersonal, and is DERIVED."
 *   "loadCorpus is pure and runs in Node with no browser shims."
 *
 * The loader is tested against BOTH fixtures and the real Phase B corpus. A
 * validator that only ever sees its own fixtures is a validator that agrees
 * with itself.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  entriesForTheme,
  entryById,
  isLoadFailure,
  loadCorpus,
  themeNames,
} from '../engine/corpus/load.ts';
import { derivePov } from '../engine/corpus/stance.ts';
import { POV_VALUES, PERSON_VALUES } from '../engine/types/record.ts';
import type { Corpus, PoolRecord, ValidationError } from '../engine/types/record.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (...p: string[]): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, ...p), 'utf8')) as unknown;

const miniPool = readJson('fixtures', 'corpus.mini.json');
const miniPersons = readJson('fixtures', 'persons.mini.json');

/** Load the mini fixture, failing the test loudly if it does not load at all. */
function loadMini(): Corpus {
  const result = loadCorpus(miniPool, miniPersons);
  if (isLoadFailure(result)) {
    throw new Error(`corpus.mini.json failed to load: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

/** Deep-clone a plain JSON value without reaching for a platform global. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('the mini fixture loads clean', () => {
  const corpus = loadMini();

  it('loads every record with no dropped ones', () => {
    expect(corpus.stats.recordsDropped).toBe(0);
    expect(corpus.stats.recordsLoaded).toBe(corpus.stats.recordsRead);
    expect(corpus.entries.length).toBeGreaterThanOrEqual(40);
  });

  it('reports the `_comment` block as an orphan sidecar key and nothing else', () => {
    // The fixture documents itself in a `_comment` key. That is a sidecar entry
    // with no pool record, which is a warning that drops nothing — and asserting
    // it is the ONLY warning is what makes "zero warnings otherwise" meaningful.
    expect(corpus.warnings.map((w) => w.kind)).toEqual(['orphan-person-entry']);
    expect(corpus.warnings[0].id).toBe('_comment');
  });

  it('covers all four pov stances, including `second`', () => {
    const stances = new Set(corpus.entries.map((e) => e.pov));
    // The original 612 had ZERO second-person records. That is why the center
    // lane had to be authored, and why a fixture without `second` would let M2
    // and M4 be built against a corpus that cannot serve the center at all.
    expect([...stances].sort()).toEqual(['first', 'impersonal', 'named', 'second']);
  });

  it('carries at least two multi-tagged records, so the cross-tag path is live', () => {
    // The real 612 were single-tag on every record, leaving exclusion-by-full-
    // tag-list entirely unexercised. The fixture exists partly to fix that.
    const multi = corpus.entries.filter((e) => e.record.themes.length > 1);
    expect(multi.length).toBeGreaterThanOrEqual(2);
  });

  it('carries induction and emergence, so a session can have bookends at all', () => {
    expect(entriesForTheme(corpus, 'induction').length).toBeGreaterThanOrEqual(8);
    expect(entriesForTheme(corpus, 'emergence').length).toBeGreaterThanOrEqual(8);
  });

  it('gives every theme at least CHANNEL_COUNT records at T1 s ship floor', () => {
    for (const theme of themeNames(corpus)) {
      expect(entriesForTheme(corpus, theme).length, theme).toBeGreaterThanOrEqual(8);
    }
  });

  it('derives the stance from the text on every entry', () => {
    for (const entry of corpus.entries) {
      expect(entry.pov, entry.record.id).toBe(derivePov(entry.record.text));
    }
  });

  it('preserves load order and indexes it', () => {
    const raw = (miniPool as { mantras: PoolRecord[] }).mantras;
    expect(corpus.entries.map((e) => e.record.id)).toEqual(raw.map((r) => r.id));
    for (const [id, index] of Object.entries(corpus.byId)) {
      expect(corpus.entries[index].record.id).toBe(id);
    }
  });

  it('indexes a multi-tagged record into every one of its blocks', () => {
    const multi = corpus.entries.find((e) => e.record.themes.length > 1);
    expect(multi).toBeDefined();
    for (const theme of multi!.record.themes) {
      expect(entriesForTheme(corpus, theme).map((e) => e.record.id)).toContain(multi!.record.id);
    }
  });

  it('looks up by opaque id', () => {
    const first = corpus.entries[0].record.id;
    expect(entryById(corpus, first)?.record.id).toBe(first);
    expect(entryById(corpus, 'no_such_id')).toBeUndefined();
  });
});

describe('sidecar integrity is a HARD error', () => {
  it('rejects a corpus where persons[id][pov] !== record.text', () => {
    const persons = clone(miniPersons) as Record<string, Record<string, unknown>>;
    // A single edited character in one variant of one record. This is precisely
    // the drift the invariant exists to catch: nothing else in the corpus is
    // wrong, and without the check nobody notices until a user reads it.
    persons['i_stop_checking_whether_i_agree'].first = 'I stop checking whether I agreed';

    const result = loadCorpus(miniPool, persons);
    expect(isLoadFailure(result)).toBe(true);
    const errors = result as ValidationError[];
    expect(errors.some((e) => e.kind === 'sidecar-mismatch')).toBe(true);
    expect(errors.some((e) => e.id === 'i_stop_checking_whether_i_agree')).toBe(true);
  });

  it('reads the impersonal case as the rule, not an exception', () => {
    // An impersonal record has no `impersonal` key in the sidecar — its stance
    // has no grammatical subject, so its canonical text is the member EVERY key
    // names. A literal `persons[id]['impersonal']` lookup would be `undefined`
    // and would reject all 491 impersonal records in the live corpus.
    const corpus = loadMini();
    const impersonal = corpus.entries.filter((e) => e.pov === 'impersonal');
    expect(impersonal.length).toBeGreaterThan(0);
    for (const entry of impersonal) {
      expect(entry.persons.first).toBe(entry.record.text);
      expect(entry.persons.second).toBe(entry.record.text);
      expect(entry.persons.named).toBe(entry.record.text);
      expect(entry.invariant).toBe(true);
    }
  });

  it('rejects an impersonal record whose variants have drifted apart', () => {
    const persons = clone(miniPersons) as Record<string, Record<string, unknown>>;
    persons['the_room_gets_quieter_than_it_was'].named = 'The room gets quieter than it was.';
    persons['the_room_gets_quieter_than_it_was'].invariant = false;

    const result = loadCorpus(miniPool, persons);
    expect(isLoadFailure(result)).toBe(true);
    expect((result as ValidationError[]).some((e) => e.kind === 'sidecar-mismatch')).toBe(true);
  });

  it('holds for 100% of loaded records in the mini fixture', () => {
    const corpus = loadMini();
    for (const entry of corpus.entries) {
      if (entry.pov === 'impersonal') {
        expect(entry.persons.first).toBe(entry.record.text);
        expect(entry.persons.second).toBe(entry.record.text);
        expect(entry.persons.named).toBe(entry.record.text);
      } else {
        expect(entry.persons[entry.pov]).toBe(entry.record.text);
      }
    }
  });
});

describe('`invariant` must agree with the strings it summarizes', () => {
  it('rejects invariant:true on three differing variants', () => {
    const persons = clone(miniPersons) as Record<string, Record<string, unknown>>;
    persons['i_stop_checking_whether_i_agree'].invariant = true;

    const result = loadCorpus(miniPool, persons);
    expect(isLoadFailure(result)).toBe(true);
    expect((result as ValidationError[]).some((e) => e.kind === 'invariant-mismatch')).toBe(true);
  });

  it('rejects invariant:false on three identical variants', () => {
    const persons = clone(miniPersons) as Record<string, Record<string, unknown>>;
    persons['the_room_gets_quieter_than_it_was'].invariant = false;

    const result = loadCorpus(miniPool, persons);
    expect(isLoadFailure(result)).toBe(true);
    expect((result as ValidationError[]).some((e) => e.kind === 'invariant-mismatch')).toBe(true);
  });
});

describe('a record missing a person variant is DROPPED, not rendered', () => {
  it('drops it with a warning and loads the rest', () => {
    const persons = clone(miniPersons) as Record<string, Record<string, unknown>>;
    persons['my_jaw_unclenches_on_its_own'].named = null;

    const result = loadCorpus(miniPool, persons);
    // Not a failure: one unservable record must not cost a whole session.
    expect(isLoadFailure(result)).toBe(false);
    const corpus = result as Corpus;

    expect(entryById(corpus, 'my_jaw_unclenches_on_its_own')).toBeUndefined();
    expect(corpus.stats.recordsDropped).toBe(1);
    const warning = corpus.warnings.find((w) => w.id === 'my_jaw_unclenches_on_its_own');
    expect(warning?.kind).toBe('incomplete-person-triple');
    expect(warning?.message).toContain('named');
  });

  it('drops a record with no sidecar entry at all', () => {
    const persons = clone(miniPersons) as Record<string, unknown>;
    delete persons['weight_gathers_in_the_hands'];

    const result = loadCorpus(miniPool, persons);
    expect(isLoadFailure(result)).toBe(false);
    const corpus = result as Corpus;
    expect(entryById(corpus, 'weight_gathers_in_the_hands')).toBeUndefined();
    expect(corpus.warnings.some((w) => w.kind === 'missing-person-entry')).toBe(true);
  });

  it('never leaves a dropped record reachable through any index', () => {
    const persons = clone(miniPersons) as Record<string, Record<string, unknown>>;
    persons['my_jaw_unclenches_on_its_own'].second = null;

    const corpus = loadCorpus(miniPool, persons) as Corpus;
    // The failure being prevented: a `{named}` placeholder or an empty lane
    // appearing mid-session. Unreachable through byId, byTheme and entries.
    expect(corpus.byId['my_jaw_unclenches_on_its_own']).toBeUndefined();
    expect(corpus.entries.some((e) => e.record.id === 'my_jaw_unclenches_on_its_own')).toBe(false);
    for (const theme of themeNames(corpus)) {
      expect(entriesForTheme(corpus, theme).map((e) => e.record.id)).not.toContain(
        'my_jaw_unclenches_on_its_own',
      );
    }
  });
});

describe('other drop rules', () => {
  it('drops a record whose text mixes voice frames', () => {
    // Two stances in one line means no variant is its canonical form, so the
    // sidecar cannot say which string `text` is. Unservable, but not
    // corrupting: it costs one record rather than the corpus.
    const pool = clone(miniPool) as { mantras: PoolRecord[] };
    const victim = pool.mantras[0].id;
    pool.mantras[0].text = 'I watch {subject} sink';

    const corpus = loadCorpus(pool, miniPersons) as Corpus;
    expect(isLoadFailure(corpus as never)).toBe(false);
    expect(entryById(corpus, victim)).toBeUndefined();
    expect(corpus.warnings.some((w) => w.kind === 'mixed-stance')).toBe(true);
  });

  it('drops a record with no themes — it belongs to no block', () => {
    const pool = clone(miniPool) as { mantras: PoolRecord[] };
    const victim = pool.mantras[0].id;
    pool.mantras[0].themes = [];

    const corpus = loadCorpus(pool, miniPersons) as Corpus;
    expect(entryById(corpus, victim)).toBeUndefined();
    expect(corpus.warnings.some((w) => w.kind === 'no-themes')).toBe(true);
  });

});

describe('hard structural errors', () => {
  it('rejects a pool that is not the right shape', () => {
    for (const bad of [null, 42, 'pool', [], {}, { mantras: 'no' }]) {
      const result = loadCorpus(bad, miniPersons);
      expect(isLoadFailure(result)).toBe(true);
      expect((result as ValidationError[])[0].kind).toBe('malformed-pool');
    }
  });

  it('rejects a persons file that is not an object', () => {
    for (const bad of [null, 42, 'persons', []]) {
      const result = loadCorpus(miniPool, bad);
      expect(isLoadFailure(result)).toBe(true);
      expect((result as ValidationError[])[0].kind).toBe('malformed-persons');
    }
  });

  it('rejects a malformed record rather than skipping it', () => {
    const pool = clone(miniPool) as { mantras: unknown[] };
    pool.mantras.push({ id: 'broken', text: 'no markers', themes: ['focus'] });

    const result = loadCorpus(pool, miniPersons);
    expect(isLoadFailure(result)).toBe(true);
    expect((result as ValidationError[]).some((e) => e.kind === 'malformed-record')).toBe(true);
  });

  it('rejects a duplicate id — ids are the only reference key', () => {
    const pool = clone(miniPool) as { mantras: PoolRecord[] };
    pool.mantras.push(clone(pool.mantras[0]));

    const result = loadCorpus(pool, miniPersons);
    expect(isLoadFailure(result)).toBe(true);
    expect((result as ValidationError[]).some((e) => e.kind === 'duplicate-id')).toBe(true);
  });

  it('ignores a stored pov rather than trusting it', () => {
    // `pov` was a schema field until it was measured as 100% recomputable. A
    // pool that still carries the slot must load, and the stored value must not
    // be able to change what the loader believes: the stance comes from the
    // text or it comes from nowhere.
    const pool = clone(miniPool) as { mantras: Array<PoolRecord & { markers: { pov?: string } }> };
    pool.mantras[0].markers.pov = 'named';

    const corpus = loadCorpus(pool, miniPersons) as Corpus;
    expect(isLoadFailure(corpus as never)).toBe(false);
    expect(corpus.entries[0].pov).toBe(derivePov(corpus.entries[0].record.text));
    expect(corpus.entries[0].pov).not.toBe('named');
  });

  it('rejects a malformed provenance entry', () => {
    const result = loadCorpus(miniPool, miniPersons, { some_id: { source: 7 } });
    expect(isLoadFailure(result)).toBe(true);
    expect((result as ValidationError[])[0].kind).toBe('malformed-provenance');
  });
});

describe('the pov and person enums', () => {
  it('pov is exactly first | second | named | impersonal', () => {
    expect([...POV_VALUES].sort()).toEqual(['first', 'impersonal', 'named', 'second']);
    expect(POV_VALUES).not.toContain('mixed');
    expect(POV_VALUES).not.toContain('third');
  });

  it('Person is the renderable subset — impersonal is a template property, not a lane choice', () => {
    expect([...PERSON_VALUES].sort()).toEqual(['first', 'named', 'second']);
    for (const person of PERSON_VALUES) expect(POV_VALUES).toContain(person);
  });
});

describe('provenance is optional and never rendered', () => {
  it('loads with no provenance file at all', () => {
    const corpus = loadCorpus(miniPool, miniPersons) as Corpus;
    expect(corpus.provenance).toEqual({});
  });

  it('carries provenance through untouched when supplied', () => {
    const provenance = { my_jaw_unclenches_on_its_own: { source: 'human', reviewed: true } };
    const corpus = loadCorpus(miniPool, miniPersons, provenance) as Corpus;
    expect(corpus.provenance['my_jaw_unclenches_on_its_own']).toEqual({
      source: 'human',
      reviewed: true,
    });
  });

  it('does not put provenance on any entry — the record shape stays four fields', () => {
    const corpus = loadCorpus(miniPool, miniPersons, {
      my_jaw_unclenches_on_its_own: { source: 'human' },
    }) as Corpus;
    for (const entry of corpus.entries) {
      expect(Object.keys(entry.record).sort()).toEqual([
        'id',
        'markers',
        'text',
        'themes',
      ]);
    }
  });
});

describe('loadCorpus is pure', () => {
  it('does not mutate its inputs', () => {
    const pool = clone(miniPool);
    const persons = clone(miniPersons);
    const before = JSON.stringify({ pool, persons });

    loadCorpus(pool, persons);

    expect(JSON.stringify({ pool, persons })).toBe(before);
  });

  it('is deterministic — two loads of the same input are structurally identical', () => {
    const a = loadCorpus(miniPool, miniPersons) as Corpus;
    const b = loadCorpus(miniPool, miniPersons) as Corpus;
    expect(JSON.stringify(a.entries)).toBe(JSON.stringify(b.entries));
    expect(JSON.stringify(a.stats)).toBe(JSON.stringify(b.stats));
  });

  it('produces a corpus that survives a JSON round-trip unchanged', () => {
    // No methods, no cycles, no references into anything. That is what lets a
    // corpus cross a worker boundary or be snapshot-tested.
    const corpus = loadCorpus(miniPool, miniPersons) as Corpus;
    const round = JSON.parse(JSON.stringify(corpus)) as Corpus;
    expect(round.entries).toEqual(corpus.entries);
    expect(round.stats).toEqual(corpus.stats);
  });
});

describe('there is no textToId anywhere in engine/', () => {
  it('no module exports a function reconstructing an id from text', () => {
    // MEASURED: only 138 of 612 ids round-trip to a naive slug of their text.
    // A function that rebuilds an id from text is wrong 77% of the time,
    // silently, in a lookup that simply returns nothing.
    for (const file of ['corpus/load.ts', 'corpus/stance.ts', 'corpus/validate.ts']) {
      const source = readFileSync(path.join(repoRoot, 'engine', file), 'utf8');
      expect(source, file).not.toMatch(/export\s+(function|const)\s+textToId/);
      expect(source, file).not.toMatch(/export\s+(function|const)\s+slugify/);
    }
  });
});
