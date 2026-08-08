/**
 * The engine narrates its own degradation — DESIGN.md §4.10.
 *
 * Every place the planner could quietly do something second-best, it records
 * it as TYPED DATA on the plan rather than as a log line or a string warning.
 * Three payoffs, each of which is why this is a shared type rather than a
 * private one:
 *
 *   1. Acceptance criteria become mechanically assertable — "zero
 *      `lane-starved` on the reference config" is a test, not a review.
 *   2. Phase B gets a machine-readable list naming exactly which cells are
 *      underfilled.
 *   3. A user report is reproducible from `(config, seed)` alone.
 *
 * A `Diagnostic` is never fatal. When the engine cannot proceed at all it
 * returns `PlanError[]` instead (see `plan.ts`); the distinction is that a
 * diagnostic describes a session that WAS planned, and an error describes one
 * that was not.
 */

import type { LaneId } from './frame.ts';
import type { Person } from './record.ts';

/** A lane could not be filled at a step. Zero of these on the reference config. */
export interface LaneStarvedDiagnostic {
  kind: 'lane-starved';
  step: number;
  lane: LaneId;
  reason: string;
}

/**
 * The Shuffler's suppression window is saturating against the block size, so
 * anti-repeat degrades toward LRU-with-random-ties (§4.8). Steps drawn under a
 * degraded shuffler are the documented exception to the anti-repeat assertion.
 */
export interface ShufflerDegradedDiagnostic {
  kind: 'shuffler-degraded';
  theme: string;
  poolSize: number;
}

/**
 * The blocklist was ignored for a draw because honoring it would have starved
 * the slot (§2.6). Consent is never relaxed this way; only preference is.
 */
export interface BlocklistRelaxedDiagnostic {
  kind: 'blocklist-relaxed';
  step?: number;
  lane?: LaneId;
}

/** The scheduled person could not be served, so another was used (§4.6). */
export interface PersonUnavailableDiagnostic {
  kind: 'person-unavailable';
  step: number;
  lane: LaneId;
  wanted: Person;
}

/**
 * A `unison` step drew an `invariant` mantra and was redrawn (§4.7).
 *
 * Under `unison` an invariant record renders as three byte-identical strings
 * across the screen, which a user reads as a bug rather than emphasis. The
 * planner refuses and redraws; the person-free records do their work at the
 * drift pivot instead.
 */
export interface UnisonRedrawDiagnostic {
  kind: 'unison-redraw';
  step: number;
  reason: 'invariant';
}

export type Diagnostic =
  | LaneStarvedDiagnostic
  | ShufflerDegradedDiagnostic
  | BlocklistRelaxedDiagnostic
  | PersonUnavailableDiagnostic
  | UnisonRedrawDiagnostic;

/** Every diagnostic kind, as values — for exhaustive reporting and tests. */
export const DIAGNOSTIC_KINDS: readonly Diagnostic['kind'][] = [
  'lane-starved',
  'shuffler-degraded',
  'blocklist-relaxed',
  'person-unavailable',
  'unison-redraw',
] as const;
