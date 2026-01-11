/**
 * Pattern Compiler - Combinators
 *
 * Combinators transform and combine patterns. They're the "branches" of the
 * pattern tree - they take patterns as input and return new patterns.
 */

import type { Event, Pattern, PatternTransform, TimeSpan } from './types'
import { spanDuration, spanIntersection, spansOverlap } from './sources'

// === Time Transformation ===

/**
 * Speed up a pattern by a factor.
 * fast(2, p) makes the pattern play twice as fast (twice per cycle)
 *
 * @example
 * const p = seq("a", "b")
 * const faster = fast(2, p)
 * // Original: "a" at 0-0.5, "b" at 0.5-1
 * // Faster: "a" at 0-0.25, "b" at 0.25-0.5, "a" at 0.5-0.75, "b" at 0.75-1
 */
export function fast<T>(factor: number, pat: Pattern<T>): Pattern<T> {
  if (factor <= 0) return () => []
  if (factor === 1) return pat

  return (querySpan: TimeSpan): Event<T>[] => {
    // Query a larger span in pattern-time, then scale results back
    const scaledQuery: TimeSpan = {
      start: querySpan.start * factor,
      end: querySpan.end * factor,
    }

    return pat(scaledQuery).map((event) => ({
      value: event.value,
      whole: {
        start: event.whole.start / factor,
        end: event.whole.end / factor,
      },
      part: {
        start: event.part.start / factor,
        end: event.part.end / factor,
      },
    }))
  }
}

/**
 * Slow down a pattern by a factor.
 * slow(2, p) makes the pattern play half as fast (takes two cycles)
 */
export function slow<T>(factor: number, pat: Pattern<T>): Pattern<T> {
  return fast(1 / factor, pat)
}

/**
 * Shift a pattern earlier in time
 */
export function early<T>(amount: number, pat: Pattern<T>): Pattern<T> {
  return (querySpan: TimeSpan): Event<T>[] => {
    const shiftedQuery: TimeSpan = {
      start: querySpan.start + amount,
      end: querySpan.end + amount,
    }

    return pat(shiftedQuery).map((event) => ({
      value: event.value,
      whole: {
        start: event.whole.start - amount,
        end: event.whole.end - amount,
      },
      part: {
        start: event.part.start - amount,
        end: event.part.end - amount,
      },
    }))
  }
}

/**
 * Shift a pattern later in time
 */
export function late<T>(amount: number, pat: Pattern<T>): Pattern<T> {
  return early(-amount, pat)
}

// === Structural Combinators ===

/**
 * Layer multiple patterns on top of each other.
 * Events from all patterns play simultaneously.
 *
 * @example
 * const p = stack(pure("a"), pure("b"))
 * // Both "a" and "b" events occur in every cycle
 */
export function stack<T>(...patterns: Pattern<T>[]): Pattern<T> {
  if (patterns.length === 0) return () => []
  if (patterns.length === 1) return patterns[0]

  return (querySpan: TimeSpan): Event<T>[] => {
    return patterns.flatMap((pat) => pat(querySpan))
  }
}

/**
 * Concatenate patterns in sequence.
 * Each pattern plays for one cycle, then the next pattern starts.
 *
 * @example
 * const p = cat(pure("a"), pure("b"), pure("c"))
 * // Cycle 0: "a", Cycle 1: "b", Cycle 2: "c", Cycle 3: "a" (wraps)
 */
