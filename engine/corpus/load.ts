/**
 * The corpus loader — DESIGN.md §2.1, §2.3, §6.7.
 *
 * `loadCorpus` takes three already-parsed JSON values and returns either a
 * validated `Corpus` or the list of reasons it could not build one. It performs
 * no I/O: reading a file is the caller's job, in `web/` or `tools/`, because the
 * engine may not import a Node builtin or touch `fetch` (§1.3). That is what
 * makes it run identically in Node and in the browser with no shim.
 *
 * There is deliberately NO `textToId` exported from this module or any other.
 * MEASURED: only 138 of the original 612 ids round-trip to a naive slug of
 * their text. A function that reconstructs an id from text would be wrong 77%
 * of the time, silently, in a lookup that returns nothing.
 *
 * Order is preserved exactly. The corpus is order-dependent — meter and rhyme
 * adjacency are authored properties — so the loader never sorts and never
 * shuffles. `byTheme` holds indices in load order for the same reason.
 */

import type {
  CompletePersonTriple,
  Corpus,
  CorpusEntry,
  PersonTriple,
  PersonsFile,
  Pool,
  PoolRecord,
  Provenance,
  ProvenanceFile,
  ValidationError,
  ValidationWarning,
} from '../types/record.ts';
import { derivePov } from './stance.ts';
import {
  checkInvariantFlag,
  checkSidecarIntegrity,
  error,
  validatePersonTriple,
  validatePoolRecord,
  validateProvenance,
  warning,
} from './validate.ts';

/** True when the value is a plain object (not an array, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A `Corpus` or the reasons there is not one.
 *
 * Returned as a union rather than thrown so the setup screen can render every
 * problem at once instead of the first one — and so a caller cannot forget to
 * handle it, which a `throw` invites.
 */
export type LoadResult = Corpus | ValidationError[];

/** Narrowing helper so callers read as `if (isLoadFailure(result))`. */
export function isLoadFailure(result: LoadResult): result is ValidationError[] {
  return Array.isArray(result);
}

/**
 * Validate and index a corpus.
 *
 * @param poolJson       parsed `pool.json` — conditioner's exact shape
 * @param personsJson    parsed `persons.json` — the person sidecar
 * @param provenanceJson parsed `provenance.json`, optional and never rendered
 *
 * Errors (no corpus is returned):
 *   - either required file is not the shape the schema describes
 *   - a record is not a `PoolRecord`
 *   - two records share an id
 *   - `persons[id][derivePov(record.text)] !== record.text` (§2.3)
 *   - `invariant` disagrees with the three strings it summarizes
 *
 * Warnings (the record is DROPPED, the corpus loads — §6.7):
 *   - no sidecar entry for the id
 *   - a `null` variant in the triple
 *   - `text` mixes voice frames, so it has no canonical variant
 *   - `themes` empty — the record belongs to no block and can never be drawn
 *   - a sidecar key with no pool record (reported, drops nothing)
 */
