/**
 * Pattern Compiler - Core Types
 *
 * Inspired by TidalCycles, patterns are functions from time to events.
 * Time is measured in cycles (0-1 = one full cycle), not milliseconds.
 */

// === Time Types ===

/**
 * A span of time measured in cycles.
 * Cycles are unit-less and relative - one cycle could be 10 seconds or 10 minutes.
 */
export type TimeSpan = {
  start: number
  end: number
}

/**
 * An event occurring within a pattern.
 *
 * @template T - The type of value this event carries
 *
 * `whole` is the "ideal" or "natural" extent of this event - where it would be
 * if not constrained by the query span.
 *
 * `part` is the portion of the event that falls within the queried span.
 * When whole === part, the event is fully contained in the query.
 */
export type Event<T> = {
  value: T
  whole: TimeSpan
  part: TimeSpan
}

/**
 * A Pattern is a function that queries a time span and returns events.
 *
 * This is the core abstraction. Patterns don't "contain" events - they
 * generate them on demand when queried. This allows infinite, cyclic patterns.
 *
 * @template T - The type of values in this pattern
 */
export type Pattern<T> = (span: TimeSpan) => Event<T>[]

// === Domain Types ===

export type Difficulty = 'BASIC' | 'LIGHT' | 'MEDIUM' | 'DEEP' | 'EXTREME'

export const DIFFICULTY_ORDER: Difficulty[] = [
  'BASIC',
  'LIGHT',
  'MEDIUM',
  'DEEP',
  'EXTREME',
]

export type Mantra = {
  line: string
  theme: string
  difficulty: Difficulty
  dominant?: string | null
  subject?: string | null
}

export type ScriptBlock = {
  type: 'block'
  name: string
  lines: string[]
}

// === Compilation Types ===

export type TimelineEventType = 'mantra' | 'block-line' | 'silence'

export type TimelineEvent = {
  type: TimelineEventType
  text: string
  startMs: number
  durationMs: number
  metadata?: {
    theme?: string
    difficulty?: Difficulty
    source?: string
  }
}

export type Timeline = {
  events: TimelineEvent[]
  totalDurationMs: number
  metadata: {
    themes: string[]
    cycleCount: number
    cycleDurationMs: number
  }
}

export type CompileOptions = {
  /** Number of cycles to render */
  cycles: number
  /** Duration of one cycle in milliseconds */
  cycleDurationMs: number
  /** Default duration for a single mantra in ms (within a cycle) */
  eventDurationMs?: number
  /** Filter mantras to this subject variant */
  subject?: string
  /** Filter mantras to this dominant variant */
  dominant?: string
  /** Random seed for deterministic output */
  seed?: number
}

// === Utility Types ===

/** A function that transforms a pattern */
export type PatternTransform<T> = (pat: Pattern<T>) => Pattern<T>

/** Options for mantra sources */
export type SourceOptions = {
  order?: 'shuffle' | 'sequential' | 'random'
}
