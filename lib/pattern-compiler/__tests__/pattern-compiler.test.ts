/**
 * Pattern Compiler Tests
 */

import { describe, expect, it } from 'vitest'
import {
  cat,
  compile,
  every,
  fast,
  filter,
  fmap,
  fromPool,
  pure,
  seq,
  slow,
  span,
  stack,
  weave,
  withFast,
} from '../index'
import type { Mantra, Pattern, TimeSpan } from '../types'

// === Test Helpers ===

/** Query a pattern and get just the values */
function queryValues<T>(pat: Pattern<T>, start: number, end: number): T[] {
  return pat({ start, end }).map((e) => e.value)
}

/** Query a pattern for one cycle (0-1) */
function queryCycle<T>(pat: Pattern<T>): T[] {
  return queryValues(pat, 0, 1)
}

// === Source Tests ===

describe('pure', () => {
  it('returns the value for each whole cycle', () => {
    const p = pure('hello')

    // Query one cycle
    const events = p({ start: 0, end: 1 })
    expect(events).toHaveLength(1)
    expect(events[0].value).toBe('hello')
    expect(events[0].whole).toEqual({ start: 0, end: 1 })

    // Query two cycles
    const events2 = p({ start: 0, end: 2 })
    expect(events2).toHaveLength(2)
    expect(events2[0].value).toBe('hello')
    expect(events2[1].value).toBe('hello')
  })

  it('handles partial cycle queries', () => {
    const p = pure('x')

    // Query middle of a cycle
    const events = p({ start: 0.25, end: 0.75 })
    expect(events).toHaveLength(1)
    expect(events[0].value).toBe('x')
    expect(events[0].whole).toEqual({ start: 0, end: 1 })
    expect(events[0].part).toEqual({ start: 0.25, end: 0.75 })
  })

  it('handles queries spanning cycle boundaries', () => {
    const p = pure('x')

    const events = p({ start: 0.5, end: 1.5 })
    expect(events).toHaveLength(2)
    expect(events[0].part).toEqual({ start: 0.5, end: 1 })
    expect(events[1].part).toEqual({ start: 1, end: 1.5 })
  })
})

describe('seq', () => {
  it('divides cycle equally among values', () => {
    const p = seq('a', 'b')

    const events = p({ start: 0, end: 1 })
    expect(events).toHaveLength(2)

    expect(events[0].value).toBe('a')
    expect(events[0].whole).toEqual({ start: 0, end: 0.5 })

    expect(events[1].value).toBe('b')
    expect(events[1].whole).toEqual({ start: 0.5, end: 1 })
  })

  it('handles three values', () => {
    const p = seq('a', 'b', 'c')
    const values = queryCycle(p)
    expect(values).toEqual(['a', 'b', 'c'])
  })

  it('repeats over multiple cycles', () => {
    const p = seq('a', 'b')
    const values = queryValues(p, 0, 2)
    expect(values).toEqual(['a', 'b', 'a', 'b'])
  })

  it('returns empty for empty sequence', () => {
    const p = seq()
    expect(queryCycle(p)).toEqual([])
  })
})

describe('fromPool', () => {
  it('cycles through pool sequentially', () => {
    const pool = ['x', 'y', 'z']
    const p = fromPool(pool, { order: 'sequential' })

    // Pool of 3 means each item takes 1/3 of a cycle
    const events = p({ start: 0, end: 1 })
    expect(events.map((e) => e.value)).toEqual(['x', 'y', 'z'])
  })

  it('shuffles deterministically with seed', () => {
    const pool = ['a', 'b', 'c', 'd', 'e']

    const p1 = fromPool(pool, { order: 'shuffle' }, 42)
    const p2 = fromPool(pool, { order: 'shuffle' }, 42)
    const p3 = fromPool(pool, { order: 'shuffle' }, 99)

    const v1 = queryValues(p1, 0, 1)
    const v2 = queryValues(p2, 0, 1)
    const v3 = queryValues(p3, 0, 1)

    // Same seed = same order
    expect(v1).toEqual(v2)

    // Different seed = different order (almost certainly)
    expect(v1).not.toEqual(v3)
  })
})

