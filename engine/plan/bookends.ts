/**
 * Phase bookends — DESIGN.md §4.2.
 *
 * recon-hypnocli calls this "the single most important design lesson in this
 * codebase," documented in the source three separate times:
 *
 *   Intensity is a SCALAR; session position is a DIRECTION. A one-dimensional
 *   intensity model cannot distinguish "low because we are inducting" from
 *   "low because we are emerging" — so a symmetric bell makes the EMERGENCE
 *   block eligible at the START. The concrete artifact: "Wide awake, rested and
 *   present" firing at line 2. Every rater caught it.
 *
 * The fix is structural and sits ABOVE the schedule: designated induction and
 * emergence themes are removed from the titration pool ENTIRELY, so no curve,
 * however shaped, can reach them mid-session. A scheduler that merely weights
 * them low reproduces the bug on an unlucky seed.
 *
 * That deletion is also why the axis removal did not reopen this: the bookend
 * mechanism never depended on the intensity ladder. It is a partition of the
 * theme space by session position, and it is untouched by the fact that
 * nothing rounds the curve onto a tier any more.
 */

import type { BookendOptions } from '../types/config.ts';

/** How a session's steps divide into head, middle and tail. */
export interface Bookends {
  head: number;
  middle: number;
  tail: number;
}

/**
 * Split `length` into the three phases.
 *
 * `head = tail = max(1, round(length * fraction))`, the PAIR then capped so the
 * middle always survives. MEASURED against `render_session.py:395-411`:
 * `length 346 -> 35/276/35` and `length 30 -> 3/24/3`.
 *
 * THE BUG THAT IS NOT PORTED. recon-hypnocli §5.2 records that at `length <= 2`
 * the two minimums overrun and the source emits 3 steps for a 1-step session.
 * hypnoapp clamps instead, and A2 asserts `head + middle + tail === length` for
 * every length in 1..500 — an identity, so it cannot pass by accident on the
 * lengths someone happened to try.
 *
 * The clamp is expressed as "spend at most half the session on bookends, then
 * give the head the odd step" rather than as a special case at 1 and 2. A
 * special case is a branch nobody exercises; an arithmetic bound holds at every
 * length by construction.
 */
export function computeBookends(length: number, options: BookendOptions): Bookends {
  if (length <= 0) return { head: 0, middle: 0, tail: 0 };
  if (length === 1) return { head: 1, middle: 0, tail: 0 };

  const nominal = Math.max(1, Math.round(length * options.fraction));

  // The pair may not exceed half the session, so the middle is never negative
  // and a short session still titrates. `floor` because the middle keeps the
  // odd step at odd lengths.
  const budget = Math.floor(length / 2);
  const head = Math.min(nominal, Math.ceil(budget / 2) || 1);
  const tail = Math.min(nominal, budget - head);

  return { head, middle: length - head - tail, tail };
}

/** Which phase a step falls in. */
export function phaseOf(step: number, bookends: Bookends, length: number): 'head' | 'middle' | 'tail' {
  if (step < bookends.head) return 'head';
  if (step >= length - bookends.tail) return 'tail';
  return 'middle';
}
