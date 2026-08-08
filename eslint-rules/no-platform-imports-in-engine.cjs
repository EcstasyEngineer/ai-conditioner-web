/**
 * no-platform-imports-in-engine
 *
 * DESIGN.md §1.3: `engine/` is a pure, synchronous, deterministic TypeScript
 * library. It is a function of (config, seed) and nothing else. Time enters
 * only as an explicit parameter; randomness enters only as a seeded RNG.
 *
 * This rule is the wall. It fires on any file under `engine/` that reaches for:
 *
 *   - the web shell            `web/...`, `@web/...`
 *   - a Node builtin           `fs`, `node:path`, ...
 *   - any third-party package  the engine imports ZERO of them
 *   - ambient platform globals `window`, `document`, `fetch`, `performance`,
 *                              `localStorage`, `navigator`, ...
 *   - a clock                  `Date.now()`, `new Date()`, `performance.now()`
 *   - unseeded randomness      `Math.random()`
 *
 * Imports the engine MAY make: relative paths inside `engine/`, and bare type
 * imports of nothing at all. Everything else is a violation.
 *
 * The failure mode this exists to prevent is measured and live: a browser
 * barrel re-exporting a module that calls `process.cwd()` compiles fine and
 * only explodes at runtime, in the bundle, for the user.
 */

'use strict';

/** Node builtins, with and without the `node:` prefix. */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib',
]);

/**
 * Ambient globals that only exist because a platform put them there.
 * Reading any of these makes the engine impure.
 */
const FORBIDDEN_GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'setTimeout', 'setInterval', 'setImmediate',
  'queueMicrotask', 'structuredClone',
  'alert', 'confirm', 'prompt',
  'process', 'global', 'globalThis', 'Buffer', '__dirname', '__filename',
  'require',
  'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent',
  'AudioContext', 'OffscreenCanvas', 'Worker',
]);

/** Engine files may not name DOM types either — they leak the platform into the contract. */
const FORBIDDEN_TYPES = new Set([
  'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'Element', 'Node',
  'Document', 'Window', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'CanvasRenderingContext2D', 'WebGLRenderingContext', 'WebGL2RenderingContext',
  'AudioContext', 'AudioNode', 'AudioBuffer', 'GainNode', 'OscillatorNode',
  'Response', 'Request', 'Headers', 'AbortSignal',
]);

/** `Date.now()`, `performance.now()`, `Math.random()` — impurity via member call. */
const FORBIDDEN_MEMBERS = [
  { object: 'Date', property: 'now', label: 'Date.now()' },
  { object: 'Math', property: 'random', label: 'Math.random()' },
  { object: 'performance', property: 'now', label: 'performance.now()' },
  { object: 'process', property: 'hrtime', label: 'process.hrtime()' },
  { object: 'crypto', property: 'randomUUID', label: 'crypto.randomUUID()' },
  { object: 'crypto', property: 'getRandomValues', label: 'crypto.getRandomValues()' },
];

/** True when the linted file lives under an `engine/` directory. */
function isEngineFile(filename) {
  const normalized = filename.split('\\').join('/');
  return /(^|\/)engine\//.test(normalized);
}