// === Time Combinator Tests ===

describe('fast', () => {
  it('doubles the speed with factor 2', () => {
    const p = fast(2, pure('x'))

    // Should get two events per cycle
    const events = p({ start: 0, end: 1 })
    expect(events).toHaveLength(2)
    expect(events[0].whole).toEqual({ start: 0, end: 0.5 })
    expect(events[1].whole).toEqual({ start: 0.5, end: 1 })
  })

  it('works with seq', () => {
    const p = fast(2, seq('a', 'b'))

    // a, b at double speed = a, b, a, b in one cycle
    const values = queryCycle(p)
    expect(values).toEqual(['a', 'b', 'a', 'b'])
  })

  it('returns empty for factor <= 0', () => {
    const p = fast(0, pure('x'))
    expect(queryCycle(p)).toEqual([])
  })
})

describe('slow', () => {
  it('halves the speed with factor 2', () => {
    const p = slow(2, seq('a', 'b'))

    // First cycle: just 'a' (which spans 0-1 in slowed time = 0-0.5 in fast time)
    const cycle1 = queryValues(p, 0, 1)
    expect(cycle1).toEqual(['a'])

    // Second cycle: just 'b'
    const cycle2 = queryValues(p, 1, 2)
    expect(cycle2).toEqual(['b'])
  })
})

// === Structural Combinator Tests ===

describe('stack', () => {
  it('layers patterns together', () => {
    const p = stack(pure('a'), pure('b'))

    const values = queryCycle(p)
    expect(values).toContain('a')
    expect(values).toContain('b')
    expect(values).toHaveLength(2)
  })

  it('preserves timing from both patterns', () => {
    const p = stack(seq('a', 'b'), pure('x'))

    const events = p({ start: 0, end: 1 })
    expect(events).toHaveLength(3)
    // a at 0-0.5, b at 0.5-1, x at 0-1
  })
})

describe('cat', () => {
  it('concatenates patterns across cycles', () => {
    const p = cat(pure('a'), pure('b'), pure('c'))

    expect(queryValues(p, 0, 1)).toEqual(['a'])
    expect(queryValues(p, 1, 2)).toEqual(['b'])
    expect(queryValues(p, 2, 3)).toEqual(['c'])
  })

  it('wraps around after all patterns', () => {
    const p = cat(pure('x'), pure('y'))

    expect(queryValues(p, 0, 1)).toEqual(['x'])
    expect(queryValues(p, 1, 2)).toEqual(['y'])
    expect(queryValues(p, 2, 3)).toEqual(['x']) // wraps
    expect(queryValues(p, 3, 4)).toEqual(['y'])
  })

  it('handles seq inside cat', () => {
    const p = cat(seq('a', 'b'), seq('x', 'y'))

    expect(queryValues(p, 0, 1)).toEqual(['a', 'b'])
    expect(queryValues(p, 1, 2)).toEqual(['x', 'y'])
  })
})

describe('weave', () => {
  it('interleaves values from multiple patterns', () => {
    const p = weave(1, seq('a', 'b'), seq('1', '2'))

    const values = queryCycle(p)
    // Should alternate: a, 1, b, 2
    expect(values).toHaveLength(4)
  })

  it('maintains deterministic order', () => {
    const p = weave(1, pure('x'), pure('y'))

    const v1 = queryCycle(p)
    const v2 = queryCycle(p)
    expect(v1).toEqual(v2)
  })
})

// === Modifier Tests ===

describe('fmap', () => {
  it('transforms event values', () => {
    const p = fmap((x: string) => x.toUpperCase(), seq('a', 'b'))

    const values = queryCycle(p)
    expect(values).toEqual(['A', 'B'])
  })
})

describe('filter', () => {
  it('removes events that fail predicate', () => {
    const p = filter((x: string) => x !== 'b', seq('a', 'b', 'c'))

    const values = queryCycle(p)
    expect(values).toEqual(['a', 'c'])
  })
})

