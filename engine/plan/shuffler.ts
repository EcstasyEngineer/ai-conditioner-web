/**
 * Anti-repeat — DESIGN.md §4.8.
 *
 * Ported from hypnocli's `titration.py:63-83`, which is itself a port of
 * trance's `src/common/util.h`. That the same picker is in both reference
 * systems is the reason it is ported rather than redesigned:
 *
 *   n items at priority 0. Take the max priority; choose uniformly among all
 *   items at it; decrement the picked item and push it to `recent`; when
 *   `recent` exceeds `window`, pop the oldest and restore its priority.
 *
 * The effect is a sliding suppression window with random tie-breaking inside
 * it, which reads as variety rather than as a cycle — a plain shuffle-and-deal
 * produces audible periodicity at these block sizes, and a per-draw uniform
 * pick produces immediate repeats.
 *
 * WINDOW SIZING is the one deliberate departure. The source's literal 6 is
 * replaced with `clamp(floor(blockSize * windowFraction), windowMin, windowMax)`
 * because recon-hypnocli §4.1 warns that when `window >= n` the suppression
 * saturates: every item is recent, so priorities equalize and the picker
 * degrades to LRU-with-random-ties. At today's block sizes a fixed 6 would be
 * fine; the clamp costs one line and keeps the engine correct when a user's
 * filters cut a theme to eight survivors.
 */

import type { ShufflerOptions } from '../types/config.ts';
import { nextInt, type Rng } from '../rng/mulberry32.ts';

/**
 * The suppression window for a block of `blockSize` items.
 *
 * Exported because A6 asserts against this exact number rather than
 * re-deriving it — a test that recomputes the rule it is testing passes when
 * both copies are wrong together.
 */
export function windowFor(blockSize: number, options: ShufflerOptions): number {
  const scaled = Math.floor(blockSize * options.windowFraction);
  return Math.max(options.windowMin, Math.min(options.windowMax, scaled));
}

/**
 * A stateful picker over a fixed item list.
 *
 * Holds indices, not values, so the caller keeps ownership of its candidate
 * array and the shuffler stays independent of what is being shuffled.
 */
export class Shuffler {
  private readonly priority: number[];
  private readonly recent: number[] = [];
  private readonly rng: Rng;
  readonly size: number;
  readonly windowSize: number;

  // Fields are assigned explicitly rather than declared as constructor
  // parameter properties: that syntax needs a full TypeScript transform, and
  // this repo runs its tools under `node --experimental-strip-types`, which
  // erases types without rewriting code. A parameter property there is a
  // runtime SyntaxError rather than a type error, so it fails at the tool and
  // not at the type checker.
  constructor(size: number, options: ShufflerOptions, rng: Rng) {
    this.rng = rng;
    this.size = size;
    this.priority = new Array<number>(size).fill(0);
    this.windowSize = windowFor(size, options);
  }

  /**
   * True when the window saturates against the block — the documented
   * exception to A6, and the trigger for `Diagnostic{shuffler-degraded}`.
   *
   * Stated as a property of the shuffler rather than recomputed by the planner
   * so that the diagnostic and the behaviour can never disagree about whether
   * degradation happened.
   */
  get degraded(): boolean {
    return this.windowSize >= this.size;
  }

  /**
   * The next index, honouring suppression.
   *
   * `allow` is how the planner layers a per-step constraint (§4.7's "no two
   * lanes may show the same id at the same step", and `unison`'s refusal to
   * draw an invariant record) on top of anti-repeat WITHOUT reaching into the
   * priority table. When the filter admits nothing the shuffler yields
   * `undefined` and the caller decides whether that is a starve or a relax —
   * the shuffler never silently widens its own constraint, which is the
   * mistake that would let a consent filter leak.
   */
  next(allow?: (index: number) => boolean): number | undefined {
    let best = -Infinity;
    let candidates: number[] = [];

    for (let i = 0; i < this.size; i += 1) {
      if (allow !== undefined && !allow(i)) continue;
      const p = this.priority[i];
      if (p > best) {
        best = p;
        candidates = [i];
      } else if (p === best) {
        candidates.push(i);
      }
    }

    if (candidates.length === 0) return undefined;

    const chosen = candidates[nextInt(this.rng, candidates.length)];
    this.take(chosen);
    return chosen;
  }

  /**
   * Record a draw: demote it and slide the window.
   *
   * Separate from `next` because a caller that resolved a draw by another path
   * — a relaxed blocklist, a unison redraw — must still age the window, or the
   * suppression state silently diverges from what was actually shown.
   */
  take(index: number): void {
    this.priority[index] -= 1;
    this.recent.push(index);
    while (this.recent.length > this.windowSize) {
      const evicted = this.recent.shift() as number;
      this.priority[evicted] += 1;
    }
  }

  /** The indices currently suppressed, oldest first. For tests and diagnosis. */
  get suppressed(): readonly number[] {
    return this.recent;
  }
}
