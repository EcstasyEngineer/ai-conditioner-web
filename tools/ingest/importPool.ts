/**
 * Import an existing conditioner-schema pool.json into the corpus store.
 *
 * These records are the 612 hand-authored originals. Per B9 they carry
 * source "conditioner-pool" and are NEVER modified: text, themes and ids are
 * taken verbatim, and re-importing is a no-op.
 *
 * They arrive with ONE rendering, not three. §4.1 requires all three variants
 * on every record, so the import fills the variant named by the derived pov
 * and leaves the other two null until a backfill batch attaches them. A null
 * variant is visible in `corpus:report` as an incomplete record — the honest
 * representation of "this variant has not been authored yet", as opposed to
 * fabricating a rendering the ingester would then have to trust.
 *
 * The one exception is the impersonal class (§4.3): a person-free line renders
 * identically in all three persons, so its triple is complete on arrival and
 * `invariant` is true.
 */

import { readFileSync } from 'node:fs';
import type { Corpus } from './store.ts';
import type { Pool, PersonTriple, PoolRecord } from './types.ts';
import { computeInvariant, deriveMarkers } from './store.ts';
import { derivePov } from './conjugation.ts';

export interface ImportResult {
  added: number;
  skipped: number;
  mixed: string[];
  povCounts: Record<string, number>;
}

export function importPool(
  c: Corpus,
  poolPath: string,
  source = 'conditioner-pool',
): ImportResult {
  const src = JSON.parse(readFileSync(poolPath, 'utf8')) as Pool;
  const existing = new Set(c.pool.mantras.map((r) => r.id));
  const result: ImportResult = {
    added: 0,
    skipped: 0,
    mixed: [],
    povCounts: { first: 0, second: 0, named: 0, impersonal: 0 },
  };

  for (const rec of src.mantras) {
    // Idempotence: an id already present is left exactly as it stands.
    if (existing.has(rec.id)) {
      result.skipped++;
      continue;
    }

    const pov = derivePov(rec.text);
    if (pov === 'mixed') {
      // §4.2 measured zero of 612 need `mixed`; if one appears, surface it
      // rather than guessing a stance.
      result.mixed.push(rec.id);
      continue;
    }
    result.povCounts[pov]!++;

    const triple: PersonTriple = {
      first: null,
      second: null,
      named: null,
      invariant: false,
    };
    if (pov === 'impersonal') {
      triple.first = rec.text;
      triple.second = rec.text;
      triple.named = rec.text;
    } else {
      triple[pov as 'first' | 'second' | 'named'] = rec.text;
    }
    triple.invariant = computeInvariant(triple);

    const poolRecord: PoolRecord = {
      id: rec.id,
      text: rec.text,
      themes: [...rec.themes],
      // Re-derived rather than copied, so both markers are mechanical
      // substring tests against the text they describe.
      markers: deriveMarkers(rec.text),
    };

    c.pool.mantras.push(poolRecord);
    c.persons[rec.id] = triple;
    c.provenance[rec.id] = {
      source,
      batch: null,
      model: null,
      generated_at: null,
      // The originals are hand-authored; they are reviewed by construction.
      reviewed: true,
    };
    existing.add(rec.id);
    result.added++;
  }

  // theme_descriptions come along so the pool stays a straight copy.
  for (const [k, v] of Object.entries(src.theme_descriptions ?? {})) {
    if (!(k in c.pool.theme_descriptions)) c.pool.theme_descriptions[k] = v;
  }

  return result;
}
