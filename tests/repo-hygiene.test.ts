/**
 * M0's guarantees, asserted as tests.
 *
 * Deletions and config edits are not durable by themselves — the next change to
 * CI, or the next merge, can quietly reintroduce any of them. These tests are
 * what makes the cleanup a property of the repo rather than an event in its
 * history.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p: string[]) => path.join(repoRoot, ...p);
const read = (...p: string[]) => readFileSync(at(...p), 'utf8');

/** Walk the tree, skipping directories that are not ours to police. */
function walk(dir: string, out: string[] = []): string[] {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', 'corpus', 'public']);
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('dead directories are gone', () => {
  // assets/ was a byte-identical duplicate of public/shaders + public/images.
  // research/ was ~40MB of notebooks. The rest are pre-rewrite architecture.
  const removed = [
    'assets',
    'research',
    'ontologies',
    'hypnosis',
    'lib/pattern-compiler',
    'lib/session-engine',
    'src',
    'types',
    'scripts',
  ];

  it.each(removed)('%s no longer exists', (dir) => {
    expect(existsSync(at(dir))).toBe(false);
  });

  it('requirements.txt is gone — it listed discord.py in a TypeScript SPA', () => {
    expect(existsSync(at('requirements.txt'))).toBe(false);
  });

  it('keeps what the later modules actually consume', () => {
    // M6 lifts the drone; M5's verb table imports the salvaged conjugations;
    // M6 renders the shaders. Deleting these would break live work.
    expect(existsSync(at('lib/drone.ts'))).toBe(true);
    expect(existsSync(at('lib/tts/verb-conjugations.ts'))).toBe(true);
    expect(existsSync(at('public/shaders'))).toBe(true);
    expect(existsSync(at('corpus/pool.json'))).toBe(true);
    expect(existsSync(at('tools/ingest'))).toBe(true);
    expect(existsSync(at('docs/v1/DESIGN.md'))).toBe(true);
  });
});

describe('Next-era residue is gone', () => {
  it('has no NextAuth type shim', () => {
    expect(existsSync(at('types/next-auth.d.ts'))).toBe(false);
  });

  it('names no Prisma or NextAuth anywhere in the build spine', () => {
    // docs/v1/ is allowed to DESCRIBE the fossils it removed; build files are not.
    const buildFiles = [
      'package.json',
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      'tsconfig.json',
      'vite.config.ts',
    ];

    for (const file of buildFiles) {
      const content = read(file);
      expect(content, `${file} still references Prisma`).not.toMatch(/prisma/i);
      expect(content, `${file} still references NextAuth`).not.toMatch(/nextauth/i);
      expect(content, `${file} still references Next.js`).not.toMatch(/next[._-]?telemetry/i);
    }
  });
});

describe('CI fails on failure', () => {
  const ci = read('.github/workflows/ci.yml');

  it('carries zero continue-on-error steps', () => {
    // MEASURED before M0: 5 of them. A green check meant nothing.
    //
    // Matched as a YAML KEY (`continue-on-error:`), not as a substring, so the
    // comment in ci.yml explaining why the key is banned does not trip its own
    // assertion. Commented-out occurrences are stripped first.
    const uncommented = ci
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    expect(uncommented).not.toMatch(/continue-on-error\s*:/);
  });

  it('runs lint, typecheck, test and build as blocking steps', () => {
    expect(ci).toMatch(/npm run lint/);
    expect(ci).toMatch(/npm run typecheck/);
    expect(ci).toMatch(/npm run test:run/);
    expect(ci).toMatch(/npm run build/);
  });

  it('does not claim in prose that it is non-blocking', () => {
    expect(ci).not.toMatch(/does not block/i);
  });
});

describe('the session path holds no repeating timers', () => {
  it('no shipped source file mentions a repeating timer', () => {
    // The AST lint rule is the enforcement. This is the belt to its braces: it
    // scans the SHIPPED trees only, so it also catches a timer smuggled in as a
    // string or in a path the rule is not yet scoped to.
    //
    // Deliberately scoped to engine/ + web/ rather than the whole repo. The
    // rule implementation and this test must be able to NAME the thing they
    // ban; scanning themselves for it is a paradox, not a safeguard.
    const shipped = ['engine', 'web']
      .map((d) => at(d))
      .filter((d) => existsSync(d))
      .flatMap((d) => walk(d));

    const offenders = shipped
      .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
      .filter((f) => /setInterval|setImmediate/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(repoRoot, f));

    expect(offenders).toEqual([]);
  });
});

describe('the Node-only firewall is written down', () => {
  const browserTsconfig = JSON.parse(read('tsconfig.json'));
  const toolsTsconfig = JSON.parse(read('tsconfig.tools.json'));

  it('tools/ is excluded from the browser tsconfig', () => {
    const include: string[] = browserTsconfig.include ?? [];
    expect(include.some((p) => p.startsWith('tools'))).toBe(false);

    const exclude: string[] = browserTsconfig.exclude ?? [];
    expect(exclude).toContain('tools');
  });

  it('tools/ has its own entry point that includes only tools/', () => {
    expect(toolsTsconfig.include).toEqual(['tools']);
  });

  it('the browser tsconfig grants no Node types', () => {
    // The measured hazard: a browser barrel re-exporting a module that imports
    // `fs` and calls `process.cwd()`. Without `@types/node` in scope, that fails
    // to compile instead of failing in the user's tab.
    const types: string[] | undefined = browserTsconfig.compilerOptions?.types;
    expect(types).toBeDefined();
    expect(types).not.toContain('node');
  });

  it('the tools tsconfig grants no DOM lib', () => {
    const lib: string[] = toolsTsconfig.compilerOptions?.lib ?? [];
    expect(lib.some((l) => /dom/i.test(l))).toBe(false);
  });

  it('no browser-side file imports from tools/', () => {
    const browserFiles = walk(repoRoot).filter(
      (f) =>
        /\.(ts|tsx)$/.test(f) &&
        (f.includes(`${path.sep}engine${path.sep}`) || f.includes(`${path.sep}web${path.sep}`)) &&
        !f.includes('__fixtures__'),
    );

    for (const file of browserFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content, `${path.relative(repoRoot, file)} imports from tools/`).not.toMatch(
        /from\s+['"][^'"]*\btools\//,
      );
    }
  });
});

describe('the build spine exists', () => {
  const pkg = JSON.parse(read('package.json'));

  it.each(['lint', 'typecheck', 'test', 'test:run', 'build'])('npm run %s is defined', (script) => {
    expect(pkg.scripts?.[script]).toBeTruthy();
  });

  it('npm test exits on failure rather than watching', () => {
    // `vitest` with no subcommand watches in a TTY and never exits — in CI that
    // is a hang, and locally it is a test suite that never reports a verdict.
    expect(pkg.scripts.test).toMatch(/vitest run/);
    expect(pkg.scripts['test:run']).toMatch(/vitest run/);
  });

  it('typecheck covers both the browser tree and the Node toolchain', () => {
    expect(pkg.scripts.typecheck).toMatch(/tsconfig\.tools\.json/);
  });

  it('declares the engine free of side effects', () => {
    expect(pkg.sideEffects).toBe(false);
  });

  it('lints the two local rule files as part of the lint script', () => {
    expect(existsSync(at('eslint-rules/no-platform-imports-in-engine.cjs'))).toBe(true);
    expect(existsSync(at('eslint-rules/no-set-interval-in-session-path.cjs'))).toBe(true);
    expect(existsSync(at('eslint.config.js'))).toBe(true);
  });
});

describe('the deployment decision is recorded', () => {
  const deployment = read('docs/v1/DEPLOYMENT.md');

  it('records base path, router mode and SPA fallback', () => {
    expect(deployment).toMatch(/base path/i);
    expect(deployment).toMatch(/router/i);
    expect(deployment).toMatch(/fallback/i);
    expect(deployment).toMatch(/hard.refresh/i);
  });

  it('matches the base configured in vite.config.ts', () => {
    // A recorded decision that drifts from the build config is worse than none.
    const vite = read('vite.config.ts');
    const configured = vite.match(/base:\s*'([^']*)'/)?.[1];
    expect(configured).toBeDefined();
    expect(deployment).toContain(`\`${configured}\``);
  });
});
