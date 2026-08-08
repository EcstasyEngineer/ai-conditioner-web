/**
 * `session:dump` — DESIGN.md §9 D2, MODULES.json M7.
 *
 *     npm run session:dump -- --config <path> --seed <n>
 *
 * Renders a `SessionPlan` to readable text so a reviewer can confirm the arc —
 * gentle open, build, peak, wean, wake — WITHOUT sitting through twenty minutes.
 * MODULES.json says why this is its own deliverable rather than a debugging
 * convenience: "if the headless reader is nobody's job it does not get built —
 * and it is the tool Phase D uses to verify the arc".
 *
 * WHAT MAKES THE OUTPUT REVIEWABLE, as opposed to merely complete:
 *
 *   The default view is a SUMMARY, not 353 ticks. A dump nobody reads verifies
 *   nothing, and a full transcript of a 20-minute session is 1,059 lines of
 *   mantra. The summary prints the phase table, the intensity and dwell traces
 *   as sparklines, the person-drift deciles and the theme walk — the five things
 *   D2 asks a reviewer to confirm — and `--full` prints every tick for when the
 *   question is about one specific step.
 *
 *   Substitution is APPLIED. The plan carries raw templates (§2.4), so an
 *   unsubstituted dump would show `{subject}` where the session shows a name,
 *   and a reviewer would be checking a session no user will ever see.
 *
 *   Diagnostics are printed ALONGSIDE, never folded in. §4.10's whole point is
 *   that degradation is typed data rather than a log line; a dump that buried
 *   `lane-starved` in the middle of a transcript would undo that.
 *
 * This file is Node-only and lives under `tools/` (tsconfig.tools.json). It
 * imports the engine — that arrow is allowed and is the point, since the dump
 * must render the SAME plan the browser renders — and the engine imports nothing
 * back.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import type { Corpus } from '../../engine/types/record.ts';
import type { SessionOptions, UserConfig } from '../../engine/types/config.ts';
import type { SessionPlan, TripletTick } from '../../engine/types/plan.ts';
import type { Diagnostic } from '../../engine/types/diagnostic.ts';
import type { LaneId } from '../../engine/types/frame.ts';
import { isLoadFailure, loadCorpus } from '../../engine/corpus/load.ts';
import { isPlanFailure, plan } from '../../engine/plan/plan.ts';
import { substitute } from '../../engine/render/substitute.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parsed argv. Every flag has a default so a bare invocation still works. */
export interface DumpArgs {
  configPath: string | null;
  seed: number;
  full: boolean;
  corpusDir: string;
  /** Override the derived length. Useful for reading an arc without 353 ticks. */
  length: number | null;
}

/**
 * Parse argv.
 *
 * Hand-rolled rather than pulled from a dependency: the tool has four flags, and
 * an unknown flag is a HARD ERROR rather than an ignored token — a typo'd
 * `--seeed` that silently dumped seed 0 would have a reviewer sign off on the
 * wrong session.
 */
export function parseArgs(argv: readonly string[]): DumpArgs {
  const args: DumpArgs = {
    configPath: null,
    seed: 0,
    full: false,
    corpusDir: path.join(repoRoot, 'corpus'),
    length: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--config':
        args.configPath = argv[++i] ?? null;
        break;
      case '--seed': {
        const raw = argv[++i];
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`--seed needs a number, got ${String(raw)}`);
        args.seed = value;
        break;
      }
      case '--length': {
        const raw = argv[++i];
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`--length needs a positive integer, got ${String(raw)}`);
        }
        args.length = value;
        break;
      }
      case '--corpus':
        args.corpusDir = argv[++i] ?? args.corpusDir;
        break;
      case '--full':
        args.full = true;
        break;
      default:
        throw new Error(
          `unknown argument ${JSON.stringify(arg)}; usage: session:dump -- --config <path> --seed <n> [--length <n>] [--full]`,
        );
    }
  }

  return args;
}

/** Read and validate the corpus from a directory of the three JSON files. */
export function readCorpus(corpusDir: string): Corpus {
  const read = (file: string): unknown =>
    JSON.parse(readFileSync(path.join(corpusDir, file), 'utf8')) as unknown;

  const result = loadCorpus(read('pool.json'), read('persons.json'), read('provenance.json'));
  if (isLoadFailure(result)) {
    const lines = result.slice(0, 10).map((e) => `  ${e.kind}: ${e.message}`);
    throw new Error(`corpus failed validation:\n${lines.join('\n')}`);
  }
  return result;
}

/** The characters an intensity or dwell trace is drawn with, low to high. */
const SPARK = ' .:-=+*#%@';

/**
 * A sparkline over a numeric series, normalized to its own min and max.
 *
 * Self-normalizing rather than fixed to [0,1] on purpose: the point of the trace
 * is the SHAPE — does it rise once and fall once — and a bell that happens to
 * live between 0.3 and 0.7 would render as a flat line against an absolute
 * scale, hiding exactly what the reviewer is looking for.
 */