export function cat<T>(...patterns: Pattern<T>[]): Pattern<T> {
  if (patterns.length === 0) return () => []
  if (patterns.length === 1) return patterns[0]

  const n = patterns.length

  return (querySpan: TimeSpan): Event<T>[] => {
    const events: Event<T>[] = []

    // Find which whole "meta-cycles" (of n patterns) we span
    const startMeta = Math.floor(querySpan.start / n)
    const endMeta = Math.ceil(querySpan.end / n)

    for (let meta = startMeta; meta < endMeta; meta++) {
      for (let i = 0; i < n; i++) {
        const patternCycleStart = meta * n + i
        const patternCycleEnd = patternCycleStart + 1

        // Check if this pattern's cycle overlaps with our query
        const cycleSpan: TimeSpan = {
          start: patternCycleStart,
          end: patternCycleEnd,
        }

        if (!spansOverlap(cycleSpan, querySpan)) continue

        // Query the pattern in its local time (0-1)
        const localQueryStart = Math.max(0, querySpan.start - patternCycleStart)
        const localQueryEnd = Math.min(1, querySpan.end - patternCycleStart)

        const localEvents = patterns[i]({ start: localQueryStart, end: localQueryEnd })

        // Shift events back to global time
        for (const event of localEvents) {
          events.push({
            value: event.value,
            whole: {
              start: event.whole.start + patternCycleStart,
              end: event.whole.end + patternCycleStart,
            },
            part: {
              start: event.part.start + patternCycleStart,
              end: event.part.end + patternCycleStart,
            },
          })
        }
      }
    }

    return events
  }
}

/**
 * Interleave events from multiple patterns.
 * Takes one event from each pattern in alternating slots.
 *
 * @example
 * const p = weave(1, seq("a", "b"), seq("1", "2"))
 * // "a", "1", "b", "2" in each cycle (4 events total)
 *
 * weave works by:
 * 1. Querying each pattern to get its events
 * 2. Taking events from each pattern in round-robin order
 * 3. Redistributing them evenly across the cycle
 */
export function weave<T>(count: number, ...patterns: Pattern<T>[]): Pattern<T> {
  if (patterns.length === 0) return () => []
  if (patterns.length === 1) return patterns[0]
  if (count <= 0) return () => []

  const n = patterns.length

  return (querySpan: TimeSpan): Event<T>[] => {
    // Get events from each pattern
    const patternEvents: Event<T>[][] = patterns.map((pat) => pat(querySpan))

    // Find the max number of events any pattern has
    const maxEvents = Math.max(...patternEvents.map((e) => e.length))
    if (maxEvents === 0) return []

    // Interleave: take `count` from pattern 0, then `count` from pattern 1, etc.
    const result: Event<T>[] = []
    let eventIndex = 0

    // Iterate through rounds of taking `count` from each pattern
    for (let round = 0; round < maxEvents; round++) {
      for (let patIndex = 0; patIndex < n; patIndex++) {
        const events = patternEvents[patIndex]
        if (round < events.length) {
          // Take this event and retime it to its interleaved position
          const originalEvent = events[round]
          const totalSlots = maxEvents * n
          const slot = round * n + patIndex

          // Calculate new timing: each slot gets 1/totalSlots of the cycle
          const cycleStart = Math.floor(querySpan.start)
          const slotDuration = 1 / totalSlots
          const newStart = cycleStart + slot * slotDuration
          const newEnd = cycleStart + (slot + 1) * slotDuration

          result.push({
            value: originalEvent.value,
            whole: { start: newStart, end: newEnd },
            part: { start: newStart, end: newEnd },
          })
          eventIndex++
        }
      }
    }

    return result
  }
}

/**
 * Alternate between patterns every N cycles
 *
 * @example
 * const p = alternate(2, pure("a"), pure("b"))
 * // Cycles 0-1: "a", Cycles 2-3: "b", Cycles 4-5: "a", ...
 */
export function alternate<T>(
  cyclesEach: number,
  ...patterns: Pattern<T>[]
): Pattern<T> {
  if (patterns.length === 0) return () => []
  if (patterns.length === 1) return patterns[0]

  const n = patterns.length
  const totalCycles = n * cyclesEach

  return (querySpan: TimeSpan): Event<T>[] => {
    const events: Event<T>[] = []

    // Find which "super-cycle" positions we need
    const startPos = Math.floor(querySpan.start / cyclesEach)
    const endPos = Math.ceil(querySpan.end / cyclesEach)

    for (let pos = startPos; pos < endPos; pos++) {
      const patIndex = pos % n
      const cycleStart = pos * cyclesEach
      const cycleEnd = cycleStart + cyclesEach

      const overlapStart = Math.max(querySpan.start, cycleStart)
      const overlapEnd = Math.min(querySpan.end, cycleEnd)

      if (overlapStart >= overlapEnd) continue

      // Query in local time for this pattern segment
      const localStart = overlapStart - cycleStart
      const localEnd = overlapEnd - cycleStart

      const localEvents = slow(cyclesEach, patterns[patIndex])({
        start: localStart,
        end: localEnd,
      })

      // Shift back to global time
      for (const event of localEvents) {
        events.push({
          value: event.value,
          whole: {
            start: event.whole.start + cycleStart,
            end: event.whole.end + cycleStart,
          },
          part: {
            start: event.part.start + cycleStart,
            end: event.part.end + cycleStart,
          },
        })
      }
    }

    return events
  }
}

