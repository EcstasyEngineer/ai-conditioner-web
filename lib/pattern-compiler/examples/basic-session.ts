/**
 * Example: Building a session with the pattern compiler
 *
 * Run with: npx tsx lib/pattern-compiler/examples/basic-session.ts
 */

import {
  cat,
  compile,
  fast,
  fromTheme,
  listThemes,
  loadMantrasForTheme,
  seq,
  slow,
  weave,
} from '../index'

// See what themes have mantras
const themes = listThemes()
const themesWithMantras = themes.filter((t) => loadMantrasForTheme(t).length > 0)
console.log(`Found ${themesWithMantras.length} themes with mantras:`)
console.log(themesWithMantras.slice(0, 10).join(', '), '...\n')

// Pick two themes to weave together
const theme1 = themesWithMantras.includes('Focus') ? 'Focus' : themesWithMantras[0]
const theme2 = themesWithMantras.includes('Blank') ? 'Blank' : themesWithMantras[1]

console.log(`Building session with ${theme1} and ${theme2}\n`)

// Build a pattern:
// - Start with a slow intro (2 cycles)
// - Main content: weave the two themes together, 4 cycles
// - End with a quick recap (1 cycle, double speed)
const session = cat(
  slow(2, fromTheme(theme1, { maxDifficulty: 'BASIC' }, 42)),
  slow(4, weave(1, fromTheme(theme1, {}, 43), fromTheme(theme2, {}, 44))),
  fast(2, fromTheme(theme1, { maxDifficulty: 'LIGHT' }, 45))
)

// Compile to a timeline
// 3 patterns in cat = 3 cycles total
// But we used slow(2), slow(4), fast(2) so actual cycles needed: 2 + 4 + 0.5 = 6.5
// Let's query 7 cycles
const timeline = compile(session, {
  cycles: 7,
  cycleDurationMs: 30000, // 30 seconds per cycle = 3.5 min total
  eventDurationMs: 3000,
})

console.log('Timeline Summary:')
console.log(`  Total duration: ${(timeline.totalDurationMs / 1000 / 60).toFixed(1)} minutes`)
console.log(`  Events: ${timeline.events.length}`)
console.log(`  Themes: ${timeline.metadata.themes.join(', ')}`)
console.log()

console.log('First 10 events:')
timeline.events.slice(0, 10).forEach((e, i) => {
  const timeStr = (e.startMs / 1000).toFixed(1).padStart(6)
  console.log(`  ${timeStr}s: [${e.metadata?.difficulty || '???'}] ${e.text.slice(0, 60)}...`)
})

console.log()
console.log('Last 5 events:')
timeline.events.slice(-5).forEach((e) => {
  const timeStr = (e.startMs / 1000).toFixed(1).padStart(6)
  console.log(`  ${timeStr}s: [${e.metadata?.difficulty || '???'}] ${e.text.slice(0, 60)}...`)
})