export function sparkline(values: readonly number[], width = 60): string {
  if (values.length === 0) return '';

  // Bucket into `width` columns so a 353-step session fits on one line.
  const columns: number[] = [];
  for (let c = 0; c < width; c += 1) {
    const from = Math.floor((c * values.length) / width);
    const to = Math.max(from + 1, Math.floor(((c + 1) * values.length) / width));
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += values[i];
    columns.push(sum / (to - from));
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of columns) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;

  return columns
    .map((v) => {
      const t = span === 0 ? 0 : (v - min) / span;
      const at = Math.min(SPARK.length - 1, Math.floor(t * SPARK.length));
      return SPARK[at];
    })
    .join('');
}

/** The share of side-lane content in each person, per decile — §4.6's drift. */
export function personDeciles(ticks: readonly TripletTick[]): { named: number[]; first: number[] } {
  const named = new Array<number>(10).fill(0);
  const first = new Array<number>(10).fill(0);
  const counts = new Array<number>(10).fill(0);

  ticks.forEach((tick, i) => {
    const decile = Math.min(9, Math.floor((i / ticks.length) * 10));
    for (const lane of ['left', 'right'] as const) {
      counts[decile] += 1;
      if (tick[lane].person === 'named') named[decile] += 1;
      if (tick[lane].person === 'first') first[decile] += 1;
    }
  });

  return {
    named: named.map((n, i) => (counts[i] === 0 ? 0 : n / counts[i])),
    first: first.map((n, i) => (counts[i] === 0 ? 0 : n / counts[i])),
  };
}

/** `mm:ss` from milliseconds. */
function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** The theme walk as a run-length list — §4.4's hold-then-pivot, made visible. */
export function themeRuns(ticks: readonly TripletTick[]): { theme: string; from: number; to: number }[] {
  const runs: { theme: string; from: number; to: number }[] = [];
  for (const tick of ticks) {
    const last = runs[runs.length - 1];
    if (last !== undefined && last.theme === tick.theme) last.to = tick.step;
    else runs.push({ theme: tick.theme, from: tick.step, to: tick.step });
  }
  return runs;
}

/** One tick, as three lanes of substituted text. */
function renderTick(tick: TripletTick, config: UserConfig, elapsedMs: number): string {
  const lanes: LaneId[] = ['left', 'center', 'right'];
  const head = `  #${String(tick.step).padStart(3)} ${clock(elapsedMs).padStart(5)} ${tick.phase.padEnd(6)} ${tick.theme.padEnd(16)} i=${tick.intensity.toFixed(3)} ${String(Math.round(tick.dwellMs)).padStart(4)}ms`;
  const body = lanes.map((lane) => {
    const content = tick[lane];
    const text = substitute(content.text, config.names);
    return `        ${lane.padEnd(6)} ${content.person.padEnd(6)} ${text}`;
  });
  return [head, ...body].join('\n');
}

/** Diagnostics, grouped by kind so 200 of one thing is one line. */
function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'DIAGNOSTICS\n  none — the plan degraded nowhere.';
  }
  const byKind = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const bucket = byKind.get(d.kind);
    if (bucket === undefined) byKind.set(d.kind, [d]);
    else bucket.push(d);
  }
  const lines = ['DIAGNOSTICS'];
  for (const [kind, list] of byKind) {
    lines.push(`  ${kind} × ${list.length}`);
    // Three examples is enough to characterize a group; the rest are the same
    // finding and would push the arc off the reviewer's screen.
    for (const d of list.slice(0, 3)) lines.push(`    ${JSON.stringify(d)}`);
    if (list.length > 3) lines.push(`    … and ${list.length - 3} more`);
  }
  return lines.join('\n');
}

/**
 * The transcript.
 *
 * Structured so a reviewer reads it top to bottom and answers D2's question by
 * the time they hit the diagnostics: the phase table says the session has a
 * shape, the traces say the shape is a bell, the deciles say the person drift
 * goes out AND comes back, and the samples say the content matches the phase it
 * sits in.
 */
