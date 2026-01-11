# Pattern Compiler Design Document

**Status:** Exploration/Design Phase
**Started:** 2026-01-03
**Goal:** Design a TidalCycles-inspired pattern language for composing hypnotic audio sessions

---

## Progress Log

### 2026-01-03 - Initial Exploration

#### Context
The existing `lib/session-engine/` has cyclers, players, and a director class that are never actually used. The player page ignores all of it and just iterates through phases. Rather than resurrect that OOP approach, we're exploring a functional, TidalCycles-inspired pattern compiler.

#### Core Insight
TidalCycles works because:
1. Patterns are **functions from time → events**, not data structures
2. Combinators **compose** patterns without mutating state
3. Time is **cyclical and relative**, not absolute milliseconds
4. The language is **declarative** - you describe what, not how

#### Data Available
- `ontologies/*.json` - Theme metadata (description, keywords, tags, cnc flag)
- `hypnosis/mantras/{category}/{theme}.json` - Actual spoken lines with variants for subject/dominant
- `hypnosis/modular/*.txt` - Longer script blocks (inductions, deepeners, wakeners)

Mantras have structure:
```json
{
  "type": "audio",
  "line": "I drift into a serene dreamscape.",
  "theme": "Dreaming",
  "dominant": null,
  "subject": null,
  "difficulty": "BASIC"
}
```

---

## Design Decisions

### Decision 1: Function Composition vs String DSL

**Options:**
- **A) TypeScript functions** - `weave(fromTheme('Focus'), fromTheme('Blank'))`
- **B) String DSL** - `"weave(Focus, Blank) >> slow(1.5)"`
- **C) Hybrid** - Functions for implementation, optional string parser for UI

**Leaning toward:** C (Hybrid)

Rationale: Functions are easier to implement and type-check. String DSL can come later for a "code editor" UI experience. The function API is the foundation either way.

### Decision 2: Pattern Representation

Following TidalCycles, a Pattern is a function that queries a time span and returns events:

```typescript
type TimeSpan = { start: number; end: number }  // cycles, not ms
type Event<T> = {
  value: T
  whole: TimeSpan    // the "ideal" extent of this event
  part: TimeSpan     // the portion within the queried span
}
type Pattern<T> = (span: TimeSpan) => Event<T>[]
```

This is the key insight - patterns are queryable, not iterable. You ask "what happens between cycle 2.5 and 3.0?" and get back events.

### Decision 3: Mantra Selection Strategy

**Problem:** A theme might have 500 mantras. How do we cycle through them?

**Options:**
- Sequential (1, 2, 3, ... wrap around)
- Random (pick any)
- Weighted random (by difficulty, by recency)
- Shuffle (random order, but hit all before repeating)

**Decision:** Make it configurable per-source:

```typescript
fromTheme('Focus')                    // default: shuffle
fromTheme('Focus', { order: 'seq' })  // sequential
fromTheme('Focus', { order: 'random' }) // true random
```

### Decision 4: How Modular Scripts Fit

Inductions/deepeners/wakeners are not single mantras - they're multi-paragraph blocks meant to play as a unit.

**Approach:** Different primitive type

```typescript
type ScriptBlock = {
  type: 'block'
  name: string
  lines: string[]  // parsed from .txt, split on double-newline or sentence
}

// Creates a pattern that plays this block once, taking N cycles
block(name: string, cycles: number): Pattern<ScriptBlock>

// Full session might be:
cat(
  block('induction/basic', 2),      // 2 cycles for induction
  slow(8, weave(                    // main content over 8 cycles
    fromTheme('Focus'),
    fromTheme('Blank')
  )),
  block('wakener/gentle', 1)        // 1 cycle to wake
)
```

### Decision 5: Compilation Target

The pattern compiler outputs a `Timeline` - a flat list of timed events ready for playback:

```typescript
type TimelineEvent = {
  type: 'mantra' | 'block-line'
  text: string
  startMs: number
  durationMs: number
  // Future: pan, voice, layer
}

type Timeline = {
  events: TimelineEvent[]
  totalDurationMs: number
  metadata: {
    themes: string[]
    difficulty: { min: Difficulty, max: Difficulty }
    // ...
  }
}
```

This is what the player consumes. The pattern→timeline compilation is a pure function.

---

## API Sketch (v0.1)

### Sources

