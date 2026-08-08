/**
 * no-set-interval-in-session-path
 *
 * DESIGN.md §5.4: the conductor's `elapsedMs` comes from `performance.now()`
 * read inside a `requestAnimationFrame` loop. `setInterval` is forbidden.
 *
 * The failure mode is not theoretical. Backgrounded tabs throttle timers, so a
 * `setInterval`-driven player accumulates a backlog while the tab is hidden and
 * dumps a dozen queued lines the instant the user switches back — the exact
 * opposite of the experience being built. A rAF loop simply stops ticking when
 * the tab is hidden, and the session pauses on `visibilitychange`.
 *
 * The rule covers the SESSION PATH: `engine/`, `web/session/`, `web/play/`,
 * `web/backdrop/`, `web/audio/`. Configure `paths` to extend it. Setup screens,
 * build tooling and ingest scripts are outside the path and unaffected — a
 * debounce on a config form is not a session clock.
 *
 * `setTimeout` is deliberately NOT banned: a one-shot delay for a fade or a
 * threshold beat is fine. A repeating tick is what corrupts the clock.
 */

'use strict';

const DEFAULT_PATHS = [
  'engine/',
  'web/session/',
  'web/play/',
  'web/backdrop/',
  'web/audio/',
];

/** Names that establish a repeating timer no matter how they are reached. */
const BANNED_CALLEES = new Set(['setInterval', 'setImmediate']);

function normalize(filename) {
  return filename.split('\\').join('/');
}

/** True when `filename` sits under any configured session-path prefix. */
function inSessionPath(filename, paths) {
  const normalized = normalize(filename);
  return paths.some((p) => {
    const prefix = p.endsWith('/') ? p : `${p}/`;
    return normalized.includes(`/${prefix}`) || normalized.startsWith(prefix);
  });
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'setInterval must not appear in the session path; the session clock is performance.now() inside requestAnimationFrame',
    },
    schema: [
      {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noSetInterval:
        'setInterval is forbidden in the session path. Backgrounded tabs throttle timers and release a burst of queued steps on return. Drive the session from performance.now() inside a requestAnimationFrame loop and pause on visibilitychange.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const paths = options.paths ?? DEFAULT_PATHS;

    const filename = context.filename ?? context.getFilename();
    if (!inSessionPath(filename, paths)) {
      return {};
    }

    function report(node) {
      context.report({ node, messageId: 'noSetInterval' });
    }

    return {
      // setInterval(...)
      'CallExpression > Identifier.callee'(node) {
        if (BANNED_CALLEES.has(node.name)) report(node);
      },

      // window.setInterval(...), globalThis.setInterval(...), self.setInterval(...)
      'MemberExpression[computed=false] > Identifier.property'(node) {
        if (BANNED_CALLEES.has(node.name)) report(node);
      },

      // window['setInterval'](...)
      'MemberExpression[computed=true] > Literal.property'(node) {
        if (typeof node.value === 'string' && BANNED_CALLEES.has(node.value)) report(node);
      },
    };
  },
};
