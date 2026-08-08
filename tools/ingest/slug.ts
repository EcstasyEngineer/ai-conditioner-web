/**
 * Id assignment — CORPUS_SPEC.md §8.4.10.
 *
 * Ported from conditioner `scripts/migrate_mantra_pool.py:52-58`:
 *   - strip the two placeholders
 *   - alphabetic words only  (/[a-zA-Z]+/)
 *   - first 6 words, lowercased, joined by '_'
 *   - empty -> 'mantra'
 * Collisions are suffixed _2, _3, ... Ids are opaque thereafter; MEASURED
 * only 138 of 612 round-trip to a naive text slug, so nothing may
 * reconstruct an id from text at read time.
 */

const SLUG_MAX_WORDS = 6;

export function slugify(text: string): string {
  const bare = text.replaceAll('{controller}', '').replaceAll('{subject}', '');
  const words = (bare.match(/[a-zA-Z]+/g) ?? [])
    .slice(0, SLUG_MAX_WORDS)
    .map((w) => w.toLowerCase());
  return words.length > 0 ? words.join('_') : 'mantra';
}

/**
 * Assign a collision-free id. `taken` is mutated so callers can assign a
 * whole batch against one namespace (which must be seeded with the existing
 * pool's ids).
 */
export function assignId(text: string, taken: Set<string>): string {
  const base = slugify(text);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** §7 D1/D2 — whitespace collapsed, casefolded. */
export function normalizeForDedupe(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}
