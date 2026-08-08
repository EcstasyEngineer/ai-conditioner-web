/**
 * Corpus store — CORPUS_SPEC.md §6.3.
 *
 *   corpus/pool.json        conditioner's exact shape (byte-compatible)
 *   corpus/persons.json     { [id]: { first, second, named, invariant } }
 *   corpus/provenance.json  { [id]: { source, batch, model, generated_at, reviewed } }
 *
 * Sidecar integrity invariant, enforced at emission AND at load:
 *     persons[record.id][record.markers.pov] === record.text
 * The canonical text is not a separate thing from its variant set; it is the
 * member named by `pov`. Without this the sidecar silently drifts from the
 * pool it keys into.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Pool,
  PoolRecord,
  PersonTriple,
  Provenance,
  Markers,
  Pov,
} from './types.ts';

export interface Corpus {
  pool: Pool;
  persons: Record<string, PersonTriple>;
  provenance: Record<string, Provenance>;
}

export interface StorePaths {
  pool: string;
  persons: string;
  provenance: string;
}

export function storePaths(root: string): StorePaths {
  return {
    pool: join(root, 'pool.json'),
    persons: join(root, 'persons.json'),
    provenance: join(root, 'provenance.json'),
  };
}

export function emptyCorpus(): Corpus {
  return {
    pool: { mantras: [], theme_descriptions: {} },
    persons: {},
    provenance: {},
  };
}

/* ------------------------------------------------------------------ *
 * Derived fields — computed, never authored (§5.1)
 * ------------------------------------------------------------------ */

export function deriveMarkers(text: string, pov: Pov | null): Markers {
  return {
    has_controller: text.includes('{controller}'),
    has_subject: text.includes('{subject}'),
    permanence: false, // §5.2 - always false in 1.0, reserved schema slot
    identity: false, // §5.2 - always false in 1.0, reserved
    pov,
  };
}

/**
 * §4.3 — invariant is COMPUTED: all three renderings byte-identical. A triple
 * with a missing variant is not invariant (it is incomplete).
 */
export function computeInvariant(t: {
  first: string | null;
  second: string | null;
  named: string | null;
}): boolean {
  return (
    t.first !== null &&
    t.first === t.second &&
    t.second === t.named
  );
}

/* ------------------------------------------------------------------ *
 * Sidecar integrity
 * ------------------------------------------------------------------ */

export interface IntegrityViolation {
  id: string;
  reason: string;
}

/**
 * §6.3 / B8. `impersonal` has no variant of its own name — for those records
 * the canonical text must equal every present variant, which is the same
 * statement one level down.
 */
export function checkIntegrity(c: Corpus): IntegrityViolation[] {
  const out: IntegrityViolation[] = [];
  for (const rec of c.pool.mantras) {
    const triple = c.persons[rec.id];
    if (triple === undefined) {
      out.push({ id: rec.id, reason: 'no persons entry' });
      continue;
    }
    const pov = rec.markers.pov;
    if (pov === null) {
      out.push({ id: rec.id, reason: 'pov is null (B3 requires non-null)' });
      continue;
    }
    if (pov === 'impersonal') {
      for (const p of ['first', 'second', 'named'] as const) {
        const v = triple[p];
        if (v !== null && v !== rec.text) {
          out.push({
            id: rec.id,
            reason:
              `pov is impersonal so every variant must equal text, but ` +
              `${p} is ${JSON.stringify(v)}`,
          });
        }
      }
      continue;
    }
    if (triple[pov] !== rec.text) {
      out.push({
        id: rec.id,
        reason:
          `persons[${rec.id}].${pov} !== text ` +
          `(${JSON.stringify(triple[pov])} vs ${JSON.stringify(rec.text)})`,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Load / save
 * ------------------------------------------------------------------ */

export function loadCorpus(root: string): Corpus {
  const p = storePaths(root);
  if (!existsSync(p.pool)) return emptyCorpus();
  const c: Corpus = {
    pool: JSON.parse(readFileSync(p.pool, 'utf8')) as Pool,
    persons: existsSync(p.persons)
      ? (JSON.parse(readFileSync(p.persons, 'utf8')) as Record<string, PersonTriple>)
      : {},
    provenance: existsSync(p.provenance)
      ? (JSON.parse(readFileSync(p.provenance, 'utf8')) as Record<string, Provenance>)
      : {},
  };
  const violations = checkIntegrity(c);
  if (violations.length > 0) {
    throw new Error(
      `corpus sidecar integrity violated at load (${violations.length}):\n` +
        violations.slice(0, 10).map((v) => `  ${v.id}: ${v.reason}`).join('\n'),
    );
  }
  return c;
}

/**
 * Emit with conditioner's exact formatting: 2-space indent, trailing newline,
 * and the record key order id/text/themes/base_points/markers. Key order is
 * insertion order in JS objects, so records are rebuilt field by field rather
 * than spread, keeping the pool a straight copy for regeneration upstream.
 */
function canonicalRecord(r: PoolRecord): PoolRecord {
  return {
    id: r.id,
    text: r.text,
    themes: r.themes,
    base_points: r.base_points,
    markers: {
      has_controller: r.markers.has_controller,
      has_subject: r.markers.has_subject,
      permanence: r.markers.permanence,
      identity: r.markers.identity,
      pov: r.markers.pov,
    },
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function saveCorpus(root: string, c: Corpus): void {
  const violations = checkIntegrity(c);
  if (violations.length > 0) {
    throw new Error(
      `refusing to emit: sidecar integrity violated (${violations.length}):\n` +
        violations.slice(0, 10).map((v) => `  ${v.id}: ${v.reason}`).join('\n'),
    );
  }
  const p = storePaths(root);
  writeJson(p.pool, {
    mantras: c.pool.mantras.map(canonicalRecord),
    theme_descriptions: c.pool.theme_descriptions,
  });
  writeJson(p.persons, c.persons);
  writeJson(p.provenance, c.provenance);
}
