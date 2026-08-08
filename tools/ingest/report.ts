/**
 * Coverage report — CORPUS_SPEC.md §3.3, §8.2, B1/B11.
 *
 * Prints EVERY (theme, tier) cell against both thresholds — the T1 ship floor
 * of >=8 and the T2 quality target of >=24 — so remaining Phase B work is
 * machine-readable and each batch can target the thinnest cells first.
 */

import type { Corpus } from './store.ts';
import type { Tier } from './types.ts';
import { TIER_ORDER, getTier } from './tier.ts';

export const T1_FLOOR = 8;
export const T2_TARGET = 24;

export interface CellCounts {
  theme: string;
  counts: Record<Tier, number>;
  total: number;
}

export function coverage(c: Corpus): CellCounts[] {
  const byTheme = new Map<string, Record<Tier, number>>();
  const blank = (): Record<Tier, number> => ({
    basic: 0, light: 0, moderate: 0, deep: 0, extreme: 0,
  });

  for (const rec of c.pool.mantras) {
    const tier = getTier(rec.base_points);
    // A cross-tagged record counts toward EVERY theme it carries — exclusions
    // are checked against the full tag list, so coverage must be too.
    for (const theme of rec.themes) {
      if (!byTheme.has(theme)) byTheme.set(theme, blank());
      byTheme.get(theme)![tier]++;
    }
  }

  return [...byTheme.entries()]
    .map(([theme, counts]) => ({
      theme,
      counts,
      total: TIER_ORDER.reduce((s, t) => s + counts[t], 0),
    }))
    .sort((a, b) => a.theme.localeCompare(b.theme));
}

export interface VariantStats {
  total: number;
  complete: number;
  invariant: number;
  missingVariants: number;
  povNull: number;
  reviewedFalse: number;
  bySource: Map<string, number>;
}

export function variantStats(c: Corpus): VariantStats {
  const s: VariantStats = {
    total: c.pool.mantras.length,
    complete: 0,
    invariant: 0,
    missingVariants: 0,
    povNull: 0,
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
    if (rec.markers.pov === null) s.povNull++;
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

/** Marks a cell: ' ' meets T2, '+' meets T1 only, '!' below the ship floor. */
function mark(n: number): string {
  if (n >= T2_TARGET) return ' ';
  if (n >= T1_FLOOR) return '+';
  return '!';
}

export function formatReport(c: Corpus, opts?: {
  machineVerified?: number;
  routedToReview?: number;
}): string {
  const cells = coverage(c);
  const out: string[] = [];
  const W = 16;

  out.push('');
  out.push(`corpus coverage - ${c.pool.mantras.length} records, ${cells.length} themes`);
  out.push(`thresholds: T1 ship floor >=${T1_FLOOR}   T2 quality target >=${T2_TARGET}`);
  out.push(`legend: '!' below T1   '+' meets T1, below T2   ' ' meets T2`);
  out.push('');
  out.push(
    pad('theme', W) +
      TIER_ORDER.map((t) => padLeft(t, 10)).join('') +
      padLeft('total', 8),
  );
  out.push('-'.repeat(W + 10 * TIER_ORDER.length + 8));

  let belowT1 = 0;
  let belowT2 = 0;
  for (const cell of cells) {
    const row = TIER_ORDER.map((t) => {
      const n = cell.counts[t];
      if (n < T1_FLOOR) belowT1++;
      if (n < T2_TARGET) belowT2++;
      return padLeft(`${n}${mark(n)}`, 10);
    }).join('');
    out.push(pad(cell.theme, W) + row + padLeft(String(cell.total), 8));
  }

  out.push('');
  const totalCells = cells.length * TIER_ORDER.length;
  out.push(
    `cells: ${totalCells} total   ` +
      `${totalCells - belowT1} meet T1 (>=${T1_FLOOR})   ` +
      `${totalCells - belowT2} meet T2 (>=${T2_TARGET})`,
  );
  out.push(`B1 T1 ship gate: ${belowT1 === 0 ? 'PASS' : `FAIL - ${belowT1} cells below ${T1_FLOOR}`}`);

  // §2.2 — induction and emergence are the blocking Tranche 0 themes.
  for (const t of ['induction', 'emergence']) {
    const cell = cells.find((x) => x.theme === t);
    const n = cell?.total ?? 0;
    out.push(`B7 ${pad(t, 10)} ${padLeft(String(n), 4)} / 40   ${n >= 40 ? 'PASS' : 'FAIL'}`);
  }

  const s = variantStats(c);
  out.push('');
  out.push(
    `B2 all three variants: ${s.complete}/${s.total}` +
      (s.missingVariants > 0 ? `   (${s.missingVariants} incomplete - awaiting backfill)` : '   PASS'),
  );
  out.push(`B3 pov non-null: ${s.total - s.povNull}/${s.total}${s.povNull === 0 ? '   PASS' : '   FAIL'}`);
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
