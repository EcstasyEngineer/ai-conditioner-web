/**
 * Pattern Compiler - Source Patterns
 *
 * These functions create patterns from data. They're the "leaves" of the
 * pattern tree - everything else is combinators that transform patterns.
 */

import type { Event, Mantra, Pattern, SourceOptions, TimeSpan } from './types'

// === Utility Functions ===

/**
 * Create a TimeSpan
 */
export function span(start: number, end: number): TimeSpan {
  return { start, end }
}

/**
 * Check if two time spans overlap
 */
export function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Get the intersection of two time spans, or null if they don't overlap
 */
export function spanIntersection(a: TimeSpan, b: TimeSpan): TimeSpan | null {
  if (!spansOverlap(a, b)) return null
  return {
    start: Math.max(a.start, b.start),
    end: Math.min(a.end, b.end),
  }
}

/**
 * Get the duration of a span
 */
export function spanDuration(s: TimeSpan): number {
  return s.end - s.start
}

/**
 * Seeded random number generator (mulberry32)
 * Returns a function that generates numbers 0-1
 */
export function seededRandom(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Shuffle array using Fisher-Yates with seeded random
 */
export function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr]
  const rand = seededRandom(seed)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// === Source Patterns ===

/**
 * Create a pattern that always returns the same value.
 * The value fills each whole cycle (0-1, 1-2, etc.)
 *
 * @example
 * const p = pure("hello")
 * p({ start: 0, end: 2 }) // Returns events at [0-1] and [1-2]
 */
export function pure<T>(value: T): Pattern<T> {
  return (querySpan: TimeSpan): Event<T>[] => {
    const events: Event<T>[] = []

    // Find which whole cycles this span covers
    const startCycle = Math.floor(querySpan.start)
    const endCycle = Math.ceil(querySpan.end)

    for (let cycle = startCycle; cycle < endCycle; cycle++) {
      const whole: TimeSpan = { start: cycle, end: cycle + 1 }
      const part = spanIntersection(whole, querySpan)

      if (part) {
        events.push({ value, whole, part })
      }
    }

    return events
  }
}

/**
 * Create a pattern that cycles through a sequence of values.
 * Each value gets an equal subdivision of the cycle.
 *
 * @example
 * const p = seq("a", "b", "c")
 * // In cycle 0: "a" at 0-0.333, "b" at 0.333-0.666, "c" at 0.666-1
 */
export function seq<T>(...values: T[]): Pattern<T> {
  if (values.length === 0) {
    return () => []
  }

  const n = values.length
  const duration = 1 / n

  return (querySpan: TimeSpan): Event<T>[] => {
    const events: Event<T>[] = []

    // Find the cycle range
    const startCycle = Math.floor(querySpan.start)
    const endCycle = Math.ceil(querySpan.end)

    for (let cycle = startCycle; cycle < endCycle; cycle++) {
      for (let i = 0; i < n; i++) {
        const whole: TimeSpan = {
          start: cycle + i * duration,
          end: cycle + (i + 1) * duration,
        }
        const part = spanIntersection(whole, querySpan)

        if (part) {
          events.push({
            value: values[i],
            whole,
            part,
          })
        }
      }
    }

    return events
  }
}

/**
 * Create a pattern from a pool of values that cycles through them.
 * Unlike seq(), this handles larger pools and supports different orderings.
 *
 * @param pool - Array of values to draw from
 * @param opts - Options for ordering (shuffle, sequential, random)
 * @param seed - Random seed for deterministic shuffle/random
 */
export function fromPool<T>(
  pool: T[],
  opts: SourceOptions = {},
  seed: number = Date.now()
): Pattern<T> {
  if (pool.length === 0) {
    return () => []
  }

  const order = opts.order ?? 'shuffle'
  const rand = seededRandom(seed)

  // For shuffle, we pre-compute a shuffled order
  // For sequential, we use the original order
  // For random, we pick per-query (but deterministically based on position)
  const orderedPool = order === 'shuffle' ? shuffleWithSeed(pool, seed) : pool

  return (querySpan: TimeSpan): Event<T>[] => {
    const events: Event<T>[] = []

    // Each item in the pool gets one sub-cycle
    // After pool.length items, we start over (next "meta-cycle")
    const itemDuration = 1 / pool.length

    // Find which global items (across all time) we need
    const startItem = Math.floor(querySpan.start / itemDuration)
    const endItem = Math.ceil(querySpan.end / itemDuration)

    for (let globalIndex = startItem; globalIndex < endItem; globalIndex++) {
      const whole: TimeSpan = {
        start: globalIndex * itemDuration,
        end: (globalIndex + 1) * itemDuration,
      }
      const part = spanIntersection(whole, querySpan)

      if (part) {
        let value: T
        if (order === 'random') {
          // For random, use the global index as a seed modifier
          const itemRand = seededRandom(seed + globalIndex)
          value = pool[Math.floor(itemRand() * pool.length)]
        } else {
          // For shuffle and sequential, cycle through the ordered pool
          value = orderedPool[globalIndex % orderedPool.length]
        }

        events.push({ value, whole, part })
      }
    }

    return events
  }
}

/**
 * Create a silence/rest pattern - produces no events
 */
export function silence<T>(): Pattern<T> {
  return () => []
}

/**
 * Create a pattern from mantras, filtering by theme
 * This is a convenience wrapper around fromPool
 */
export function fromMantras(
  mantras: Mantra[],
  theme: string,
  opts: SourceOptions = {},
  seed?: number
): Pattern<Mantra> {
  const filtered = mantras.filter((m) => m.theme === theme)
  return fromPool(filtered, opts, seed)
}
