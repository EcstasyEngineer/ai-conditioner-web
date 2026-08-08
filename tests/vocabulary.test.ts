/**
 * The vocabulary contract, checked against the real corpus.
 *
 * These tests exist because the tag set and the corpus can drift apart silently:
 * a tag declared but unused ships an empty picker entry, and a tag used but
 * undeclared is invisible to both the picker and the exclusion filter — the
 * second is a consent hole, since a user cannot exclude a tag the vocabulary
 * does not admit exists.
 *
 * The starvation sweep is here rather than in a script so that growing the
 * corpus re-measures it. `KNOWN_THIN_PAIRS` is an explicit, auditable exception
 * list; the sweep fails if a NEW pair drops below the floor, and equally if a
 * listed pair silently recovers, so the list cannot rot into a permanent excuse.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_TAGS,
  CORPUS_FLOOR,
  ENROLLABLE_TAGS,
  EXCLUSION_ONLY_TAGS,
  KNOWN_THIN_PAIRS,
  isEnrollable,
  isExclusionOnly,
  isTag,
} from '../engine/corpus/vocabulary.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface PoolFile {
  mantras: { id: string; text: string; themes: string[] }[];
  theme_descriptions: Record<string, string>;
}

const pool = JSON.parse(
  readFileSync(path.join(repoRoot, 'corpus', 'pool.json'), 'utf8'),
) as PoolFile;

const themeSets = pool.mantras.map((r) => new Set(r.themes));

const counts = new Map<string, number>();
for (const set of themeSets) {
  for (const tag of set) counts.set(tag, (counts.get(tag) ?? 0) + 1);
}

describe('the tag vocabulary', () => {
  it('is disjoint between enrollable and exclusion-only', () => {
    const overlap = ENROLLABLE_TAGS.filter((t) => (EXCLUSION_ONLY_TAGS as readonly string[]).includes(t));
    expect(overlap).toEqual([]);
    expect(ALL_TAGS.length).toBe(ENROLLABLE_TAGS.length + EXCLUSION_ONLY_TAGS.length);
    expect(new Set(ALL_TAGS).size).toBe(ALL_TAGS.length);
  });

  it('classifies every tag as exactly one of enrollable or exclusion-only', () => {
    for (const tag of ALL_TAGS) {
      expect(isTag(tag)).toBe(true);
      expect(isEnrollable(tag) !== isExclusionOnly(tag)).toBe(true);
    }
    expect(isTag('not_a_tag')).toBe(false);
    expect(isEnrollable('explicit')).toBe(false);
    expect(isExclusionOnly('explicit')).toBe(true);
  });

  it('matches the corpus exactly — no declared-but-unused, no used-but-undeclared', () => {
    expect(new Set(counts.keys())).toEqual(new Set(ALL_TAGS));
  });

  it('gives every tag a description', () => {
    expect(new Set(Object.keys(pool.theme_descriptions))).toEqual(new Set(ALL_TAGS));
    for (const [tag, prose] of Object.entries(pool.theme_descriptions)) {
      expect(prose.trim().length, tag).toBeGreaterThan(0);
    }
  });

  it('holds every tag at or above the corpus floor', () => {
    const thin = ALL_TAGS.filter((t) => (counts.get(t) ?? 0) < CORPUS_FLOOR);
    expect(thin).toEqual([]);
  });

  it('leaves no record untagged or self-duplicating', () => {
    for (const record of pool.mantras) {
      expect(record.themes.length, record.id).toBeGreaterThan(0);
      expect(new Set(record.themes).size, record.id).toBe(record.themes.length);
    }
  });
});

describe('the enrollable x exclusion starvation sweep', () => {
  // Exclusion is checked against the record's FULL tag list, never the
  // enrollment bucket. Checking it any other way hides the cross-tag leak that
  // serves a user content they explicitly refused.
  const remaining = (enroll: string, exclude: string): number =>
    themeSets.reduce((n, set) => (set.has(enroll) && !set.has(exclude) ? n + 1 : n), 0);

  const sweep = (): { enroll: string; exclude: string; remaining: number }[] => {
    const out: { enroll: string; exclude: string; remaining: number }[] = [];
    for (const enroll of ENROLLABLE_TAGS) {
      for (const exclude of ALL_TAGS) {
        if (enroll === exclude) continue;
        out.push({ enroll, exclude, remaining: remaining(enroll, exclude) });
      }
    }
    return out;
  };

  it('tests every enrollable tag against every other tag', () => {
    expect(sweep().length).toBe(ENROLLABLE_TAGS.length * (ALL_TAGS.length - 1));
  });

  it('starves on exactly the known-thin pairs, and no others', () => {
    const starved = sweep()
      .filter((p) => p.remaining < CORPUS_FLOOR)
      .map((p) => `${p.enroll}-${p.exclude}`)
      .sort();
    const known = KNOWN_THIN_PAIRS.map((p) => `${p.enroll}-${p.exclude}`).sort();
    expect(starved).toEqual(known);
  });

  it('keeps the known-thin pairs at their measured counts', () => {
    // If a pair recovers, delete it from KNOWN_THIN_PAIRS rather than widening
    // this assertion — the exception list must shrink as the corpus grows.
    for (const pair of KNOWN_THIN_PAIRS) {
      expect(remaining(pair.enroll, pair.exclude), `${pair.enroll}-${pair.exclude}`).toBe(
        pair.remaining,
      );
    }
  });
});