/** Classify an import specifier. Returns a messageId + data, or null when allowed. */
function classifySpecifier(source) {
  // Relative imports are how the engine talks to itself.
  if (source.startsWith('.') || source.startsWith('/')) {
    // ...but it may not climb out into the shell.
    if (/(^|\/)web\//.test(source)) {
      return { messageId: 'webImport', data: { source } };
    }
    return null;
  }

  if (source.startsWith('node:')) {
    return { messageId: 'nodeBuiltin', data: { source } };
  }

  // Bare specifier: strip any subpath to get the package/builtin name.
  const head = source.startsWith('@')
    ? source.split('/').slice(0, 2).join('/')
    : source.split('/')[0];

  if (NODE_BUILTINS.has(head)) {
    return { messageId: 'nodeBuiltin', data: { source } };
  }

  if (head === 'web' || head === '@web') {
    return { messageId: 'webImport', data: { source } };
  }

  // Anything else bare is a third-party package. The engine imports zero.
  return { messageId: 'thirdParty', data: { source } };
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'engine/ must not import from web/, DOM types, window, fetch, Date.now, Math.random, or Node builtins',
    },
    schema: [],
    messages: {
      webImport:
        "engine/ must not import from the web shell ('{{source}}'). The engine is platform-free; invert the dependency so web/ imports engine/.",
      nodeBuiltin:
        "engine/ must not import the Node builtin '{{source}}'. The engine runs in the browser and in Node identically; move I/O to tools/ or web/.",
      thirdParty:
        "engine/ must not import the third-party package '{{source}}'. The engine has zero runtime dependencies by design.",
      forbiddenGlobal:
        "engine/ must not reference the platform global '{{name}}'. Time enters as an explicit parameter; randomness enters as a seeded RNG.",
      forbiddenMember:
        'engine/ must not call {{label}}. The engine is deterministic from (config, seed) — pass the value in instead.',
      forbiddenType:
        "engine/ must not name the platform type '{{name}}'. A DOM type in an engine signature leaks the platform into the shared contract.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!isEngineFile(filename)) {
      return {};
    }

    /**
     * True when `name` is NOT shadowed by a user declaration — i.e. it really
     * does resolve to the ambient global.
     *
     * Without this, `const performance = { now: () => 0 }` inside a helper is
     * reported as a clock read. A rule with false positives on correct code is
     * a rule that gets switched off, so scope resolution is load-bearing.
     *
     * The GLOBAL scope is deliberately not consulted. `Date` and `Math` are
     * language built-ins that ESLint resolves there, so treating a global-scope
     * hit as "declared" would silence exactly the checks this rule exists for.
     * Only user-authored scopes shadow.
     */
    function resolvesToGlobal(node, name) {
      let scope = context.sourceCode.getScope(node);
      while (scope) {
        if (scope.type !== 'global' && scope.set.has(name)) return false;
        scope = scope.upper;
      }
      return true;
    }

    /** Report a forbidden import/require source. */
    function checkSource(node, rawSource) {
      if (typeof rawSource !== 'string') return;
      const verdict = classifySpecifier(rawSource);
      if (verdict) {
        context.report({ node, messageId: verdict.messageId, data: verdict.data });
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source.value);
      },

      ExportNamedDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },

      ExportAllDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },

      // `import('x')` and `require('x')`
      ImportExpression(node) {
        if (node.source && node.source.type === 'Literal') {
          checkSource(node, node.source.value);
        }
      },

      CallExpression(node) {
        const callee = node.callee;

        if (
          callee.type === 'Identifier' &&
          callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0].type === 'Literal'
        ) {
          checkSource(node, node.arguments[0].value);
          return;
        }

        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.object.type !== 'Identifier') return;
        if (callee.property.type !== 'Identifier') return;

        const match = FORBIDDEN_MEMBERS.find(
          (m) => m.object === callee.object.name && m.property === callee.property.name,
        );
        // `Date`/`Math`/`performance` must be the real globals. A local object
        // that happens to expose `.now()` is not a clock.
        if (match && resolvesToGlobal(callee.object, callee.object.name)) {
          context.report({ node, messageId: 'forbiddenMember', data: { label: match.label } });
        }
      },

      // `new Date()` reads the wall clock; `new Date(ms)` is a pure conversion.
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Date' &&
          node.arguments.length === 0 &&
          resolvesToGlobal(node.callee, 'Date')
        ) {
          context.report({ node, messageId: 'forbiddenMember', data: { label: 'new Date()' } });
        }
      },

      // Bare references to platform globals, resolved against scope so a local
      // variable named `performance` is not a false positive.
      Identifier(node) {
        if (!FORBIDDEN_GLOBALS.has(node.name)) return;

        const parent = node.parent;
        if (!parent) return;

        // Skip anything that is a name being declared or a property key rather
        // than a value being read.
        if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
        if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
        if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') return;
        if (parent.type === 'ExportSpecifier') return;
        if (parent.type === 'VariableDeclarator' && parent.id === node) return;
        if (parent.type === 'TSPropertySignature' && parent.key === node) return;
        if (
          (parent.type === 'FunctionDeclaration' ||
            parent.type === 'FunctionExpression' ||
            parent.type === 'ArrowFunctionExpression' ||
            parent.type === 'TSDeclareFunction') &&
          (parent.id === node || parent.params.includes(node))
        ) {
          return;
        }

        // Only flag it when it actually resolves to a global, not to something
        // declared locally.
        if (!resolvesToGlobal(node, node.name)) return;

        context.report({ node, messageId: 'forbiddenGlobal', data: { name: node.name } });
      },

      // DOM/platform type references in annotations.
      TSTypeReference(node) {
        if (node.typeName.type !== 'Identifier') return;
        if (!FORBIDDEN_TYPES.has(node.typeName.name)) return;
        if (!resolvesToGlobal(node, node.typeName.name)) return;

        context.report({
          node,
          messageId: 'forbiddenType',
          data: { name: node.typeName.name },
        });
      },
    };
  },
};