export function renderDump(
  sessionPlan: SessionPlan,
  config: UserConfig,
  options: { full: boolean } = { full: false },
): string {
  const { meta, ticks } = sessionPlan;
  const out: string[] = [];

  // Elapsed time at each tick, so the sample rows can be timestamped.
  const elapsed: number[] = [];
  let running = 0;
  for (const tick of ticks) {
    elapsed.push(running);
    running += tick.dwellMs;
  }

  out.push('SESSION');
  out.push(`  seed          ${meta.seed}`);
  out.push(`  mode          ${meta.mode}`);
  out.push(`  length        ${meta.length} steps`);
  out.push(`  content       ${clock(meta.contentMs)}`);
  out.push(`  total         ${clock(meta.totalMs)} (+${meta.tailQuietMs}ms quiet, ${meta.tailFadeMs}ms fade)`);
  out.push(`  names         ${meta.subjectName} / ${meta.operatorName}`);
  out.push(`  bed           ${sessionPlan.bed.preset} at ${sessionPlan.bed.gainDb}dB`);
  out.push('');

  out.push('PHASES');
  out.push(`  head    ${String(meta.head).padStart(4)} steps  ${clock(0)}–${clock(elapsed[meta.head] ?? meta.contentMs)}`);
  out.push(
    `  middle  ${String(meta.middle).padStart(4)} steps  ${clock(elapsed[meta.head] ?? 0)}–${clock(elapsed[meta.head + meta.middle] ?? meta.contentMs)}`,
  );
  out.push(
    `  tail    ${String(meta.tail).padStart(4)} steps  ${clock(elapsed[meta.head + meta.middle] ?? 0)}–${clock(meta.contentMs)}`,
  );
  out.push('');

  // The arc, as two traces. Intensity should rise once and fall once; dwell
  // should do the same INVERTED and slightly later (§4.9's phase offset).
  out.push('ARC');
  out.push(`  intensity  ${sparkline(ticks.map((t) => t.intensity))}`);
  out.push(`  dwell      ${sparkline(ticks.map((t) => t.dwellMs))}`);
  out.push('             (dwell is inverted against intensity: tight at the peak, spacious at the ends)');
  out.push('');

  const deciles = personDeciles(ticks);
  out.push('PERSON DRIFT (side lanes, by decile)');
  out.push(`  named   ${deciles.named.map((v) => pct(v).padStart(5)).join('')}`);
  out.push(`  first   ${deciles.first.map((v) => pct(v).padStart(5)).join('')}`);
  out.push('          the named share goes out and comes BACK — a session that leaves you');
  out.push('          dissociated is one you resent afterward (§4.6).');
  out.push('');

  const runs = themeRuns(ticks);
  out.push(`THEME WALK (${runs.length} holds)`);
  for (const run of runs) {
    out.push(`  ${String(run.from).padStart(4)}–${String(run.to).padStart(4)}  ${run.theme}`);
  }
  out.push('');

  if (options.full) {
    out.push('TRANSCRIPT');
    ticks.forEach((tick, i) => out.push(renderTick(tick, config, elapsed[i])));
  } else {
    // Five samples across the arc: the open, the build, the peak, the wean and
    // the wake. These are the five words D2 uses, and they are what the sample
    // positions are chosen to land on.
    out.push('SAMPLES  (open · build · peak · wean · wake — --full prints every step)');
    const marks: [string, number][] = [
      ['open ', 0],
      ['build', Math.floor(ticks.length * 0.3)],
      ['peak ', Math.floor(ticks.length * 0.5)],
      ['wean ', Math.floor(ticks.length * 0.75)],
      ['wake ', ticks.length - 1],
    ];
    for (const [label, at] of marks) {
      const i = Math.min(Math.max(at, 0), ticks.length - 1);
      out.push(`  ${label}`);
      out.push(renderTick(ticks[i], config, elapsed[i]));
    }
  }
  out.push('');

  out.push(renderDiagnostics(sessionPlan.diagnostics));

  return out.join('\n');
}

/** Read a `UserConfig` from a JSON file, ignoring `_comment` keys. */
export function readConfig(configPath: string): UserConfig {
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  delete raw._comment;
  return raw as unknown as UserConfig;
}

/**
 * The CLI entry.
 *
 * Returns an exit code rather than calling `process.exit`, so a test can drive
 * it without tearing down the test runner.
 */
export function main(argv: readonly string[], write: (line: string) => void = console.log): number {
  let args: DumpArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    write(String(error instanceof Error ? error.message : error));
    return 2;
  }

  if (args.configPath === null) {
    write('usage: npm run session:dump -- --config <path> --seed <n> [--length <n>] [--full]');
    return 2;
  }

  let corpus: Corpus;
  let config: UserConfig;
  try {
    corpus = readCorpus(args.corpusDir);
    config = readConfig(args.configPath);
  } catch (error) {
    write(String(error instanceof Error ? error.message : error));
    return 1;
  }

  const options: Partial<SessionOptions> = {};
  const result = plan(
    corpus,
    config,
    options,
    args.seed,
    args.length === null ? {} : { length: args.length },
  );

  if (isPlanFailure(result)) {
    // §6.3's doctrine reaches the CLI too: a refusal names the fix, so a
    // reviewer whose config starves learns what to change from the dump itself.
    write('THIS CONFIG CANNOT BE PLANNED');
    for (const error of result) write(`  ${error.kind}: ${error.message}\n    fix: ${error.fix}`);
    return 1;
  }

  write(renderDump(result, config, { full: args.full }));
  return 0;
}

// `process.argv[1]` is the script path; comparing against this module's own URL
// is what keeps the CLI from running when a test imports `renderDump`.
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
