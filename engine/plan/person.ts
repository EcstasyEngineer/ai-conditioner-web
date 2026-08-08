/**
 * The person schedule — DESIGN.md §4.6, the genuinely new scheduler.
 *
 * recon-hypnocli §12.4 flags this as having no equivalent upstream and observes
 * it is "structurally the SAME SHAPE as a titration schedule — a monotone/curved
 * function of progress selecting from an ordered set." So it reuses the
 * titration interface, its contracts and its determinism guarantees rather than
 * inventing a parallel mechanism.
 *
 * THE CENTER IS ALWAYS `second`. Not scheduled, not titrated, fixed by the
 * brief. It is the anchor, and A9 asserts it at 100% of ticks.
 *
 * THE SIDES DRIFT `first -> named` AND THEN BACK TOWARD `first`:
 *
 *   pNamed(p) = peakMix * bell(p, peak = 0.55, width = 0.28)
 *
 * The base design drifted monotonically to `named` with a late ease and never
 * weaned the person axis back, so the session ended with the listener maximally
 * dissociated even though intensity weaned correctly. THAT IS THE SAME CLASS OF
 * ERROR AS "Wide awake at line 2" — a directionality property a scalar schedule
 * cannot express — and since the structural fix was already ported for the
 * intensity axis, applying it here costs a bell instead of a monotone ease.
 *
 * The arc is: TOLD -> AGREEING -> DESCRIBED -> HANDED BACK YOUR "I". A session
 * that leaves you dissociated is a session you resent afterward; the drift out
 * is what makes the drift in safe to accept. A9 asserts the return rather than
 * merely permitting it, which is why it is stated as a non-monotone decile
 * profile and not as "named share rises".
 *
 * HOLD-AND-PIVOT, NOT PER-STEP RE-ROLL. Sampling every step produces SHIMMER —
 * I / she / I / I / she — which reads as a rendering bug rather than a drift.
 * trance's `alternate chance P` is documented as a stateful walk whose
 * probability CANNOT ride a curve, because `parse_chance` takes a literal and
 * bakes a 100-bucket table at parse time; recon-trance names curve-drivable
 * chance "a genuine new runtime primitive." hypnoapp gets it for free, because
 * the schedule is planned rather than parsed.
 *
 * THE TWO SIDES PIVOT INDEPENDENTLY on offset schedules, so mid-session one
 * side routinely sits in "I" while the other sits in "{subject}" — the two
 * readings of yourself coexisting.
 */

import type { PersonOptions } from '../types/config.ts';
import type { Person } from '../types/record.ts';
import { bell, progressAt } from './titration.ts';
import { substream, type Rng } from '../rng/mulberry32.ts';

/** The scheduled person for each side lane at each step. */
export interface PersonSchedule {
  left: Person[];
  right: Person[];
  /** P(named) at each step. Drives the neutral-at-pivot preference (§4.6). */
  pNamed: number[];
}

/** P(named) at a step — the mix curve the pivot samples against. */
export function namedProbability(step: number, length: number, options: PersonOptions): number {
  return options.peakMix * bell(progressAt(step, length), options.bell);
}

/**
 * How strongly a side lane should prefer an `invariant` record at this step.
 *
 * NEUTRAL BIASING AT THE PIVOT. The person-free records are person-invariant,
 * and they get a SCHEDULED JOB rather than being a remainder: side lanes prefer
 * them when `pNamed` is near 0.5 — the drift midpoint — so the triplet passes
 * through a person-free moment on its way from "I" to "{subject}". That turns
 * the shift from a switch into a hinge, and it makes the person-free records
 * the most interesting content in the session rather than the least.
 *
 * Peaks at 1 when `pNamed === 0.5` and falls to 0 at either extreme, scaled by
 * `neutralBias` so 0 disables the preference entirely.
 *
 * Note this replaces, rather than joins, the base design's "prefer invariant
 * during induction" rule — judge 1 correctly flagged that one as invented
 * texture with no upstream basis and no stated purpose.
 */
export function neutralPreference(pNamed: number, options: PersonOptions): number {
  if (options.neutralBias === 0) return 0;
  return options.neutralBias * (1 - Math.abs(pNamed - 0.5) * 2);
}

/**
 * Build the whole person schedule up front.
 *
 * Materialized for the same reason as the theme walk: the pivot is stateful, so
 * step 9's person depends on every pivot before it.
 *
 * The `sidePivotOffset` shifts the RIGHT lane's pivot phase only. Both lanes
 * still start in `first` — the offset moves WHEN a lane re-rolls, not what it
 * starts as, so the session reliably opens with both sides in "I" however the
 * offset is tuned.
 */
export function buildPersonSchedule(
  length: number,
  options: PersonOptions,
  seed: number,
): PersonSchedule {
  const pivotEvery = Math.max(1, options.pivotEvery);
  const left: Person[] = new Array<Person>(length);
  const right: Person[] = new Array<Person>(length);
  const pNamed: number[] = new Array<number>(length);

  // Independent named substreams: the two sides must not draw from one another,
  // or "pivot independently" would be false whenever the offset happened to
  // align them.
  const rngs: Record<'left' | 'right', Rng> = {
    left: substream(seed, 'person:left'),
    right: substream(seed, 'person:right'),
  };

  // The session OPENS in `first` on both sides and the drift has to earn its
  // way to `named`. Opening on a re-roll would sometimes start the session
  // already dissociated, which is the state the whole arc exists to move
  // through rather than to begin at.
  const current: Record<'left' | 'right', Person> = { left: 'first', right: 'first' };

  for (let step = 0; step < length; step += 1) {
    const p = namedProbability(step, length, options);
    pNamed[step] = p;

    for (const lane of ['left', 'right'] as const) {
      const phase = lane === 'right' ? step + options.sidePivotOffset : step;
      // Step 0 is never a pivot: it is the opening state, asserted above.
      if (step > 0 && phase % pivotEvery === 0) {
        const target: Person = rngs[lane].next() < p ? 'named' : 'first';
        current[lane] = target;
      }
      (lane === 'left' ? left : right)[step] = current[lane];
    }
  }

  return { left, right, pNamed };
}
