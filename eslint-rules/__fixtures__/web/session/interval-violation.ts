// DELIBERATE VIOLATION FIXTURE — every timer below is supposed to fail lint.
//
// This is the shape of the bug the rule exists to prevent: a player whose
// clock is a repeating timer. Backgrounded tabs throttle it, the callbacks
// queue up, and the user gets a burst of lines on return.
//
// Do not "fix" this file. Its errors are the assertion.

// @ts-nocheck

export function badClock(onStep: () => void): void {
  setInterval(onStep, 3400);
  window.setInterval(onStep, 3400);
  globalThis.setInterval(onStep, 3400);
  window['setInterval'](onStep, 3400);
  setImmediate(onStep);
}