```typescript
// Mantra sources
fromTheme(theme: string, opts?: { order: 'shuffle' | 'seq' | 'random' }): Pattern<Mantra>
fromPool(mantras: Mantra[]): Pattern<Mantra>
pure<T>(value: T): Pattern<T>  // constant pattern

// Script block sources
block(path: string, cycles?: number): Pattern<ScriptBlock>
```

### Time Combinators

```typescript
fast(factor: number, pat: Pattern<T>): Pattern<T>
slow(factor: number, pat: Pattern<T>): Pattern<T>
early(cycles: number, pat: Pattern<T>): Pattern<T>
late(cycles: number, pat: Pattern<T>): Pattern<T>
```

### Structure Combinators

```typescript
cat(...pats: Pattern<T>[]): Pattern<T>           // sequence
stack(...pats: Pattern<T>[]): Pattern<T>         // layer
weave(count: number, ...pats: Pattern<T>[]): Pattern<T>  // interleave
```

### Modifiers

```typescript
filter(pred: (v: T) => boolean, pat: Pattern<T>): Pattern<T>
degradeBy(probability: number, pat: Pattern<T>): Pattern<T>
every(n: number, fn: Transform<T>, pat: Pattern<T>): Pattern<T>
```

### Domain-Specific

```typescript
// Filter mantras by difficulty
difficulty(level: Difficulty, pat: Pattern<Mantra>): Pattern<Mantra>
difficultyRange(min: Difficulty, max: Difficulty, pat: Pattern<Mantra>): Pattern<Mantra>

// Ramp difficulty over pattern duration
rampDifficulty(from: Difficulty, to: Difficulty, pat: Pattern<Mantra>): Pattern<Mantra>

// Filter by subject/dominant variant
forSubject(name: string, pat: Pattern<Mantra>): Pattern<Mantra>
forDominant(name: string, pat: Pattern<Mantra>): Pattern<Mantra>
```

### Compilation

```typescript
compile(pat: Pattern<Mantra | ScriptBlock>, opts: {
  cycles: number
  cycleDurationMs: number
  subject?: string
  dominant?: string
}): Timeline
```

---

## Implementation Plan

### Phase 1: Core Pattern Types ✅ COMPLETE
- [x] Define base types (Pattern, Event, TimeSpan)
- [x] Implement `pure`, `fromPool`, `seq` sources
- [x] Implement `cat`, `stack` combinators
- [x] Implement `fast`, `slow`, `early`, `late` time scaling
- [x] Implement `weave`, `alternate` structural combinators
- [x] Implement `filter`, `fmap`, `degradeBy`, `every` modifiers
- [x] Basic `compile` function
- [x] Unit tests (30 passing)

**Files created:**
- `lib/pattern-compiler/types.ts` - Core type definitions
- `lib/pattern-compiler/sources.ts` - Pattern sources (pure, seq, fromPool, etc.)
- `lib/pattern-compiler/combinators.ts` - All combinators
- `lib/pattern-compiler/compile.ts` - Timeline compilation
- `lib/pattern-compiler/index.ts` - Public API
- `lib/pattern-compiler/__tests__/pattern-compiler.test.ts` - Test suite

### Phase 2: Mantra Integration ✅ COMPLETE
- [x] Load mantras from JSON files (`loadMantrasForTheme`, `loadAllMantras`)
- [x] Implement `fromTheme` with shuffle/seq/random ordering
- [x] Implement difficulty filtering (`filterByMaxDifficulty`, `withMaxDifficulty`, etc.)
- [x] Implement subject/dominant filtering (via `fromTheme` options)
- [x] Test with real mantra data (12 tests)
- [x] Example script demonstrating full session composition

**New files:**
- `lib/pattern-compiler/loaders.ts` - Data loading and theme-based patterns
- `lib/pattern-compiler/__tests__/loaders.test.ts` - Real data tests
- `lib/pattern-compiler/examples/basic-session.ts` - Usage example

