/**
 * Corpus store — CORPUS_SPEC.md §6.3.
 *
 *   corpus/pool.json        conditioner's exact shape (byte-compatible)
 *   corpus/persons.json     { [id]: { first, second, named, invariant } }
 *   corpus/provenance.json  { [id]: { source, batch, model, generated_at, reviewed } }
 *
 * Sidecar integrity invariant, enforced at emission AND at load:
 *     persons[record.id][derivePov(record.text)] === record.text
 * The canonical text is not a separate thing from its variant set; it is the
 * member whose stance the text is written in. Without this the sidecar silently
 * drifts from the pool it keys into.
 *
 * The stance is RECOMPUTED here rather than read from a stored `markers.pov`.
 * That is strictly stronger: a stored stance can be wrong, and an integrity
 * check that trusts it validates the record against its own mistake.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Pool,
  PoolRecord,
  PersonTriple,
  Provenance,
  Markers,
} from './types.ts';
import { derivePov } from './conjugation.ts';

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

export function deriveMarkers(text: string): Markers {
  return {
    has_controller: text.includes('{controller}'),
    has_subject: text.includes('{subject}'),
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
 * §6.3 / B8. The stance is recomputed from the text rather than read back from
 * the record, so this checks the sidecar against the text itself and not
 * against a stored opinion about the text.
 *
 * `impersonal` has no variant of its own name — for those records the canonical
 * text must equal every present variant, which is the same statement one level
 * down, and is exactly the `invariant` flag's claim.
 */
export function checkIntegrity(c: Corpus): IntegrityViolation[] {
  const out: IntegrityViolation[] = [];
  for (const rec of c.pool.mantras) {
    const triple = c.persons[rec.id];
    if (triple === undefined) {
      out.push({ id: rec.id, reason: 'no persons entry' });
      continue;
    }
    const pov = derivePov(rec.text);
    if (pov === 'mixed') {
      out.push({ id: rec.id, reason: 'text mixes voice frames (§4.2 forbids mixed stance)' });
      continue;
    }
    if (pov === 'impersonal') {
      for (const p of ['first', 'second', 'named'] as const) {
        const v = triple[p];
        if (v !== null && v !== rec.text) {
          out.push({
            id: rec.id,
            reason:
              `text is person-free so every variant must equal it, but ` +
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
 * Emit with 2-space indent, a trailing newline, and the record key order
 * id/text/themes/markers. Key order is insertion order in JS objects, so
 * records are rebuilt field by field rather than spread, which keeps the emitted
 * pool byte-stable across runs and makes a re-ingest diffable.
 */
function canonicalRecord(r: PoolRecord): PoolRecord {
  return {
    id: r.id,
    text: r.text,
    themes: r.themes,
    markers: {
      has_controller: r.markers.has_controller,
      has_subject: r.markers.has_subject,
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