describe('every', () => {
  it('applies transform every N cycles', () => {
    const p = every(2, withFast(2), pure('x'))

    // Cycle 0: transform applied (every 2, starting from 0)
    const cycle0 = queryValues(p, 0, 1)
    expect(cycle0).toHaveLength(2) // fast(2) doubles

    // Cycle 1: no transform
    const cycle1 = queryValues(p, 1, 2)
    expect(cycle1).toHaveLength(1)

    // Cycle 2: transform applied again
    const cycle2 = queryValues(p, 2, 3)
    expect(cycle2).toHaveLength(2)
  })
})

// === Compilation Tests ===

describe('compile', () => {
  it('produces timeline with correct timing', () => {
    const p = seq('a', 'b')

    const timeline = compile(p, {
      cycles: 1,
      cycleDurationMs: 1000,
    })

    expect(timeline.events).toHaveLength(2)
    expect(timeline.events[0].text).toBe('a')
    expect(timeline.events[0].startMs).toBe(0)
    expect(timeline.events[1].text).toBe('b')
    expect(timeline.events[1].startMs).toBe(500)
    expect(timeline.totalDurationMs).toBe(1000)
  })

  it('handles multiple cycles', () => {
    const p = pure('x')

    const timeline = compile(p, {
      cycles: 3,
      cycleDurationMs: 1000,
    })

    expect(timeline.events).toHaveLength(3)
    expect(timeline.events[0].startMs).toBe(0)
    expect(timeline.events[1].startMs).toBe(1000)
    expect(timeline.events[2].startMs).toBe(2000)
    expect(timeline.totalDurationMs).toBe(3000)
  })

  it('extracts theme from Mantra objects', () => {
    const mantra: Mantra = {
      line: 'Focus now',
      theme: 'Focus',
      difficulty: 'BASIC',
    }

    const p = pure(mantra)
    const timeline = compile(p, { cycles: 1, cycleDurationMs: 1000 })

    expect(timeline.events[0].text).toBe('Focus now')
    expect(timeline.events[0].metadata?.theme).toBe('Focus')
    expect(timeline.metadata.themes).toContain('Focus')
  })

  it('sorts events by start time', () => {
    // Stack creates events that aren't naturally ordered
    const p = stack(seq('a', 'b'), pure('x'))

    const timeline = compile(p, { cycles: 1, cycleDurationMs: 1000 })

    // Should be sorted
    for (let i = 1; i < timeline.events.length; i++) {
      expect(timeline.events[i].startMs).toBeGreaterThanOrEqual(
        timeline.events[i - 1].startMs
      )
    }
  })
})

// === Integration Tests ===

describe('complex patterns', () => {
  it('handles nested combinators', () => {
    // A realistic session pattern
    const p = cat(
      slow(2, pure('intro')),      // 2 cycles of intro
      fast(2, seq('a', 'b', 'c')), // rapid a,b,c sequence
      pure('outro')                 // 1 cycle outro
    )

    // This should work without errors
    const timeline = compile(p, {
      cycles: 4,
      cycleDurationMs: 1000,
    })

    expect(timeline.events.length).toBeGreaterThan(0)
    expect(timeline.totalDurationMs).toBe(4000)
  })

  it('handles cat with weave inside', () => {
    const p = cat(
      weave(1, seq('a', 'b'), seq('1', '2')),
      pure('end')
    )

    const cycle0 = queryValues(p, 0, 1)
    expect(cycle0.length).toBeGreaterThan(0)

    const cycle1 = queryValues(p, 1, 2)
    expect(cycle1).toEqual(['end'])
  })

  it('handles every with complex inner pattern', () => {
    const base = seq('a', 'b', 'c')
    const p = every(3, (pat) => fast(2, pat), base)

    // Cycles 0, 3, 6: doubled
    // Other cycles: normal
    const cycle0 = queryValues(p, 0, 1)
    const cycle1 = queryValues(p, 1, 2)

    expect(cycle0.length).toBe(6)  // a,b,c doubled
    expect(cycle1.length).toBe(3)  // normal a,b,c
  })
})
