/**
 * The corpus record shape — DESIGN.md §2.1, §2.2, §2.3, §2.5.
 *
 * These types are owned by M1 and by nothing else. Every other module imports
 * them; no module redefines them. The pool half is byte-compatible with
 * conditioner's schema so a regeneration from upstream stays a straight copy,
 * and everything hypnoapp adds lives in a sidecar keyed by the opaque id.
 *
 * There is deliberately NO `textToId` here, and there must never be one.
 * MEASURED: only 138 of the original 612 ids round-trip to a naive slug of
 * their text, so any code that reconstructs an id from text is wrong 77% of the
 * time — silently, at read time, in a lookup that returns nothing.
 */

/**
 * The stance of the stored `text` — DESIGN.md §2.2.
 *
 * This is the person the canonical template is WRITTEN in, not the person it
 * renders as on a given lane. `named` rather than `third` preserves
 * conditioner's own coined term for the voice frame ("Named Self"); the
 * renderer knows `named` renders as third person.
 *
 * `mixed` is deliberately not a value. MEASURED: zero of the original 612
 * records need it, and forbidding it keeps the person transformation total —
 * every record maps to a complete triple with no case needing adjudication.
 */
export type Pov = 'first' | 'second' | 'named' | 'impersonal';

/** Every `Pov`, as a value, for validation and exhaustiveness checks. */
export const POV_VALUES: readonly Pov[] = ['first', 'second', 'named', 'impersonal'] as const;

/**
 * A person a lane can render in — DESIGN.md §4.6.
 *
 * A strict subset of `Pov`: `impersonal` is a property of the stored template,
 * not a rendering choice. An impersonal record is served by rendering any of
 * the three (they are byte-identical), never by asking for "the impersonal
 * variant" — the sidecar has no such key.
 */
export type Person = 'first' | 'second' | 'named';

/** Every `Person`, as a value. */
export const PERSON_VALUES: readonly Person[] = ['first', 'second', 'named'] as const;

/**
 * Marker flags — DESIGN.md §2.1.
 *
 * Exactly the two that are live signals and cannot drift, because each is a
 * substring test against the text it describes. `has_operator` is a consent
 * filter; `has_subject` drives person-variant rendering.
 *
 * Three sibling fields were deleted rather than kept as reserved slots.
 * `permanence` and `identity` measured true on 0 of 2,639 records, and a
 * constant is not data. `pov` is 100% recomputable from `text` (see
 * `corpus/stance.ts`), its `second` value had zero instances, and its one
 * load-bearing distinction — person-free — is carried by `PersonTriple.invariant`.
 * The object stays open for additive keys.
 */
export interface Markers {
  has_operator: boolean;
  has_subject: boolean;
}

/**
 * One mantra as stored — DESIGN.md §2.1. Exactly four fields, no more.
 *
 * `text` is a RAW TEMPLATE and is never rendered at rest. Substitution happens
 * at display time (M3), so renaming an operator retroactively re-renders even
 * content already in flight.
 */
export interface PoolRecord {
  /** Opaque, stable, and the only reference key. Never derived from `text`. */
  id: string;
  /** The raw template. Its stance is derived by `derivePov`, never stored. */
  text: string;
  /** Tags, N of them. Exclusions check this FULL list, not a collection bucket. */
  themes: string[];
  markers: Markers;
}

/**
 * The person sidecar — DESIGN.md §2.3.
 *
 * Pre-rendered at authoring time, not conjugated at runtime. The only runtime
 * conjugator in the ecosystem is structurally broken, and a bad authored
 * variant is a diffable line caught by a lint rule, where a bad runtime variant
 * appears mid-session in front of a user.
 *
 * A variant is `null` only in a partially-backfilled corpus. Such a record is
 * DROPPED at load with a warning rather than rendered with a hole in it.
 *
 * `invariant` is true exactly when all three strings are equal. COMPUTED at
 * ingest, never authored — it is what lets a side lane use a record without
 * exposing the person axis at all.
 */
export interface PersonTriple {
  first: string | null;
  second: string | null;
  named: string | null;
  invariant: boolean;
}

/** A `PersonTriple` that survived load validation: all three variants present. */
export interface CompletePersonTriple {
  first: string;
  second: string;
  named: string;
  invariant: boolean;
}

/**
 * Batch provenance — DESIGN.md §2.5. A third sidecar, so §2.1's
 * byte-compatibility holds.
 *
 * Optional, ignored at runtime, never rendered. It exists so that when a bad
 * generation batch is found, partial rollback is a one-line filter rather than
 * a re-run of everything — and so the hand-authored originals are protected
 * absolutely.
 */
export interface Provenance {
  source: string;
  batch?: string | null;
  model?: string | null;
  generated_at?: string | null;
  reviewed?: boolean;
}

