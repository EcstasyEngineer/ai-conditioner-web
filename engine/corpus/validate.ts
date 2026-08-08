/**
 * Corpus validation — DESIGN.md §2.3, §6.7; CORPUS_SPEC.md §6.3.
 *
 * The whole file turns on one distinction, and it is behavioral rather than
 * stylistic:
 *
 *   ERROR   this corpus cannot be trusted at all -> `loadCorpus` returns
 *           `ValidationError[]` and NO corpus. The sidecar disagrees with the
 *           pool it keys into, so any record could be showing the wrong
 *           grammatical person. There is no safe partial load.
 *
 *   WARNING this ONE record cannot be served, the rest can -> the record is
 *           DROPPED and never rendered (§6.7: "a `{named}` placeholder or empty
 *           lane" is the failure being prevented). The corpus loads.
 *
 * MEASURED against the live corpus: 3063 records, 0 errors, 17 records dropped
 * for an incomplete person triple. That is precisely the shape the split is for
 * — a partially-backfilled corpus should cost 17 mantras, not a session.
 *
 * Everything here is a pure function of its arguments. No I/O, no clock, no
 * randomness.
 */

import type {
  Markers,
  PersonTriple,
  PoolRecord,
  Pov,
  Provenance,
  ValidationError,
  ValidationWarning,
} from '../types/record.ts';
import { POV_VALUES } from '../types/record.ts';
import { derivePov } from './stance.ts';

/** Narrow an unknown to a plain object without accepting arrays or null. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** True when `value` is one of the four stances (`null` is not). */
export function isPov(value: unknown): value is Pov {
  return typeof value === 'string' && (POV_VALUES as readonly string[]).includes(value);
}

/**
 * Structural check on one `markers` object.
 *
 * Extra keys are tolerated: a pool carrying the deleted `permanence`/`identity`/
 * `pov` slots still loads, and their values are simply never read. Rejecting
 * them would turn a schema shrink into a corpus that will not open.
 */
export function validateMarkers(value: unknown): value is Markers {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.has_controller === 'boolean' &&
    typeof value.has_subject === 'boolean'
  );
}

/** Structural check on one pool record. Four fields, exactly. */
export function validatePoolRecord(value: unknown): value is PoolRecord {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.text === 'string' &&
    isStringArray(value.themes) &&
    validateMarkers(value.markers)
  );
}

/** Structural check on one sidecar entry. A `null` variant is structurally legal. */
export function validatePersonTriple(value: unknown): value is PersonTriple {
  if (!isPlainObject(value)) return false;
  return (
    isNullableString(value.first) &&
    isNullableString(value.second) &&
    isNullableString(value.named) &&
    typeof value.invariant === 'boolean'
  );
}

/** Structural check on one provenance entry. Every field but `source` is optional. */
export function validateProvenance(value: unknown): value is Provenance {
  if (!isPlainObject(value)) return false;
  if (typeof value.source !== 'string') return false;
  for (const key of ['batch', 'model', 'generated_at'] as const) {
    if (key in value && !isNullableString(value[key])) return false;
  }
  if ('reviewed' in value && value.reviewed !== undefined && typeof value.reviewed !== 'boolean') {
    return false;
  }
  return true;
}

/**
 * The sidecar integrity invariant — DESIGN.md §2.3, CORPUS_SPEC.md §6.3, B8.
 *
 *     persons[record.id][derivePov(record.text)] === record.text
 *
 * The canonical text is not a separate thing from its variant set; it is the
 * member of the set whose stance the text is written in. Without this the
 * sidecar drifts from the pool it references and nothing catches it until a
 * user reads a line in a person they did not consent to.
 *
 * The stance is RECOMPUTED from the text rather than read from a stored field.
 * That is strictly stronger than the stored form this check used to take: a
 * stored stance can be wrong, and an integrity check that trusts it validates
 * the record against its own mistake. `mixed` returns a reason rather than
 * `null`, because a text with two voice frames has no canonical variant at all.
 *
 * The `impersonal` branch is not an exception to that rule, it is the rule
 * applied to a stance that has no dedicated key. An impersonal record has no
 * grammatical subject, so `persons` carries no `impersonal` field — its
 * canonical text is the member EVERY key names, and the check is that all three
 * variants equal `text`. MEASURED: 491 of the live corpus's 3063 records are
 * impersonal, and all 491 satisfy it. Reading `persons[id]['impersonal']`
 * literally would return `undefined` and fail every one of them.
 *
 * Returns `null` when the invariant holds, or the reason it does not.
 */
export function checkSidecarIntegrity(
  record: PoolRecord,
  triple: PersonTriple,
): string | null {
  const pov = derivePov(record.text);
  if (pov === 'mixed') return 'text mixes voice frames; it has no canonical variant';

  if (pov === 'impersonal') {
    if (triple.first !== record.text || triple.second !== record.text || triple.named !== record.text) {
      return (
        `impersonal record's variants do not all equal its text ` +
        `(first=${JSON.stringify(triple.first)}, second=${JSON.stringify(triple.second)}, ` +
        `named=${JSON.stringify(triple.named)}, text=${JSON.stringify(record.text)})`
      );
    }
    return null;
  }

  const canonical = triple[pov];
  if (canonical !== record.text) {
    return (
      `persons[${JSON.stringify(record.id)}].${pov} !== record.text ` +
      `(${JSON.stringify(canonical)} vs ${JSON.stringify(record.text)})`
    );
  }
  return null;
}

/**
 * `invariant` must agree with the three strings it summarizes — CORPUS_SPEC §4.3.
 *
 * It is COMPUTED at ingest and never authored, so a disagreement means the
 * sidecar was hand-edited or written by a second, drifting emitter. That is an
 * error rather than a warning because the flag is what the drift-pivot
 * scheduler reads (§4.6) and what `unison` refuses on (§4.7): a wrong
 * `invariant` shows three byte-identical strings across the screen, which a
 * user reads as a bug.
 *
 * A triple with a `null` variant is skipped — that record is being dropped
 * anyway, and `null === null` is not a meaningful equality here.
 */
export function checkInvariantFlag(triple: PersonTriple): string | null {
  if (triple.first === null || triple.second === null || triple.named === null) return null;

  const allEqual = triple.first === triple.second && triple.second === triple.named;
  if (allEqual !== triple.invariant) {
    return allEqual
      ? 'invariant is false but all three variants are identical'
      : 'invariant is true but the three variants differ';
  }
  return null;
}

/** Build a `ValidationError`, so every construction site spells the fields the same way. */
export function error(
  kind: ValidationError['kind'],
  message: string,
  extra: { id?: string; index?: number } = {},
): ValidationError {
  const e: ValidationError = { kind, message };
  if (extra.id !== undefined) e.id = extra.id;
  if (extra.index !== undefined) e.index = extra.index;
  return e;
}

/** Build a `ValidationWarning`. */
export function warning(
  kind: ValidationWarning['kind'],
  message: string,
  extra: { id?: string; index?: number } = {},
): ValidationWarning {
  const w: ValidationWarning = { kind, message };
  if (extra.id !== undefined) w.id = extra.id;
  if (extra.index !== undefined) w.index = extra.index;
  return w;
}
