/**
 * Dedupe — CORPUS_SPEC.md §7.
 *
 *   D1  exact-normalized duplicate against the EXISTING pool, checked across
 *       all three variants                              HARD  - drop
 *   D2  exact-normalized duplicate WITHIN the batch      HARD  - keep first
 *   D3  near-duplicate, Levenshtein < 15% of length    REVIEW  - never dropped
 *   D4  same record under two themes                          - cross-tagging,
 *                                                               merge the tags
 *
 * A collision on ANY of the three variants drops the record: two mantras that
 * differ only in first person but collide in third person would render
 * identically on a side channel.
 */

import { normalizeForDedupe } from './slug.ts';

/** Row-wise Levenshtein, O(min(a,b)) space, with an early-exit ceiling. */
export function levenshtein(a: string, b: string, ceiling = Infinity): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > ceiling) return ceiling + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > ceiling) return ceiling + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** D3 — near-duplicate when distance < 15% of the longer string. */
export function isNearDuplicate(a: string, b: string): boolean {
  const threshold = Math.floor(Math.max(a.length, b.length) * 0.15);
  if (threshold === 0) return false;
  return levenshtein(a, b, threshold) < threshold;
}

/**
 * An index of every normalized variant string seen so far -> the id that owns
 * it. Seeded with the existing pool (D1), then extended as a batch is
 * accepted (D2).
 */
export class DedupeIndex {
  private byText = new Map<string, string>();

  add(id: string, variants: (string | null)[]): void {
    for (const v of variants) {
      if (v === null) continue;
      const key = normalizeForDedupe(v);
      if (!this.byText.has(key)) this.byText.set(key, id);
    }
  }

  /** Returns the colliding id, or null. */
  find(variants: (string | null)[]): string | null {
    for (const v of variants) {
      if (v === null) continue;
      const hit = this.byText.get(normalizeForDedupe(v));
      if (hit !== undefined) return hit;
    }
    return null;
  }

  /** D3 — nearest existing text within the review threshold, if any. */
  findNear(variants: (string | null)[]): { id: string; text: string } | null {
    for (const v of variants) {
      if (v === null) continue;
      const norm = normalizeForDedupe(v);
      for (const [key, id] of this.byText) {
        if (isNearDuplicate(norm, key)) return { id, text: key };
      }
    }
    return null;
  }

  get size(): number {
    return this.byText.size;
  }
}

/**
 * D4 — cross-tagging. Merge theme lists for records whose variant set is
 * identical, preserving first-seen order.
 */
export function mergeThemes(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const t of b) if (!out.includes(t)) out.push(t);
  return out;
}