/** `pool.json` as it sits on disk — conditioner's exact shape. */
export interface Pool {
  mantras: PoolRecord[];
  /**
   * Prose per theme, for the setup screen. Deliberately NOT required to be
   * total: MEASURED the live pool tags 29 distinct themes and describes 22, and
   * a missing description is a copy gap, not a load failure.
   */
  theme_descriptions: Record<string, string>;
}

/** `persons.json` as it sits on disk. */
export type PersonsFile = Record<string, PersonTriple>;

/** `provenance.json` as it sits on disk. */
export type ProvenanceFile = Record<string, Provenance>;

/**
 * A record that passed load validation, with its variants attached.
 *
 * This is what the planner draws from. Reaching the sidecar through a separate
 * lookup is not possible from here on: a `CorpusEntry` cannot exist without a
 * complete triple, so "record missing a variant" is unrepresentable downstream
 * rather than checked repeatedly.
 */
export interface CorpusEntry {
  record: PoolRecord;
  persons: CompletePersonTriple;
  /** Derived once at load from `record.text`. Never `mixed`: those are dropped. */
  pov: Pov;
  /** Mirrors `persons.invariant`, hoisted for the drift-pivot scheduler (§4.6). */
  invariant: boolean;
}

/**
 * The loaded, validated corpus — the value every downstream module consumes.
 *
 * Plain data, structurally cloneable, with no methods: it can cross a worker
 * boundary, be snapshot-tested, or be written to a file unchanged.
 */
export interface Corpus {
  /** Load order preserved exactly. The corpus is order-dependent (meter/rhyme adjacency). */
  entries: CorpusEntry[];
  /** id -> index into `entries`. Built once so lookup is not a linear scan. */
  byId: Record<string, number>;
  /** theme -> indices into `entries`, in load order. A theme IS a block (§4.3). */
  byTheme: Record<string, number[]>;
  /** Prose per theme, as loaded. May be missing keys that `byTheme` has. */
  themeDescriptions: Record<string, string>;
  /** Optional, keyed by id. Present only when a provenance file was supplied. */
  provenance: ProvenanceFile;
  /** Non-fatal load findings — dropped records and their reasons. */
  warnings: ValidationWarning[];
  /** Counts, so a caller can assert on what it actually got. */
  stats: CorpusStats;
}

export interface CorpusStats {
  /** Records present in the pool file before validation. */
  recordsRead: number;
  /** Records that survived into `entries`. */
  recordsLoaded: number;
  /** Records dropped by a warning-level rule. */
  recordsDropped: number;
  /** Distinct themes with at least one loaded record. */
  themeCount: number;
}

/**
 * A hard load failure — DESIGN.md §2.6, §4.2 ("parse-time hard errors over
 * silent guesses").
 *
 * `loadCorpus` returns `ValidationError[]` instead of a `Corpus` when any of
 * these fire. A malformed corpus is not partially loaded: an app that starts
 * against a broken sidecar is an app that shows the wrong grammatical person to
 * a user mid-session.
 */
export interface ValidationError {
  kind: ValidationErrorKind;
  message: string;
  /** The record id, when the failure is attributable to one. */
  id?: string;
  /** Where in the input the failure sits, when it is positional. */
  index?: number;
}

export type ValidationErrorKind =
  /** The file is not the shape the schema describes at all. */
  | 'malformed-pool'
  | 'malformed-persons'
  | 'malformed-provenance'
  /** A record is not a `PoolRecord`. */
  | 'malformed-record'
  /** Two records share an id. Ids are the only reference key; duplicates are unrecoverable. */
  | 'duplicate-id'
  /** `persons[id][record.markers.pov] !== record.text` — DESIGN.md §2.3. */
  | 'sidecar-mismatch'
  /** `invariant` disagrees with the three strings it summarizes. */
  | 'invariant-mismatch'
  /** A stance was derived that is not one of the four. Unreachable by construction. */
  | 'bad-pov';

/**
 * A non-fatal load finding — DESIGN.md §6.7 ("dropped from the pool at
 * load-time validation with a console warning; never rendered").
 *
 * The distinction from `ValidationError` is deliberate and behavioral:
 * a warning means "this record cannot be served, the rest of the corpus can";
 * an error means "this corpus cannot be trusted at all".
 */
export interface ValidationWarning {
  kind: ValidationWarningKind;
  message: string;
  id?: string;
  index?: number;
}

export type ValidationWarningKind =
  /** No entry in `persons.json` for this id. */
  | 'missing-person-entry'
  /** One or more of first/second/named is `null`. */
  | 'incomplete-person-triple'
  /** `text` mixes voice frames, so no single variant is its canonical form. */
  | 'mixed-stance'
  /** `themes` is empty; the record belongs to no block and can never be drawn. */
  | 'no-themes'
  /** A `persons.json` key with no matching pool record. Harmless, reported. */
  | 'orphan-person-entry';