// === Modifiers ===

/**
 * Apply a function to every event's value
 */
export function fmap<T, U>(fn: (v: T) => U, pat: Pattern<T>): Pattern<U> {
  return (querySpan: TimeSpan): Event<U>[] => {
    return pat(querySpan).map((event) => ({
      ...event,
      value: fn(event.value),
    }))
  }
}

/**
 * Filter events based on a predicate
 */
export function filter<T>(
  pred: (v: T) => boolean,
  pat: Pattern<T>
): Pattern<T> {
  return (querySpan: TimeSpan): Event<T>[] => {
    return pat(querySpan).filter((event) => pred(event.value))
  }
}

/**
 * Randomly drop events with a given probability.
 * Uses the event's start time as a seed for determinism.
 *
 * @param prob - Probability of dropping (0-1)
 */
export function degradeBy<T>(
  prob: number,
  pat: Pattern<T>,
  seed: number = 0
): Pattern<T> {
  if (prob <= 0) return pat
  if (prob >= 1) return () => []

  return (querySpan: TimeSpan): Event<T>[] => {
    return pat(querySpan).filter((event) => {
      // Use event position as seed for deterministic randomness
      const eventSeed = Math.floor(event.whole.start * 1000000) + seed
      const rand =
        (Math.sin(eventSeed) * 10000) - Math.floor(Math.sin(eventSeed) * 10000)
      return rand >= prob
    })
  }
}

/**
 * Apply a transformation every N cycles
 *
 * @example
 * const p = every(4, fast(2), pure("a"))
 * // Every 4th cycle, "a" plays twice as fast
 */
export function every<T>(
  n: number,
  transform: PatternTransform<T>,
  pat: Pattern<T>
): Pattern<T> {
  if (n <= 0) return pat

  return (querySpan: TimeSpan): Event<T>[] => {
    const events: Event<T>[] = []

    const startCycle = Math.floor(querySpan.start)
    const endCycle = Math.ceil(querySpan.end)

    for (let cycle = startCycle; cycle < endCycle; cycle++) {
      const cycleSpan: TimeSpan = { start: cycle, end: cycle + 1 }
      const queryPart = spanIntersection(cycleSpan, querySpan)
      if (!queryPart) continue

      // Decide which pattern to use for this cycle
      const useTransform = cycle % n === 0
      const patternToUse = useTransform ? transform(pat) : pat

      // Query in local cycle time
      const localQuery: TimeSpan = {
        start: queryPart.start - cycle,
        end: queryPart.end - cycle,
      }

      const localEvents = patternToUse(localQuery)

      // Shift back to global time
      for (const event of localEvents) {
        events.push({
          value: event.value,
          whole: {
            start: event.whole.start + cycle,
            end: event.whole.end + cycle,
          },
          part: {
            start: event.part.start + cycle,
            end: event.part.end + cycle,
          },
        })
      }
    }

    return events
  }
}

// === Convenience ===

/**
 * Curried version of common combinators for easier composition
 */
export const withFast =
  <T>(factor: number): PatternTransform<T> =>
  (pat) =>
    fast(factor, pat)

export const withSlow =
  <T>(factor: number): PatternTransform<T> =>
  (pat) =>
    slow(factor, pat)

export const withFilter =
  <T>(pred: (v: T) => boolean): PatternTransform<T> =>
  (pat) =>
    filter(pred, pat)