export function loadCorpus(
  poolJson: unknown,
  personsJson: unknown,
  provenanceJson?: unknown,
): LoadResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // ---- shape of the files themselves -------------------------------------

  if (!isPlainObject(poolJson) || !Array.isArray(poolJson.mantras)) {
    errors.push(error('malformed-pool', 'pool.json must be an object with a `mantras` array'));
  }
  if (!isPlainObject(personsJson)) {
    errors.push(error('malformed-persons', 'persons.json must be an object keyed by mantra id'));
  }
  if (provenanceJson !== undefined && provenanceJson !== null && !isPlainObject(provenanceJson)) {
    errors.push(
      error('malformed-provenance', 'provenance.json must be an object keyed by mantra id'),
    );
  }
  // Nothing below can run against a file of the wrong shape, and reporting
  // "record 0 is malformed" 3000 times would bury the real finding.
  if (errors.length > 0) return errors;

  const pool = poolJson as unknown as Pool;
  const persons = personsJson as unknown as PersonsFile;
  const provenanceIn = (provenanceJson ?? {}) as ProvenanceFile;

  const themeDescriptions = isPlainObject(pool.theme_descriptions)
    ? (pool.theme_descriptions as Record<string, string>)
    : {};

  // ---- records ------------------------------------------------------------

  const entries: CorpusEntry[] = [];
  const byId: Record<string, number> = Object.create(null) as Record<string, number>;
  const byTheme: Record<string, number[]> = Object.create(null) as Record<string, number[]>;
  const seenIds = new Set<string>();
  const claimedPersonKeys = new Set<string>();

  const raw = pool.mantras as unknown[];

  for (let index = 0; index < raw.length; index += 1) {
    const candidate = raw[index];

    if (!validatePoolRecord(candidate)) {
      errors.push(
        error('malformed-record', `record at index ${index} is not a valid pool record`, { index }),
      );
      continue;
    }
    const record: PoolRecord = candidate;

    // An id collision is unrecoverable rather than droppable: ids are the only
    // reference key, so two records under one id means every lookup is a coin
    // flip and the sidecar cannot say which one it describes.
    if (seenIds.has(record.id)) {
      errors.push(
        error('duplicate-id', `duplicate record id ${JSON.stringify(record.id)}`, {
          id: record.id,
          index,
        }),
      );
      continue;
    }
    seenIds.add(record.id);

    const tripleRaw: unknown = Object.prototype.hasOwnProperty.call(persons, record.id)
      ? persons[record.id]
      : undefined;

    if (tripleRaw === undefined) {
      warnings.push(
        warning('missing-person-entry', `no persons entry for ${JSON.stringify(record.id)}; dropped`, {
          id: record.id,
          index,
        }),
      );
      continue;
    }
    claimedPersonKeys.add(record.id);

    if (!validatePersonTriple(tripleRaw)) {
      errors.push(
        error(
          'malformed-persons',
          `persons entry for ${JSON.stringify(record.id)} is not a valid person triple`,
          { id: record.id, index },
        ),
      );
      continue;
    }
    const triple: PersonTriple = tripleRaw;

    // `invariant` is computed at ingest; a disagreement means a second emitter
    // wrote this file, and the flag is what `unison` refuses on (§4.7).
    const invariantProblem = checkInvariantFlag(triple);
    if (invariantProblem !== null) {
      errors.push(
        error('invariant-mismatch', `${record.id}: ${invariantProblem}`, { id: record.id, index }),
      );
      continue;
    }

    // §6.7: a record missing a variant is dropped at LOAD-TIME VALIDATION and
    // never rendered. The failure being prevented is a `{named}` placeholder or
    // an empty lane appearing mid-session.
    if (triple.first === null || triple.second === null || triple.named === null) {
      const missing = (['first', 'second', 'named'] as const).filter((k) => triple[k] === null);
      warnings.push(
        warning(
          'incomplete-person-triple',
          `${record.id} is missing the ${missing.join('/')} variant${missing.length > 1 ? 's' : ''}; dropped`,
          { id: record.id, index },
        ),
      );
      continue;
    }

    // Two voice frames in one line means no variant is its canonical form, so
    // there is no way to say which one the pool's string is. Unservable, but
    // not corrupting: the rest of the corpus is unaffected.
    const pov = derivePov(record.text);
    if (pov === 'mixed') {
      warnings.push(
        warning('mixed-stance', `${record.id} mixes voice frames; dropped`, {
          id: record.id,
          index,
        }),
      );
      continue;
    }

    // §2.3's hard invariant. Checked AFTER completeness so a partially
    // backfilled record is reported as incomplete rather than as a mismatch.
    const integrityProblem = checkSidecarIntegrity(record, triple);
    if (integrityProblem !== null) {
      errors.push(error('sidecar-mismatch', integrityProblem, { id: record.id, index }));
      continue;
    }

    if (record.themes.length === 0) {
      warnings.push(
        warning('no-themes', `${record.id} has no themes; it belongs to no block and was dropped`, {
          id: record.id,
          index,
        }),
      );
      continue;
    }

    const complete: CompletePersonTriple = {
      first: triple.first,
      second: triple.second,
      named: triple.named,
      invariant: triple.invariant,
    };

    const entry: CorpusEntry = {
      record,
      persons: complete,
      pov,
      invariant: triple.invariant,
    };

    const at = entries.length;
    entries.push(entry);
    byId[record.id] = at;

    // A record tagged {A,B} lands in BOTH blocks. That is the multi-tag path,
    // and it is also what makes exclusion check the full tag list rather than
    // the bucket a mantra was collected under (§2.6).
    for (const theme of record.themes) {
      const bucket = byTheme[theme];
      if (bucket === undefined) byTheme[theme] = [at];
      else bucket.push(at);
    }
  }

  if (errors.length > 0) return errors;

  // ---- sidecar keys with no record ---------------------------------------

  for (const key of Object.keys(persons)) {
    if (!claimedPersonKeys.has(key)) {
      warnings.push(
        warning('orphan-person-entry', `persons entry ${JSON.stringify(key)} has no pool record`, {
          id: key,
        }),
      );
    }
  }

  // ---- provenance ---------------------------------------------------------

  const provenance: ProvenanceFile = Object.create(null) as ProvenanceFile;
  for (const key of Object.keys(provenanceIn)) {
    const value: unknown = provenanceIn[key];
    if (!validateProvenance(value)) {
      errors.push(
        error('malformed-provenance', `provenance entry ${JSON.stringify(key)} is malformed`, {
          id: key,
        }),
      );
      continue;
    }
    provenance[key] = value as Provenance;
  }

  if (errors.length > 0) return errors;

  return {
    entries,
    byId,
    byTheme,
    themeDescriptions,
    provenance,
    warnings,
    stats: {
      recordsRead: raw.length,
      recordsLoaded: entries.length,
      recordsDropped: raw.length - entries.length,
      themeCount: Object.keys(byTheme).length,
    },
  };
}

/** Look a record up by its opaque id. `undefined` when the id is not in the corpus. */
export function entryById(corpus: Corpus, id: string): CorpusEntry | undefined {
  const index = corpus.byId[id];
  return index === undefined ? undefined : corpus.entries[index];
}

/**
 * Every entry tagged with a theme, in load order.
 *
 * A block IS a theme (§4.3). MEASURED, the per-(theme,tier) cells the base
 * design would have used as blocks held a median of 5 records, against 19-35 at
 * theme level, and a triplet at peak dwell needs far more than 5 distinct
 * draws. That measurement outlived the tier axis it was taken against: blocks
 * are themes, and there is no second dimension to subdivide them by.
 */
export function entriesForTheme(corpus: Corpus, theme: string): CorpusEntry[] {
  const indices = corpus.byTheme[theme];
  if (indices === undefined) return [];
  return indices.map((i) => corpus.entries[i]);
}

/** Themes with at least one loaded record, in first-appearance order. */
export function themeNames(corpus: Corpus): string[] {
  return Object.keys(corpus.byTheme);
}
