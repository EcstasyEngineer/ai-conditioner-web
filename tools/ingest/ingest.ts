/**
 * The ingester — CORPUS_SPEC.md §8.
 *
 * Order matters and is fixed by the spec: structure, then person correctness,
 * then content quality, then dedupe, then id assignment. The ingester
 * REJECTS, never repairs.
 *
 * Idempotence (§8.4.12, B5): re-running over the same raw files produces a
 * byte-identical pool. This is achieved by keying every record to the
 * content-derived id and skipping a raw record whose id already exists with
 * identical content — so ingest is an append of what is genuinely new.
 *
 * Order preservation (§8.4.11): records are appended in generation order and
 * NEVER sorted or shuffled. The corpus is order-dependent (meter and rhyme
 * adjacency).
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type {
  BackfillHeader,
  BackfillRecord,
  BatchHeader,
  IngestReport,
  Issue,
  PersonTriple,
  PoolRecord,
  Pov,
  Provenance,
  RawRecord,
  Tier,
} from './types.ts';
import type { Corpus as CorpusT } from './store.ts';
import {
  computeInvariant,
  deriveMarkers,
  checkIntegrity,
} from './store.ts';
import { assignId } from './slug.ts';
import { getTier, isTier } from './tier.ts';
import { checkPersonCorrectness, derivePov } from './conjugation.ts';
import {
  checkBasePoints,
  checkContentQuality,
  checkPlaceholders,
} from './lint.ts';
import { DedupeIndex, mergeThemes } from './dedupe.ts';

export interface IngestOptions {
  /** Where the raw JSONL batches live. */
  files: string[];
  /** Mutated in place. */
  corpus: CorpusT;
}

const VARIANTS = ['first', 'second', 'named'] as const;

interface ParsedLine {
  file: string;
  line: number;
  value: unknown;
}

