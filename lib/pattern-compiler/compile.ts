/**
 * Pattern Compiler - Compilation
 *
 * Compiles a Pattern into a concrete Timeline for playback.
 * This is where cyclical pattern-time becomes absolute milliseconds.
 */

import type {
  CompileOptions,
  Mantra,
  Pattern,
  Timeline,
  TimelineEvent,
  TimeSpan,
} from './types'

/**
 * Default compilation options
 */
const DEFAULT_OPTIONS: Required<CompileOptions> = {
  cycles: 4,
  cycleDurationMs: 60000, // 1 minute per cycle
  eventDurationMs: 3000, // 3 seconds per event
  subject: undefined as unknown as string,
  dominant: undefined as unknown as string,
  seed: Date.now(),
}

/**
 * Compile a pattern into a timeline.
 *
 * Queries the pattern for the specified number of cycles and converts
 * the events into absolute-time timeline events.
 *
 * @param pattern - The pattern to compile
 * @param options - Compilation options
 * @returns A Timeline ready for playback
 */
export function compile<T>(
  pattern: Pattern<T>,
  options: CompileOptions
): Timeline {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const { cycles, cycleDurationMs, eventDurationMs } = opts

  // Query the pattern for all cycles
  const querySpan: TimeSpan = { start: 0, end: cycles }
  const events = pattern(querySpan)

  // Convert pattern events to timeline events
  const timelineEvents: TimelineEvent[] = []
  const themes = new Set<string>()

  for (const event of events) {
    // Convert cycle-time to milliseconds
    const startMs = event.whole.start * cycleDurationMs
    const endMs = event.whole.end * cycleDurationMs

    // Calculate duration - either from event span or default
    const spanDurationMs = endMs - startMs
    const durationMs = Math.min(spanDurationMs, eventDurationMs)

    // Extract text and metadata from the value
    const { text, metadata } = extractEventData(event.value)

    if (metadata?.theme) {
      themes.add(metadata.theme)
    }

    timelineEvents.push({
      type: metadata?.type ?? 'mantra',
      text,
      startMs,
      durationMs,
      metadata,
    })
  }

  // Sort by start time
  timelineEvents.sort((a, b) => a.startMs - b.startMs)

  return {
    events: timelineEvents,
    totalDurationMs: cycles * cycleDurationMs,
    metadata: {
      themes: Array.from(themes),
      cycleCount: cycles,
      cycleDurationMs,
    },
  }
}

/**
 * Extract displayable text and metadata from a pattern event value.
 * Handles strings, Mantra objects, and other types.
 */
function extractEventData<T>(value: T): {
  text: string
  metadata?: TimelineEvent['metadata'] & { type?: TimelineEvent['type'] }
} {
  // String values
  if (typeof value === 'string') {
    return { text: value }
  }

  // Mantra objects
  if (isMantra(value)) {
    return {
      text: value.line,
      metadata: {
        theme: value.theme,
        difficulty: value.difficulty,
        type: 'mantra',
      },
    }
  }

  // Fallback for other objects
  if (value && typeof value === 'object') {
    if ('text' in value && typeof (value as { text: unknown }).text === 'string') {
      return { text: (value as { text: string }).text }
    }
    if ('line' in value && typeof (value as { line: unknown }).line === 'string') {
      return { text: (value as { line: string }).line }
    }
  }

  // Last resort: stringify
  return { text: String(value) }
}

/**
 * Type guard for Mantra objects
 */
function isMantra(value: unknown): value is Mantra {
  return (
    value !== null &&
    typeof value === 'object' &&
    'line' in value &&
    'theme' in value &&
    typeof (value as Mantra).line === 'string' &&
    typeof (value as Mantra).theme === 'string'
  )
}

/**
 * Filter a mantra pattern by subject/dominant before compilation.
 * This is a convenience function that applies common filters.
 */
export function filterMantras(
  pattern: Pattern<Mantra>,
  opts: { subject?: string; dominant?: string }
): Pattern<Mantra> {
  return (querySpan: TimeSpan) => {
    return pattern(querySpan).filter((event) => {
      const m = event.value

      // If subject filter is set, mantra must match or have no subject
      if (opts.subject) {
        if (m.subject && m.subject !== opts.subject) {
          return false
        }
      }

      // If dominant filter is set, mantra must match or have no dominant
      if (opts.dominant) {
        if (m.dominant && m.dominant !== opts.dominant) {
          return false
        }
      }

      return true
    })
  }
}

/**
 * Create a simple timeline from an array of texts.
 * Useful for testing or simple use cases without patterns.
 */
export function simpleTimeline(
  texts: string[],
  intervalMs: number = 3000
): Timeline {
  return {
    events: texts.map((text, i) => ({
      type: 'mantra' as const,
      text,
      startMs: i * intervalMs,
      durationMs: intervalMs * 0.9, // 90% duration, 10% gap
    })),
    totalDurationMs: texts.length * intervalMs,
    metadata: {
      themes: [],
      cycleCount: 1,
      cycleDurationMs: texts.length * intervalMs,
    },
  }
}

/**
 * Merge multiple timelines into one.
 * Events are interleaved by start time.
 */
export function mergeTimelines(...timelines: Timeline[]): Timeline {
  const allEvents = timelines.flatMap((t) => t.events)
  allEvents.sort((a, b) => a.startMs - b.startMs)

  const allThemes = new Set<string>()
  for (const t of timelines) {
    for (const theme of t.metadata.themes) {
      allThemes.add(theme)
    }
  }

  return {
    events: allEvents,
    totalDurationMs: Math.max(...timelines.map((t) => t.totalDurationMs)),
    metadata: {
      themes: Array.from(allThemes),
      cycleCount: Math.max(...timelines.map((t) => t.metadata.cycleCount)),
      cycleDurationMs: timelines[0]?.metadata.cycleDurationMs ?? 60000,
    },
  }
}
