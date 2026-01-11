/**
 * Pattern Compiler
 *
 * A TidalCycles-inspired pattern language for composing hypnotic audio sessions.
 *
 * @example
 * ```typescript
 * import { pure, seq, cat, stack, weave, fast, slow, compile } from './pattern-compiler'
 *
 * // Simple pattern: cycle through three values
 * const p1 = seq("a", "b", "c")
 *
 * // Combine patterns: a then b then c, each for one cycle
 * const p2 = cat(pure("intro"), pure("main"), pure("outro"))
 *
 * // Layer patterns: both play simultaneously
 * const p3 = stack(pure("foreground"), pure("background"))
 *
 * // Time manipulation
 * const p4 = fast(2, seq("quick", "pulses"))  // twice per cycle
 * const p5 = slow(2, seq("slow", "flow"))     // takes two cycles
 *
 * // Interleave from multiple sources
 * const p6 = weave(1, seq("focus", "clarity"), seq("relax", "breathe"))
 *
 * // Compile to a playable timeline
 * const timeline = compile(p1, {
 *   cycles: 4,
 *   cycleDurationMs: 30000  // 30 seconds per cycle
 * })
 * ```
 */

// Types
export type {
  CompileOptions,
  Difficulty,
  Event,
  Mantra,
  Pattern,
  PatternTransform,
  ScriptBlock,
  SourceOptions,
  Timeline,
  TimelineEvent,
  TimeSpan,
} from './types'

export { DIFFICULTY_ORDER } from './types'

// Sources
export {
  fromMantras,
  fromPool,
  pure,
  seq,
  silence,
  // Utilities
  seededRandom,
  shuffleWithSeed,
  span,
  spanDuration,
  spanIntersection,
  spansOverlap,
} from './sources'

// Combinators
export {
  // Time
  early,
  fast,
  late,
  slow,
  // Structure
  alternate,
  cat,
  stack,
  weave,
  // Modifiers
  degradeBy,
  every,
  filter,
  fmap,
  // Curried helpers
  withFast,
  withFilter,
  withSlow,
} from './combinators'

// Compilation
export {
  compile,
  filterMantras,
  mergeTimelines,
  simpleTimeline,
} from './compile'

// Data Loaders
export {
  clearCache,
  filterByDifficultyRange,
  filterByMaxDifficulty,
  filterByMinDifficulty,
  fromTheme,
  getMantrasForTheme,
  listThemes,
  loadAllMantras,
  loadMantrasForTheme,
  loadOntology,
  withDifficultyRange,
  withMaxDifficulty,
} from './loaders'

export type { FromThemeOptions, RawMantraEntry, ThemeOntology } from './loaders'
