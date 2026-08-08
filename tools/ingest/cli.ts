#!/usr/bin/env node
/**
 * Corpus CLI — CORPUS_SPEC.md §6, §8.
 *
 *   npm run corpus:ingest -- corpus/raw/*.jsonl
 *   npm run corpus:ingest -- --import <pool.json> [--source conditioner-pool]
 *   npm run corpus:report
 *   npm run corpus:lint   -- corpus/raw/*.jsonl     (dry run, writes nothing)
 *
 * Node-only. Nothing here may be imported by the browser bundle.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyCorpus, loadCorpus, saveCorpus, checkIntegrity } from './store.ts';
import { ingest } from './ingest.ts';
import { importPool } from './importPool.ts';
import { formatReport } from './report.ts';
import { tableConflicts } from './verbTable.ts';
import type { Issue } from './types.ts';

const CORPUS_ROOT = process.env.CORPUS_ROOT ?? 'corpus';

function printIssues(issues: Issue[], limit = 40): void {
  const hard = issues.filter((i) => i.severity === 'hard');
  const review = issues.filter((i) => i.severity === 'review');
  const show = (list: Issue[], label: string) => {
    if (list.length === 0) return;
    console.log(`\n${label} (${list.length}):`);
    for (const i of list.slice(0, limit)) {
      console.log(`  ${i.file}:${i.line}  [${i.code}] ${i.message}`);
    }
    if (list.length > limit) console.log(`  ... and ${list.length - limit} more`);
  };
  show(hard, 'HARD - rejected');
  show(review, 'REVIEW QUEUE - must reach zero before ship');
}

function main(): number {
  const [, , command, ...rest] = process.argv;

  const conflicts = tableConflicts();
  if (conflicts.length > 0 && command !== 'report') {
    console.log(
      `verb table: deduped ${conflicts.length} conflicting entry/entries ` +
        `(dropped ${conflicts.map((c) => `"${c}"`).join(', ')}; ` +
        'kept the first occurrence per §8.2)',
    );
  }

  switch (command) {
    case 'ingest':
    case 'lint': {
      const dryRun = command === 'lint';
      const corpus = loadCorpus(CORPUS_ROOT);

      const importIdx = rest.indexOf('--import');
      if (importIdx !== -1) {
        const poolPath = rest[importIdx + 1];
        if (poolPath === undefined) {
          console.error('--import needs a path to a pool.json');
          return 2;
        }
        const srcIdx = rest.indexOf('--source');
        const source = srcIdx !== -1 ? rest[srcIdx + 1] : undefined;
        const r = importPool(corpus, resolve(poolPath), source);
        console.log(
          `imported ${r.added} records (${r.skipped} already present) ` +
            `from ${poolPath}`,
        );
        console.log(
          `  derived pov: ` +
            Object.entries(r.povCounts)
              .map(([k, v]) => `${k}=${v}`)
              .join('  '),
        );
        if (r.mixed.length > 0) {
          console.log(`  MIXED STANCE (not imported): ${r.mixed.join(', ')}`);
        }
      }

      const files = rest.filter((a) => a.endsWith('.jsonl'));
      const missing = files.filter((f) => !existsSync(f));
      if (missing.length > 0) {
        console.error(`no such file: ${missing.join(', ')}`);
        return 2;
      }

      const report = files.length > 0
        ? ingest({ files, corpus })
        : null;

      if (report) {
        console.log(
          `\nread ${report.linesRead} lines from ${report.filesRead} file(s): ` +
            `${report.accepted} accepted, ${report.rejected} rejected, ` +
            `${report.backfilled} backfilled`,
        );
        printIssues(report.issues);
      }

      const violations = checkIntegrity(corpus);
      if (violations.length > 0) {
        console.error(`\nB8 sidecar integrity FAILED (${violations.length}):`);
        for (const v of violations.slice(0, 20)) {
          console.error(`  ${v.id}: ${v.reason}`);
        }
        return 1;
      }
      console.log(`\nB8 sidecar integrity: PASS (${corpus.pool.mantras.length} records)`);

      if (dryRun) {
        console.log('lint: dry run, nothing written');
      } else {
        saveCorpus(CORPUS_ROOT, corpus);
        console.log(`wrote ${CORPUS_ROOT}/{pool,persons,provenance}.json`);
      }

      console.log(
        formatReport(corpus, {
          machineVerified: report?.machineVerified,
          routedToReview: report?.routedToReview,
        }),
      );

      const hardCount = report?.issues.filter((i) => i.severity === 'hard').length ?? 0;
      return hardCount > 0 ? 1 : 0;
    }

    case 'report': {
      const corpus = existsSync(`${CORPUS_ROOT}/pool.json`)
        ? loadCorpus(CORPUS_ROOT)
        : emptyCorpus();
      console.log(formatReport(corpus));
      return 0;
    }

    default:
      console.error(
        'usage: cli.ts <ingest|lint|report> [--import <pool.json>] [files...]',
      );
      return 2;
  }
}

process.exit(main());
