/**
 * Dump the full §8.2 review queue for the ingested corpus.
 * Read-only: reports, never modifies. Complements cli.ts, whose console
 * output caps each issue list at 40 lines.
 */
import { readFileSync } from 'node:fs';
import { checkPersonCorrectness } from '../ingest/conjugation.ts';

const ROOT = process.env.CORPUS_ROOT ?? 'corpus';
const persons = JSON.parse(readFileSync(`${ROOT}/persons.json`, 'utf8')) as Record<
  string,
  { first: string | null; second: string | null; named: string | null; invariant?: boolean }
>;
const pool = JSON.parse(readFileSync(`${ROOT}/pool.json`, 'utf8')) as {
  mantras: Array<{ id: string; text: string; themes: string[]; base_points: number }>;
};
const prov = JSON.parse(readFileSync(`${ROOT}/provenance.json`, 'utf8')) as Record<
  string,
  { source: string; batch?: string }
>;
const byId = new Map(pool.mantras.map((m) => [m.id, m]));

let hard = 0;
let review = 0;
let verified = 0;
let incomplete = 0;
const rows: string[] = [];

for (const [id, v] of Object.entries(persons)) {
  if (v.first === null || v.second === null || v.named === null) {
    incomplete++;
    continue;
  }
  const r = checkPersonCorrectness({ first: v.first, second: v.second, named: v.named });
  const h = r.findings.filter((f) => f.severity === 'hard');
  if (h.length > 0) {
    hard++;
    for (const f of h) rows.push(`HARD\t${id}\t${f.code}\t${f.message}`);
    continue;
  }
  if (r.machineVerified) { verified++; continue; }
  review++;
  const m = byId.get(id);
  rows.push(
    `REVIEW\t${id}\t${prov[id]?.source ?? '?'}\t${prov[id]?.batch ?? '-'}\t` +
      `${m?.themes.join('|') ?? '?'}\t${m?.base_points ?? '?'}\t` +
      `1:${v.first}\t2:${v.second}\t3:${v.named}`,
  );
}

console.log(rows.join('\n'));
console.error(
  `\ntotal=${Object.keys(persons).length} verified=${verified} review=${review} ` +
    `hard=${hard} incomplete=${incomplete}  coverage=${
      ((verified / (verified + review)) * 100).toFixed(1)
    }%`,
);