function readJsonl(file: string): { lines: ParsedLine[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const lines: ParsedLine[] = [];
  const raw = readFileSync(file, 'utf8').split('\n');
  raw.forEach((text, i) => {
    if (text.trim() === '') return;
    try {
      lines.push({ file, line: i + 1, value: JSON.parse(text) });
    } catch (e) {
      issues.push({
        severity: 'hard',
        code: 'BAD_JSON',
        message: `unparseable JSON: ${(e as Error).message}`,
        file: basename(file),
        line: i + 1,
      });
    }
  });
  return { lines, issues };
}

/**
 * Build the id namespace and dedupe index from the corpus as it currently
 * stands. Seeding these with the EXISTING pool is what makes D1 and the
 * collision suffixes correct across runs.
 */
function seedIndexes(c: CorpusT): { taken: Set<string>; dedupe: DedupeIndex } {
  const taken = new Set<string>();
  const dedupe = new DedupeIndex();
  for (const rec of c.pool.mantras) {
    taken.add(rec.id);
    const triple = c.persons[rec.id];
    dedupe.add(
      rec.id,
      triple ? [triple.first, triple.second, triple.named] : [rec.text],
    );
  }
  return { taken, dedupe };
}

export function ingest(opts: IngestOptions): IngestReport {
  const c = opts.corpus;
  const report: IngestReport = {
    filesRead: 0,
    linesRead: 0,
    accepted: 0,
    rejected: 0,
    backfilled: 0,
    machineVerified: 0,
    routedToReview: 0,
    issues: [],
  };

  const { taken, dedupe } = seedIndexes(c);
  const byId = new Map(c.pool.mantras.map((r) => [r.id, r]));

  for (const file of opts.files) {
    const { lines, issues } = readJsonl(file);
    report.issues.push(...issues);
    report.rejected += issues.length;
    if (lines.length === 0) continue;
    report.filesRead++;
    report.linesRead += lines.length;

    const headerLine = lines[0]!;
    // The two header shapes are alternatives, not a combination: an
    // intersection would collapse their incompatible `schema` literals to
    // `never` and silently disable type checking on every field below.
    const header = headerLine.value as
      | Partial<BatchHeader>
      | Partial<BackfillHeader>
      | undefined;
    const short = basename(file);

    if (header?.schema === 'hypnoapp.corpus.backfill.v1') {
      ingestBackfill(lines, header as BackfillHeader, c, byId, dedupe, report);
      continue;
    }

    if (header?.schema !== 'hypnoapp.corpus.v1') {
      report.issues.push({
        severity: 'hard',
        code: 'BAD_HEADER',
        message:
          'line 1 must be a header with schema "hypnoapp.corpus.v1" or ' +
          `"hypnoapp.corpus.backfill.v1", got ${JSON.stringify(header?.schema)}`,
        file: short,
        line: headerLine.line,
      });
      report.rejected += lines.length;
      continue;
    }

    if (typeof header.theme !== 'string' || header.theme === '') {
      report.issues.push({
        severity: 'hard',
        code: 'BAD_HEADER',
        message: 'header.theme is required',
        file: short,
        line: headerLine.line,
      });
      report.rejected += lines.length;
      continue;
    }
    if (!isTier(header.tier)) {
      report.issues.push({
        severity: 'hard',
        code: 'BAD_HEADER',
        message: `header.tier ${JSON.stringify(header.tier)} is not a tier`,
        file: short,
        line: headerLine.line,
      });
      report.rejected += lines.length;
      continue;
    }

    const prov: Omit<Provenance, 'reviewed'> = {
      source: 'phase-b',
      batch: header.generator?.batch ?? basename(file, '.jsonl'),
      model: header.generator?.model ?? null,
      generated_at: header.generator?.generated_at ?? null,
    };

    for (const pl of lines.slice(1)) {
      const outcome = ingestRecord(
        pl,
        header.theme,
        header.tier as Tier,
        prov,
        c,
        byId,
        taken,
        dedupe,
        report,
      );
      if (outcome === 'accepted') report.accepted++;
      else if (outcome === 'rejected') report.rejected++;
    }
  }

  return report;
}

type Outcome = 'accepted' | 'rejected' | 'skipped';

function ingestRecord(
  pl: ParsedLine,
  theme: string,
  tier: Tier,
  prov: Omit<Provenance, 'reviewed'>,
  c: CorpusT,
  byId: Map<string, PoolRecord>,
  taken: Set<string>,
  dedupe: DedupeIndex,
  report: IngestReport,
): Outcome {
  const short = basename(pl.file);
  const issues: Issue[] = [];
  const push = (severity: 'hard' | 'review', code: string, message: string) =>
    issues.push({ severity, code, message, file: short, line: pl.line });

  const r = pl.value as Partial<RawRecord> & Record<string, unknown>;

  /* ---- §8.1 structural ---- */

  if (typeof r !== 'object' || r === null || Array.isArray(r)) {
    push('hard', 'NOT_AN_OBJECT', 'record must be a JSON object');
    report.issues.push(...issues);
    return 'rejected';
  }

  // §5.5 / §6.2 — a generator that emits an id has its record rejected.
  if ('id' in r) {
    push('hard', 'ID_PRESENT', 'records must not carry an id; ids are assigned by the ingester');
  }

  for (const v of VARIANTS) {
    if (typeof r[v] !== 'string' || (r[v] as string).trim() === '') {
      push('hard', 'MISSING_VARIANT', `\`${v}\` is required and must be a non-empty string`);
    }
  }

  if (!Array.isArray(r.themes) || r.themes.length === 0 ||
      !r.themes.every((t) => typeof t === 'string' && t !== '')) {
    push('hard', 'BAD_THEMES', 'themes must be a non-empty array of strings');
  }

  // §6.2 — derived markers are rejected if present.
  if (r.markers !== undefined) {
    if (typeof r.markers !== 'object' || r.markers === null) {
      push('hard', 'BAD_MARKERS', 'markers must be an object');
    } else {
      for (const derived of ['has_controller', 'has_subject', 'pov']) {
        if (derived in (r.markers as object)) {
          push('hard', 'DERIVED_MARKER', `markers.${derived} is derived and must not be authored`);
        }
      }
      for (const reserved of ['permanence', 'identity'] as const) {
        const val = (r.markers as Record<string, unknown>)[reserved];
        if (val !== undefined && val !== false) {
          push('hard', 'RESERVED_MARKER', `markers.${reserved} must be false in 1.0`);
        }
      }
    }
  }

  issues.push(...checkBasePoints(r.base_points, tier).map((f) => ({
    ...f, file: short, line: pl.line,
  })));

  if (issues.some((i) => i.severity === 'hard')) {
    report.issues.push(...issues);
    return 'rejected';
  }

  const rec = r as RawRecord;

  for (const v of VARIANTS) {
    issues.push(...checkPlaceholders(rec[v], v).map((f) => ({
      ...f, file: short, line: pl.line,
    })));
  }
  if (issues.some((i) => i.severity === 'hard')) {
    report.issues.push(...issues);
    return 'rejected';
  }

  /* ---- §8.2 person correctness ---- */

  const gate = checkPersonCorrectness(rec);
  issues.push(...gate.findings.map((f) => ({ ...f, file: short, line: pl.line })));

  /* ---- §8.3 content quality ---- */

  for (const v of VARIANTS) {
    issues.push(...checkContentQuality(rec[v], v, rec.base_points).map((f) => ({
      ...f, file: short, line: pl.line,
    })));
  }

  if (issues.some((i) => i.severity === 'hard')) {
    report.issues.push(...issues);
    return 'rejected';
  }

  /* ---- §7 dedupe ---- */

  const variants = [rec.first, rec.second, rec.named];

  // D1/D2 share one index: it is seeded from the pool and extended as the
  // batch is accepted, so a within-batch collision and an against-pool
  // collision are the same lookup.
  const collision = dedupe.find(variants);
  if (collision !== null) {
    const existing = byId.get(collision);
    // D4 — the same record under two themes is cross-tagging, not a
    // duplicate: merge the tags into the record that already exists.
    if (existing && !existing.themes.includes(theme)) {
      existing.themes = mergeThemes(existing.themes, rec.themes);
      report.issues.push({
        severity: 'review',
        code: 'D4_CROSS_TAG',
        message: `merged themes ${JSON.stringify(rec.themes)} into existing record`,
        file: short,
        line: pl.line,
        id: collision,
      });
      report.issues.push(...issues);
      return 'skipped';
    }
    push('hard', 'D1_DUPLICATE', `duplicate of existing record "${collision}"`);
    report.issues.push(...issues);
    return 'rejected';
  }

  const near = dedupe.findNear(variants);
  if (near !== null) {
    push('review', 'D3_NEAR_DUPLICATE', `near-duplicate of "${near.id}" (reported, not dropped)`);
  }

  /* ---- §8.4 id assignment and emission ---- */

  const pov = derivePov(rec.first);
  if (pov === 'mixed') {
    push('hard', 'MIXED_STANCE', '`first` mixes voice frames; §4.2 forbids mixed stance');
    report.issues.push(...issues);
    return 'rejected';
  }

  // pov describes the STORED text. The canonical text is the member named by
  // pov (§6.3); for a person-free record every variant is the same string.
  const canonicalPov: Pov = pov;
  const text =
    canonicalPov === 'impersonal' ? rec.first : rec[canonicalPov as 'first' | 'second' | 'named'];

  // §8.4.10 — id derived from the FIRST variant so ids stay stable if other
  // variants are later edited.
  const id = assignId(rec.first, taken);

  const poolRecord: PoolRecord = {
    id,
    text,
    themes: rec.themes.includes(theme) ? rec.themes : [theme, ...rec.themes],
    base_points: rec.base_points,
    markers: deriveMarkers(text, canonicalPov),
  };

  const triple: PersonTriple = {
    first: rec.first,
    second: rec.second,
    named: rec.named,
    invariant: computeInvariant(rec),
  };

  c.pool.mantras.push(poolRecord); // append only; never sorted
  byId.set(id, poolRecord);
  c.persons[id] = triple;
  c.provenance[id] = {
    ...prov,
    // DECISIONS.md decision 2: induction/emergence are generated
    // UNSUPERVISED, so provenance marks them reviewed:false. Nothing in
    // Phase B is hand-reviewed at ingest time.
    reviewed: false,
  };
  dedupe.add(id, variants);

  if (gate.machineVerified) report.machineVerified++;
  if (issues.some((i) => i.severity === 'review')) report.routedToReview++;

  report.issues.push(...issues);
  return 'accepted';
}

/* ------------------------------------------------------------------ *
 * Backfill — attach person variants to EXISTING records
 * ------------------------------------------------------------------ */

function ingestBackfill(
  lines: ParsedLine[],
  _header: BackfillHeader,
  c: CorpusT,
  byId: Map<string, PoolRecord>,
  dedupe: DedupeIndex,
  report: IngestReport,
): void {
  for (const pl of lines.slice(1)) {
    const short = basename(pl.file);
    const issues: Issue[] = [];
    const push = (severity: 'hard' | 'review', code: string, message: string) =>
      issues.push({ severity, code, message, file: short, line: pl.line, id: (pl.value as BackfillRecord)?.id });

    const r = pl.value as Partial<BackfillRecord>;

    if (typeof r?.id !== 'string') {
      push('hard', 'BACKFILL_NO_ID', 'backfill records must carry the existing pool id');
      report.issues.push(...issues);
      report.rejected++;
      continue;
    }
    const existing = byId.get(r.id);
    if (existing === undefined) {
      push('hard', 'BACKFILL_UNKNOWN_ID', `no pool record with id "${r.id}"`);
      report.issues.push(...issues);
      report.rejected++;
      continue;
    }
    for (const v of VARIANTS) {
      if (typeof r[v] !== 'string' || (r[v] as string).trim() === '') {
        push('hard', 'MISSING_VARIANT', `\`${v}\` is required`);
      }
    }
    if (issues.some((i) => i.severity === 'hard')) {
      report.issues.push(...issues);
      report.rejected++;
      continue;
    }

    const rec = r as BackfillRecord;
    const pov = existing.markers.pov;

    // THE backfill invariant: the variant matching the record's pov MUST
    // byte-equal the stored text, or the line is rejected. This is what makes
    // backfill incapable of rewriting the original 612.
    if (pov === null) {
      push('hard', 'BACKFILL_NO_POV', 'target record has a null pov');
    } else if (pov === 'impersonal') {
      for (const v of VARIANTS) {
        if (rec[v] !== existing.text) {
          push('hard', 'BACKFILL_TEXT_MISMATCH',
            `target pov is impersonal so every variant must byte-equal the ` +
            `stored text; \`${v}\` is ${JSON.stringify(rec[v])} vs ` +
            `${JSON.stringify(existing.text)}`);
        }
      }
    } else if (rec[pov] !== existing.text) {
      push('hard', 'BACKFILL_TEXT_MISMATCH',
        `\`${pov}\` must byte-equal the stored text ` +
        `${JSON.stringify(existing.text)}, got ${JSON.stringify(rec[pov])}`);
    }
    if (issues.some((i) => i.severity === 'hard')) {
      report.issues.push(...issues);
      report.rejected++;
      continue;
    }

    // The attached variants face the same gates as generated content.
    for (const v of VARIANTS) {
      issues.push(...checkPlaceholders(rec[v], v).map((f) => ({ ...f, file: short, line: pl.line, id: rec.id })));
      issues.push(...checkContentQuality(rec[v], v, existing.base_points).map((f) => ({ ...f, file: short, line: pl.line, id: rec.id })));
    }
    const gate = checkPersonCorrectness(rec);
    issues.push(...gate.findings.map((f) => ({ ...f, file: short, line: pl.line, id: rec.id })));

    if (issues.some((i) => i.severity === 'hard')) {
      report.issues.push(...issues);
      report.rejected++;
      continue;
    }

    // Idempotence: re-applying an identical backfill is a no-op.
    const before = c.persons[rec.id];
    const already =
      before !== undefined &&
      before.first === rec.first &&
      before.second === rec.second &&
      before.named === rec.named;

    c.persons[rec.id] = {
      first: rec.first,
      second: rec.second,
      named: rec.named,
      invariant: computeInvariant(rec),
    };
    dedupe.add(rec.id, [rec.first, rec.second, rec.named]);

    // base_points and text are NEVER modified by backfill.
    if (!already) report.backfilled++;
    if (gate.machineVerified) report.machineVerified++;
    if (issues.some((i) => i.severity === 'review')) report.routedToReview++;
    report.issues.push(...issues);
  }
}

/** Re-export so the CLI has one import surface. */
export { checkIntegrity, getTier };
