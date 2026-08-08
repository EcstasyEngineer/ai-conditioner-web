/**
 * Corpus types — CORPUS_SPEC.md §5, §6.
 *
 * Node-only. Nothing in tools/ may import DOM types or be imported by the
 * browser bundle (MODULES.json M5: "Firewalled ... NEVER imported by the
 * browser bundle").
 */

export type Person = 'first' | 'second' | 'named';

/**
 * §4.2 — the four stances. `mixed` is deliberately not a value.
 *
 * DERIVED from text by `derivePov`, and deliberately NOT a stored field: it is
 * 100% recomputable, its `second` value has zero instances in the corpus, and
 * its one load-bearing distinction — person-free — is stored as
 * `persons[id].invariant` instead.
 */
export type Pov = 'first' | 'second' | 'named' | 'impersonal';

/**
 * §5.1 markers. Exactly the two that are live signals and cannot drift, because
 * each is a substring test against the text it describes.
 *
 * `permanence` and `identity` were reserved slots that measured true on 0 of
 * 2,639 records, and a constant is not data. `pov` is derived (see `Pov`).
 */
export interface Markers {
  has_operator: boolean;
  has_subject: boolean;
}

/** §6.3 — conditioner's exact record shape. Key order is load-bearing. */
export interface PoolRecord {
  id: string;
  text: string;
  themes: string[];
  markers: Markers;
}

export interface Pool {
  mantras: PoolRecord[];
  theme_descriptions: Record<string, string>;
}

/**
 * §6.3 sidecar. A variant is `null` only for records imported from a source
 * that carried a single rendering (the original 612); Phase B backfill fills
 * them. `invariant` is computed (all three present and equal), never authored.
 */
export interface PersonTriple {
  first: string | null;
  second: string | null;
  named: string | null;
  invariant: boolean;
}

export interface Provenance {
  source: string;
  batch: string | null;
  model: string | null;
  generated_at: string | null;
  reviewed: boolean;
}

/** Line 1 of a generation batch — §6.1. */
export interface BatchHeader {
  schema: 'hypnoapp.corpus.v1';
  theme: string;
  generator?: {
    model?: string;
    prompt_sha?: string;
    generated_at?: string;
    batch?: string;
  };
}

/** Line 1 of a backfill batch — attaches variants to existing records. */
export interface BackfillHeader {
  schema: 'hypnoapp.corpus.backfill.v1';
  theme: string;
  generator?: BatchHeader['generator'];
}

/** A generated record as emitted by the swarm — §6.2. */
export interface RawRecord {
  first: string;
  second: string;
  named: string;
  themes: string[];
}

/** A backfill record — attaches variants to an EXISTING pool id. */
export interface BackfillRecord {
  id: string;
  first: string;
  second: string;
  named: string;
}

export type Severity = 'hard' | 'review';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  file: string;
  line: number;
  /** Present once the record has an id (post-assignment issues). */
  id?: string;
}

export interface IngestReport {
  filesRead: number;
  linesRead: number;
  accepted: number;
  rejected: number;
  backfilled: number;
  /** §8.2 — records whose person correctness was fully machine-confirmed. */
  machineVerified: number;
  routedToReview: number;
  issues: Issue[];
}
