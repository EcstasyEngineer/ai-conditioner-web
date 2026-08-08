/**
 * Coverage report — one flat count per tag, against one floor.
 *
 * This replaces a (theme, tier) grid that scored every cell against two
 * thresholds. With the intensity axis deleted there are no cells: a tag is a
 * flat member of one namespace, a record carries N of them, and the only
 * question the report has to answer is whether each tag can field a lane.
 */

import type { Corpus } from './store.ts';

/**
 * The per-tag floor: 3 lanes x an 18-step peak gaussian dwell.
 *
 * A tag below it cannot supply a lane for the span the titration curve holds it
 * at peak, so a user who enrolls it sees repetition — the most visible failure
 * in a three-lane simultaneous renderer. This is an ENGINE parameter, not a
 * law: it moves if the lane count or the dwell curve moves, and every headroom
 * figure quoted against it moves with it.
 */
export const TAG_FLOOR = 54;

export interface TagCount {
  tag: string;
  /** Records carrying this tag. A record tagged {A,B} counts toward both. */
  count: number;
  /** Records carrying this tag and no other. */
  solo: number;
}

export function coverage(c: Corpus): TagCount[] {
  const counts = new Map<string, { count: number; solo: number }>();

  for (const rec of c.pool.mantras) {
    // A cross-tagged record counts toward EVERY tag it carries — exclusions are
    // checked against the full tag list, so coverage must be too.
    for (const tag of rec.themes) {
      let row = counts.get(tag);
      if (row === undefined) {
        row = { count: 0, solo: 0 };
        counts.set(tag, row);
      }
      row.count++;
      if (rec.themes.length === 1) row.solo++;
    }
  }

  return [...counts.entries()]
    .map(([tag, row]) => ({ tag, ...row }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export interface VariantStats {
  total: number;
  complete: number;
  invariant: number;
  missingVariants: number;
  reviewedFalse: number;
  bySource: Map<string, number>;
}

export function variantStats(c: Corpus): VariantStats {
  const s: VariantStats = {
    total: c.pool.mantras.length,
    complete: 0,
    invariant: 0,
    missingVariants: 0,
    reviewedFalse: 0,
    bySource: new Map(),
  };
  for (const rec of c.pool.mantras) {
    const t = c.persons[rec.id];
    if (t && t.first !== null && t.second !== null && t.named !== null) {
      s.complete++;
      if (t.invariant) s.invariant++;
    } else {
      s.missingVariants++;
    }
    const p = c.provenance[rec.id];
    if (p) {
      s.bySource.set(p.source, (s.bySource.get(p.source) ?? 0) + 1);
      if (!p.reviewed) s.reviewedFalse++;
    }
  }
  return s;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

export function formatReport(c: Corpus, opts?: {
  machineVerified?: number;
  routedToReview?: number;
}): string {
  const tags = coverage(c);
  const out: string[] = [];
  const W = 20;

  const applications = tags.reduce((sum, t) => sum + t.count, 0);
  const below = tags.filter((t) => t.count < TAG_FLOOR);

  out.push('');
  out.push(
    `corpus coverage - ${c.pool.mantras.length} records, ${tags.length} tags, ` +
      `${applications} applications`,
  );
  out.push(`floor: >=${TAG_FLOOR} records per tag   legend: '!' below the floor`);
  out.push('');
  out.push(pad('tag', W) + padLeft('records', 10) + padLeft('solo', 8) + padLeft('headroom', 10));
  out.push('-'.repeat(W + 28));

  for (const t of tags) {
    const flag = t.count < TAG_FLOOR ? '!' : ' ';
    // Fraction of the tag that could be lost before it stops fielding a lane.
    const headroom = ((t.count - TAG_FLOOR) / TAG_FLOOR) * 100;
    out.push(
      pad(t.tag, W) +
        padLeft(`${t.count}${flag}`, 10) +
        padLeft(String(t.solo), 8) +
        padLeft(`${headroom >= 0 ? '+' : ''}${headroom.toFixed(0)}%`, 10),
    );
  }

  out.push('');
  out.push(
    `tag floor: ${below.length === 0 ? 'PASS' : `FAIL - ${below.map((t) => `${t.tag} (${t.count})`).join(', ')}`}`,
  );

  const s = variantStats(c);
  out.push('');
  out.push(
    `B2 all three variants: ${s.complete}/${s.total}` +
      (s.missingVariants > 0 ? `   (${s.missingVariants} incomplete - awaiting backfill)` : '   PASS'),
  );
  const invPct = s.complete > 0 ? ((s.invariant / s.complete) * 100).toFixed(1) : '0.0';
  out.push(`   invariant (person-free): ${s.invariant}/${s.complete} = ${invPct}%  (§4.3 target 12-18% of NEW content)`);
  out.push(
    'B9 provenance: ' +
      [...s.bySource.entries()].map(([k, v]) => `${k}=${v}`).join('  '),
  );

  if (opts?.machineVerified !== undefined) {
    const mv = opts.machineVerified;
    const rq = opts.routedToReview ?? 0;
    out.push('');
    out.push(
      `B4 person gate: ${mv} records fully machine-verified, ${rq} routed to review`,
    );
    const denom = mv + rq;
    if (denom > 0) {
      out.push(`   machine-verified coverage: ${((mv / denom) * 100).toFixed(1)}%`);
    }
  }

  out.push('');
  return out.join('\n');
}
