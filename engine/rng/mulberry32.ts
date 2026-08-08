/**
 * The engine's only source of randomness — DESIGN.md §3, §4.
 *
 * `Math.random` is banned in `engine/` and the ban is enforced twice, by an
 * ESLint rule and by a grep in `tests/shared-contract.test.ts`. The reason is
 * not purity for its own sake: a session must be reproducible from
 * `(corpus, config, options, seed)` alone, because a user report is otherwise
 * unactionable and every scheduling test becomes flaky rather than false.
 *
 * mulberry32 is chosen for three properties, in this order:
 *
 *   1. It is a PURE FUNCTION OF ITS STATE, and the state is one uint32. So a
 *      substream is derived by hashing rather than by consuming, and two
 *      substreams cannot interfere no matter what order their callers run in.
 *   2. It is specified in integer arithmetic that JavaScript reproduces
 *      exactly. `Math.imul` and `>>>` are exact on uint32, so the sequence is
 *      byte-identical across engines, platforms and Node versions. A generator
 *      built on floating-point accumulation is not.
 *   3. It is ~6 lines, so it is auditable and carries no dependency. The engine
 *      may not import a third party at all.
 *
 * It is deliberately NOT cryptographic. Nothing here defends a secret; the
 * requirement is reproducibility, and a CSPRNG would be both slower and, being
 * seeded from entropy, exactly wrong.
 */

/**
 * A seeded uniform source.
 *
 * Deliberately an object with a method rather than a bare closure: the planner
 * threads named substreams through a dozen call sites, and a value that prints
 * as `[Function]` in a failing test is far harder to attribute than one that
 * carries its label.
 */
export interface Rng {
  /** The next uniform in [0,1). */
  next(): number;
  /** Where this stream came from, for diagnosis. Never read by the algorithm. */
  readonly label: string;
}

/**
 * Mix a uint32 so that adjacent seeds produce unrelated streams.
 *
 * This is the load-bearing half of substreaming. Seeds arrive adjacent in
 * practice — a test sweeps `seed = 0..199`, and substreams are derived from a
 * label — and a raw mulberry32 started at `n` and at `n+1` produces first
 * outputs that are visibly close. Without this mix, "200 seeds" would be one
 * seed sampled 200 times in a trench coat, and A3/A4/A9's statistical
 * assertions would be testing far less than their sample size claims.
 */
function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

/**
 * Hash a label to a uint32, so a substream is named rather than positional.
 *
 * FNV-1a. The alternative — deriving substreams by consuming from a parent —
 * makes every stream's output depend on how many values every earlier stream
 * happened to draw, so adding one diagnostic-only draw in the person scheduler
 * would silently repaint every mantra in the session. Naming them makes the
 * streams independent by construction, which is what lets the head and tail
 * bookends run from distinct substreams per channel (§4.2) without any
 * ordering discipline between them.
 */
function hashLabel(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A seeded generator.
 *
 * The classic mulberry32 body, unchanged: state advances by a fixed odd
 * increment, then three mixing steps produce the output. `>>> 0` after every
 * arithmetic step keeps the state a true uint32 rather than a float that
 * happens to hold an integer, which is what makes the sequence portable.
 */
export function mulberry32(seed: number, label = 'root'): Rng {
  let state = mix32(seed) >>> 0;
  return {
    label,
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * A named, independent substream of `seed`.
 *
 * `substream(47, 'person:left')` and `substream(47, 'person:right')` are
 * unrelated streams, and neither moves when the other is drawn from. This is
 * what §4.6's "the two sides pivot independently on offset schedules" means
 * mechanically, and it is why adding a draw anywhere in the planner cannot
 * repaint content elsewhere in the plan.
 */
export function substream(seed: number, label: string): Rng {
  return mulberry32(mix32(seed ^ hashLabel(label)), label);
}

/**
 * A uniform integer in `[0, bound)`.
 *
 * Multiply-and-floor rather than modulo. Modulo on a float in [0,1) is not the
 * classic modulo-bias bug but it is still wrong-looking arithmetic, and the
 * `bound <= 0` guard is here because a caller that reaches this with an empty
 * candidate list has a starvation bug the planner must report as a
 * `PlanError`, not paper over with index -1.
 */
export function nextInt(rng: Rng, bound: number): number {
  if (bound <= 0) throw new RangeError(`nextInt bound must be positive, got ${bound}`);
  const value = Math.floor(rng.next() * bound);
  // `rng.next()` is < 1 so this cannot exceed `bound - 1`, but floating point
  // deserves a belt when the alternative is an out-of-range index.
  return value >= bound ? bound - 1 : value;
}

/**
 * Pick one element uniformly. Returns `undefined` for an empty list.
 *
 * `undefined` rather than a throw because the planner's callers already have a
 * starvation path that turns an unservable draw into a typed `PlanError` or a
 * `lane-starved` diagnostic, and that path carries the step and lane a throw
 * would lose.
 */
export function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[nextInt(rng, items.length)];
}
