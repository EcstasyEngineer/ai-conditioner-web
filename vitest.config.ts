import { defineConfig } from 'vitest/config';

/**
 * Vitest runs in Node with no DOM by default.
 *
 * That is not an oversight: the engine is a pure library and every engine test
 * must pass without a browser shim. A test that needs `document` is a test of
 * web/, and it opts in per-file with `// @vitest-environment jsdom`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'engine/**/*.test.ts', 'web/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'eslint-rules/__fixtures__/**'],
    // A test file that imports a broken module should fail the run, not be
    // silently skipped as "no tests found".
    passWithNoTests: false,
  },
});