### Phase 3: Script Blocks
- [ ] Parse modular/*.txt files into blocks
- [ ] Implement `block` primitive
- [ ] Handle block timing in compilation

### Phase 4: Integration
- [ ] Wire into existing player page as alternative mode
- [ ] UI for pattern construction (or text input)
- [ ] Compare with old session-engine approach
- [ ] Decide what to delete

---

## Open Questions

1. **How should we handle mantra duration?** TTS audio length varies. Options:
   - Fixed duration per mantra (e.g., 3 seconds)
   - Estimate from text length
   - Query actual audio duration (requires TTS integration)
   - Let events overlap / have gaps and let player handle

2. **Layering semantics** - When `stack` layers two mantra patterns, do they play simultaneously (cacophony) or in separate "channels" (left/right ear, foreground/background)?

3. **State and randomness** - Patterns should be pure functions, but shuffle order needs state. TidalCycles handles this with a random seed per cycle. Need to design this carefully.

4. **Integration with existing DB schema** - Currently sessions are stored as Prisma models with phases/items. Do compiled timelines get stored? Or is the pattern definition stored and compiled on playback?

---

## Files to Create

```
lib/pattern-compiler/
  index.ts           # public API exports
  types.ts           # Pattern, Event, TimeSpan, etc.
  sources.ts         # fromTheme, fromPool, block, pure
  combinators.ts     # cat, stack, weave, fast, slow, etc.
  filters.ts         # difficulty, subject, dominant filters
  compile.ts         # Pattern → Timeline
  __tests__/
    combinators.test.ts
    compile.test.ts
```

---

## Session Log

### 2026-01-03 Evening - Phase 1 Complete

Implemented the full core pattern API:

**Sources:**
- `pure(value)` - constant value every cycle
- `seq(...values)` - sequence within a cycle
- `fromPool(items, opts, seed)` - draw from a pool with shuffle/sequential/random order
- `silence()` - empty pattern
- `fromMantras(mantras, theme, opts, seed)` - filter mantras by theme

**Time combinators:**
- `fast(factor, pat)` - speed up
- `slow(factor, pat)` - slow down
- `early(amount, pat)` - shift earlier
- `late(amount, pat)` - shift later

**Structure combinators:**
- `stack(...pats)` - layer patterns (simultaneous)
- `cat(...pats)` - concatenate (sequential, one cycle each)
- `weave(count, ...pats)` - interleave events round-robin
- `alternate(cyclesEach, ...pats)` - switch patterns every N cycles

**Modifiers:**
- `fmap(fn, pat)` - transform values
- `filter(pred, pat)` - filter events
- `degradeBy(prob, pat, seed)` - randomly drop events
- `every(n, transform, pat)` - apply transform every Nth cycle

**Compilation:**
- `compile(pat, opts)` - produce Timeline from pattern
- `filterMantras(pat, opts)` - pre-filter by subject/dominant
- `simpleTimeline(texts, intervalMs)` - quick timeline from strings
- `mergeTimelines(...timelines)` - combine timelines

All tests passing (30/30). Ready for Phase 2: loading real mantra data.

### 2026-01-03 Night - Phase 2 Complete

Implemented data loading layer:

**Loaders:**
- `loadMantrasForTheme(name)` - load raw JSON from disk
- `loadOntology(name)` - load theme metadata
- `listThemes()` - enumerate available themes
- `getMantrasForTheme(name)` - cached version
- `loadAllMantras()` - load everything (cached)
- `clearCache()` - reset for testing

**Theme Pattern Source:**
- `fromTheme(name, opts, seed)` - creates a pattern drawing from a theme's mantra pool
- Options: `order` (shuffle/sequential/random), `maxDifficulty`, `subject`, `dominant`

**Difficulty Helpers:**
- `filterByMaxDifficulty(mantras, level)` - array filter
- `filterByMinDifficulty(mantras, level)` - array filter
- `filterByDifficultyRange(mantras, min, max)` - array filter
- `withMaxDifficulty(level, pat)` - pattern modifier
- `withDifficultyRange(min, max, pat)` - pattern modifier

**Example session builder:**
```typescript
const session = cat(
  slow(2, fromTheme('Focus', { maxDifficulty: 'BASIC' })),
  slow(4, weave(1, fromTheme('Focus'), fromTheme('Blank'))),
  fast(2, fromTheme('Focus', { maxDifficulty: 'LIGHT' }))
)

const timeline = compile(session, {
  cycles: 7,
  cycleDurationMs: 30000
})
```

Test run shows 2700 events over 3.5 minutes with mixed difficulty progression. Working!

---

## Next Session TODO

- Phase 3: Script blocks (inductions, deepeners, wakeners)
- Or: Start wiring into the player page for real playback
- Consider: event count is high - may want pagination or streaming for long sessions
