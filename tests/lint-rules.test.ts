/**
 * Tests for M0's two local lint rules.
 *
 * These do two things a rule-installation check cannot:
 *
 *  1. Lint a DELIBERATE VIOLATION FIXTURE and assert the exact messageIds. A
 *     rule with a typo'd selector reports nothing and looks like a passing repo.
 *  2. Lint a CLEAN FIXTURE and assert zero errors. A rule that fires on correct
 *     code gets disabled within a day, which is the same as not having it.
 *
 * The rules are exercised through a real ESLint instance with the real parser,
 * not through RuleTester with hand-built ASTs, so the config wiring is under
 * test too.
 */

import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tseslint from 'typescript-eslint';
import noPlatformImportsInEngine from '../eslint-rules/no-platform-imports-in-engine.cjs';
import noSetIntervalInSessionPath from '../eslint-rules/no-set-interval-in-session-path.cjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(repoRoot, 'eslint-rules', '__fixtures__');

const plugin = {
  rules: {
    'no-platform-imports-in-engine': noPlatformImportsInEngine,
    'no-set-interval-in-session-path': noSetIntervalInSessionPath,
  },
};

/**
 * Lint one fixture file with only the rule under test enabled.
 * `overrideConfigFile: true` detaches from the project config so the fixture's
 * ignore entry does not swallow the run.
 */
async function lintFixture(relativePath: string, ruleId: string): Promise<ESLint.LintResult> {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser as never,
          ecmaVersion: 2022,
          sourceType: 'module',
        },
        plugins: { hypnoapp: plugin },
        rules: { [`hypnoapp/${ruleId}`]: 'error' },
      },
    ],
  });

  const results = await eslint.lintFiles([path.join(fixtures, relativePath)]);
  expect(results).toHaveLength(1);
  return results[0];
}

const messageIds = (result: ESLint.LintResult): string[] =>
  result.messages.map((m) => m.messageId ?? '');

describe('no-platform-imports-in-engine', () => {
  it('fires on the deliberate violation fixture', async () => {
    const result = await lintFixture('engine/violations.ts', 'no-platform-imports-in-engine');
    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('catches every category of platform leak', async () => {
    const result = await lintFixture('engine/violations.ts', 'no-platform-imports-in-engine');
    const ids = new Set(messageIds(result));

    // Node builtins: `fs` and `node:path`.
    expect(ids).toContain('nodeBuiltin');
    // A third-party package: `react`.
    expect(ids).toContain('thirdParty');
    // Reaching into the shell: `../../web/session/mountSession`.
    expect(ids).toContain('webImport');
    // Ambient platform globals: window, fetch, localStorage, document.
    expect(ids).toContain('forbiddenGlobal');
    // Impure member calls: Date.now, Math.random, performance.now, new Date().
    expect(ids).toContain('forbiddenMember');
    // A DOM type in a signature: HTMLElement.
    expect(ids).toContain('forbiddenType');
  });

  it('names each banned clock and randomness source individually', async () => {
    const result = await lintFixture('engine/violations.ts', 'no-platform-imports-in-engine');
    const text = result.messages.map((m) => m.message).join('\n');

    expect(text).toContain('Date.now()');
    expect(text).toContain('Math.random()');
    expect(text).toContain('performance.now()');
    expect(text).toContain('new Date()');
  });

  it('reports zero errors on correct engine code', async () => {
    const result = await lintFixture('engine/clean.ts', 'no-platform-imports-in-engine');
    expect(messageIds(result)).toEqual([]);
    expect(result.errorCount).toBe(0);
  });

  it('is inert outside engine/', async () => {
    // The same platform calls the engine may not make are perfectly legal in web/.
    const result = await lintFixture(
      'web/session/interval-clean.ts',
      'no-platform-imports-in-engine',
    );
    expect(result.errorCount).toBe(0);
  });
});

describe('no-set-interval-in-session-path', () => {
  it('fires on every form of repeating timer', async () => {
    const result = await lintFixture(
      'web/session/interval-violation.ts',
      'no-set-interval-in-session-path',
    );

    // setInterval, window.setInterval, globalThis.setInterval,
    // window['setInterval'], setImmediate.
    expect(result.errorCount).toBe(5);
    expect(new Set(messageIds(result))).toEqual(new Set(['noSetInterval']));
  });

  it('explains the backgrounded-tab failure mode in the message', async () => {
    const result = await lintFixture(
      'web/session/interval-violation.ts',
      'no-set-interval-in-session-path',
    );
    expect(result.messages[0].message).toContain('requestAnimationFrame');
    expect(result.messages[0].message).toContain('visibilitychange');
  });

  it('allows a rAF clock and a one-shot setTimeout', async () => {
    const result = await lintFixture(
      'web/session/interval-clean.ts',
      'no-set-interval-in-session-path',
    );
    expect(messageIds(result)).toEqual([]);
    expect(result.errorCount).toBe(0);
  });

  it('is inert outside the session path', async () => {
    // engine/clean.ts is in the session path by default, so use a rule instance
    // configured with a narrower path list to prove scoping works.
    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: tseslint.parser as never,
            ecmaVersion: 2022,
            sourceType: 'module',
          },
          plugins: { hypnoapp: plugin },
          rules: {
            'hypnoapp/no-set-interval-in-session-path': [
              'error',
              { paths: ['web/setup/'] },
            ],
          },
        },
      ],
    });

    const results = await eslint.lintFiles([
      path.join(fixtures, 'web/session/interval-violation.ts'),
    ]);
    expect(results[0].errorCount).toBe(0);
  });
});

describe('project lint configuration', () => {
  it('registers both rules as errors, not warnings', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const config = await eslint.calculateConfigForFile(
      path.join(repoRoot, 'engine/placeholder.ts'),
    );

    expect(config.rules?.['hypnoapp/no-platform-imports-in-engine']?.[0]).toBe(2);
    expect(config.rules?.['hypnoapp/no-set-interval-in-session-path']?.[0]).toBe(2);
  });
});
