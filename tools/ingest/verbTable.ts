/**
 * Verb table — CORPUS_SPEC.md §8.2.
 *
 * Salvaged from `lib/tts/verb-conjugations.ts` (the data is good; the
 * consumer there is structurally broken — see CORPUS_SPEC §4.1).
 *
 * MEASURED: 158 pipe-delimited entries, 157 unique first-forms, with exactly
 * one conflicting duplicate:
 *     'have|has|has'        (correct)
 *     'have|have|have|has'  (wrong: claims 2nd-person 'have' -> 3rd 'have')
 * The spec requires: KEEP 'have|has|has', dedupe before use. First entry
 * wins, so the later 'have|have|have|has' is dropped and reported by
 * `tableConflicts()` rather than silently shadowing.
 *
 * Entry forms:
 *   'base|third'                     -> 1st 'base', 2nd 'base', 3rd 'third'
 *   'first|second|third'             -> explicit ('have|has|has' is this shape
 *                                       and is read 1st=have 2nd=has 3rd=has;
 *                                       L2 owns the copula/auxiliary closed set,
 *                                       so this entry only contributes stems)
 *   'first|second|secondAlt|third'   -> 'am|are|are|is'
 *
 * This table is used ONLY to CONFIRM correctness (L1), never to flag every
 * subject-governed token: it covers 61% of them, so a blanket every-verb gate
 * would carry a ~39% false-positive rate and be switched off within a day.
 */

import { VERB_CONJUGATIONS } from '../../lib/tts/verb-conjugations.ts';

export interface VerbEntry {
  /** The base / 1st-person form. */
  base: string;
  /** The 3rd-person form (last field of the entry). */
  third: string;
  /** Every surface form in the entry, for membership tests. */
  forms: Set<string>;
}

const byBase = new Map<string, VerbEntry>();
const conflicts: string[] = [];

for (const pattern of VERB_CONJUGATIONS) {
  const parts = pattern.split('|').map((p) => p.trim().toLowerCase());
  const base = parts[0]!;
  const third = parts[parts.length - 1]!;
  if (byBase.has(base)) {
    // First entry wins — this is the documented 'have' dedupe.
    conflicts.push(pattern);
    continue;
  }
  byBase.set(base, { base, third, forms: new Set(parts) });
}

/** base form -> entry. Deduped; first occurrence wins. */
export const VERB_BY_BASE: ReadonlyMap<string, VerbEntry> = byBase;

/** Entries dropped by the dedupe, reported rather than hidden. */
export function tableConflicts(): readonly string[] {
  return conflicts;
}

/** Every surface form that appears anywhere in the table. */
const allForms = new Set<string>();
for (const e of byBase.values()) for (const f of e.forms) allForms.add(f);

/** third-person form -> the entry that produces it. */
const byThird = new Map<string, VerbEntry>();
for (const e of byBase.values()) if (!byThird.has(e.third)) byThird.set(e.third, e);

export function lookupBase(word: string): VerbEntry | undefined {
  return byBase.get(word.toLowerCase());
}

export function lookupThird(word: string): VerbEntry | undefined {
  return byThird.get(word.toLowerCase());
}

export function isKnownForm(word: string): boolean {
  return allForms.has(word.toLowerCase());
}

/**
 * True when `word` is a table base whose 3rd-person form DIFFERS from it —
 * i.e. a stem that must inflect after {subject}. 'can|can', 'must|must' and
 * 'will|will' are invariant and correctly excluded.
 */
export function requiresInflection(word: string): boolean {
  const e = byBase.get(word.toLowerCase());
  return e !== undefined && e.third !== e.base;
}
