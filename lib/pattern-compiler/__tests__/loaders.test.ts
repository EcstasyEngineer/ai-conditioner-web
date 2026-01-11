/**
 * Loader Tests - Real Data Integration
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearCache,
  compile,
  filterByMaxDifficulty,
  fromTheme,
  getMantrasForTheme,
  listThemes,
  loadMantrasForTheme,
  loadOntology,
  weave,
  withMaxDifficulty,
} from '../index'

beforeEach(() => {
  clearCache()
})

describe('listThemes', () => {
  it('finds theme files in ontologies directory', () => {
    const themes = listThemes()

    expect(themes.length).toBeGreaterThan(0)
    expect(themes).toContain('Focus')
    expect(themes).toContain('Blank')
  })
})

describe('loadOntology', () => {
  it('loads ontology metadata for a theme', () => {
    const ontology = loadOntology('Focus')

    expect(ontology).not.toBeNull()
    expect(ontology?.description).toBeDefined()
    expect(ontology?.keywords).toBeInstanceOf(Array)
    expect(ontology?.keywords.length).toBeGreaterThan(0)
  })

  it('returns null for non-existent theme', () => {
    const ontology = loadOntology('NonExistentTheme12345')
    expect(ontology).toBeNull()
  })
})

describe('loadMantrasForTheme', () => {
  it('loads mantras for a theme with data', () => {
    // Try a few themes that should have mantras
    const themes = listThemes()
    let foundMantras = false

    for (const theme of themes.slice(0, 10)) {
      const mantras = loadMantrasForTheme(theme)
      if (mantras.length > 0) {
        foundMantras = true

        // Check mantra structure
        const first = mantras[0]
        expect(first.line).toBeDefined()
        expect(first.theme).toBe(theme)
        expect(first.difficulty).toBeDefined()
        break
      }
    }

    expect(foundMantras).toBe(true)
  })

  it('returns empty array for theme without mantra file', () => {
    const mantras = loadMantrasForTheme('NonExistentTheme12345')
    expect(mantras).toEqual([])
  })
})

describe('getMantrasForTheme (cached)', () => {
  it('returns same result on subsequent calls', () => {
    const themes = listThemes()
    const theme = themes.find((t) => loadMantrasForTheme(t).length > 0)

    if (theme) {
      const first = getMantrasForTheme(theme)
      const second = getMantrasForTheme(theme)

      expect(first.length).toBe(second.length)
    }
  })
})

describe('filterByMaxDifficulty', () => {
  it('filters mantras by difficulty level', () => {
    const themes = listThemes()
    let tested = false

    for (const theme of themes) {
      const mantras = loadMantrasForTheme(theme)
      if (mantras.length > 0) {
        const easy = filterByMaxDifficulty(mantras, 'BASIC')
        const medium = filterByMaxDifficulty(mantras, 'MEDIUM')
        const all = filterByMaxDifficulty(mantras, 'EXTREME')

        expect(easy.length).toBeLessThanOrEqual(medium.length)
        expect(medium.length).toBeLessThanOrEqual(all.length)
        expect(all.length).toBe(mantras.length)

        // All 'easy' should be BASIC
        for (const m of easy) {
          expect(m.difficulty).toBe('BASIC')
        }

        tested = true
        break
      }
    }

    expect(tested).toBe(true)
  })
})

describe('fromTheme', () => {
  it('creates a pattern from theme mantras', () => {
    // Find a theme with mantras
    const themes = listThemes()
    let theme: string | undefined

    for (const t of themes) {
      if (loadMantrasForTheme(t).length > 0) {
        theme = t
        break
      }
    }

    if (!theme) {
      console.warn('No themes with mantras found, skipping test')
      return
    }

    const pat = fromTheme(theme, {}, 42)
    const events = pat({ start: 0, end: 1 })

    expect(events.length).toBeGreaterThan(0)
    expect(events[0].value.theme).toBe(theme)
    expect(events[0].value.line).toBeDefined()
  })

  it('respects maxDifficulty option', () => {
    const themes = listThemes()
    let theme: string | undefined

    for (const t of themes) {
      const mantras = loadMantrasForTheme(t)
      // Find a theme with both basic and non-basic mantras
      const basic = mantras.filter((m) => m.difficulty === 'BASIC')
      const nonBasic = mantras.filter((m) => m.difficulty !== 'BASIC')
      if (basic.length > 0 && nonBasic.length > 0) {
        theme = t
        break
      }
    }

    if (!theme) {
      console.warn('No theme with mixed difficulty found, skipping')
      return
    }

    const easyPat = fromTheme(theme, { maxDifficulty: 'BASIC' }, 42)
    const events = easyPat({ start: 0, end: 1 })

    for (const event of events) {
      expect(event.value.difficulty).toBe('BASIC')
    }
  })

  it('returns empty pattern for non-existent theme', () => {
    const pat = fromTheme('NonExistentTheme12345')
    const events = pat({ start: 0, end: 1 })
    expect(events).toEqual([])
  })
})

describe('compile with real mantras', () => {
  it('compiles a theme pattern to timeline', () => {
    const themes = listThemes()
    let theme: string | undefined

    for (const t of themes) {
      if (loadMantrasForTheme(t).length > 0) {
        theme = t
        break
      }
    }

    if (!theme) {
      console.warn('No themes with mantras found, skipping test')
      return
    }

    const pat = fromTheme(theme, {}, 42)
    const timeline = compile(pat, {
      cycles: 2,
      cycleDurationMs: 10000,
    })

    expect(timeline.events.length).toBeGreaterThan(0)
    expect(timeline.totalDurationMs).toBe(20000)
    expect(timeline.metadata.themes).toContain(theme)

    // All events should have text
    for (const event of timeline.events) {
      expect(event.text.length).toBeGreaterThan(0)
    }
  })
})

describe('weave with real themes', () => {
  it('interleaves mantras from multiple themes', () => {
    const themes = listThemes()
    const themesWithMantras = themes.filter(
      (t) => loadMantrasForTheme(t).length > 0
    )

    if (themesWithMantras.length < 2) {
      console.warn('Need at least 2 themes with mantras, skipping')
      return
    }

    const [theme1, theme2] = themesWithMantras.slice(0, 2)
    const pat = weave(1, fromTheme(theme1, {}, 42), fromTheme(theme2, {}, 43))

    const events = pat({ start: 0, end: 1 })

    // Should have events from both themes
    const themes1 = events.filter((e) => e.value.theme === theme1)
    const themes2 = events.filter((e) => e.value.theme === theme2)

    expect(themes1.length).toBeGreaterThan(0)
    expect(themes2.length).toBeGreaterThan(0)
  })
})
