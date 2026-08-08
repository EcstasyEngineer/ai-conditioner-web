/**
 * ESLint flat config.
 *
 * ESLint 9 resolves `eslint.config.js` and does not read `.eslintrc.cjs`
 * without an explicit compatibility opt-in, so the flat config is the real
 * one — there is deliberately no second config file to drift against it.
 *
 * Two local rules carry M0's guarantees (DESIGN.md §1.3, §5.4):
 *
 *   hypnoapp/no-platform-imports-in-engine   engine/ stays pure
 *   hypnoapp/no-set-interval-in-session-path the session clock stays rAF
 *
 * Both are errors. Neither has a warn tier: a rule that only warns is a rule
 * that gets scrolled past.
 */

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import noPlatformImportsInEngine from './eslint-rules/no-platform-imports-in-engine.cjs';
import noSetIntervalInSessionPath from './eslint-rules/no-set-interval-in-session-path.cjs';

const hypnoapp = {
  rules: {
    'no-platform-imports-in-engine': noPlatformImportsInEngine,
    'no-set-interval-in-session-path': noSetIntervalInSessionPath,
  },
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'public/**',
      'corpus/**',
      // Fixtures for the local rules are violations ON PURPOSE. They are linted
      // by the rule tests, which assert the errors, not by the project lint run.
      'eslint-rules/__fixtures__/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: { hypnoapp },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // The rules that make M0 mean something. Everywhere: the engine rule is a
      // no-op outside engine/, the interval rule a no-op outside the session path.
      'hypnoapp/no-platform-imports-in-engine': 'error',
      'hypnoapp/no-set-interval-in-session-path': 'error',

      // Unused code is a review distraction, but an intentionally-unused
      // parameter is a legitimate signature. Underscore is the escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // The engine is browser-and-Node-agnostic: it gets NO platform globals at all.
  // An undeclared `window` here is an undefined variable, not an ambient global.
  {
    files: ['engine/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {},
    },
  },

  // The web shell is a browser.
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // tools/ is Node-only and firewalled from the browser bundle by
  // tsconfig.tools.json. Node globals are correct here and nowhere else.
  {
    files: ['tools/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Config files at the root run in Node.
  {
    files: ['*.config.{js,ts}', '*.config.*.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Local rule implementations are CommonJS running in Node.
  {
    files: ['eslint-rules/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },

  // Tests run under Vitest in Node.
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
