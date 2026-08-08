// DELIBERATE VIOLATION FIXTURE — every line below is supposed to fail lint.
//
// This file exists so `no-platform-imports-in-engine` is proven to FIRE, not
// merely proven to be installed. A rule that has never rejected anything is
// indistinguishable from a rule with a typo in its selector.
//
// It is excluded from the project lint run (see eslint.config.js `ignores`)
// and from both tsconfigs. The rule test lints it directly and asserts the
// exact set of messageIds produced.
//
// Do not "fix" this file. Its errors are the assertion.

// @ts-nocheck

import { readFileSync } from 'fs';
import { join } from 'node:path';
import React from 'react';
import { mountSession } from '../../web/session/mountSession';

export function impure(root: HTMLElement): number {
  const started = Date.now();
  const jitter = Math.random();
  const now = performance.now();
  const stamp = new Date();

  window.addEventListener('resize', () => {});
  void fetch('/corpus/pool.json');
  void localStorage.getItem('config');
  void document.title;

  const bytes = readFileSync(join('a', 'b'));

  return started + jitter + now + stamp.getTime() + bytes.length + Number(root) + Number(React) + Number(mountSession);
}
