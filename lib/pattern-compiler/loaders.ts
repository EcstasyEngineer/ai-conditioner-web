/**
 * Pattern Compiler - Data Loaders
 *
 * Pure functions for loading mantra and ontology data from JSON files.
 * These are independent of Prisma/database - they read directly from disk.
 */

import fs from 'fs'
import path from 'path'
import type { Difficulty, Mantra, Pattern, SourceOptions } from './types'
import { fromPool } from './sources'

// === Types for raw JSON data ===

export interface RawMantraEntry {
  type: string
  line: string
  theme: string
  dominant: string | null
  subject: string | null
  difficulty: string
}

export interface ThemeOntology {
  description: string
  appeal?: string
  keywords: string[]
  cnc?: boolean
  tags?: string[]
}

// === File paths ===

const ONTOLOGIES_PATH = path.join(process.cwd(), 'ontologies')
const MANTRAS_PATH = path.join(process.cwd(), 'hypnosis', 'mantras')
const MANTRA_CATEGORIES = ['Behavior', 'Ds', 'Experience', 'Hypnosis', 'Identity', 'Personality']

// === Caches ===

let mantraCache: Map<string, Mantra[]> | null = null
let ontologyCache: Map<string, ThemeOntology> | null = null

// === Difficulty mapping ===

const DIFFICULTY_MAP: Record<string, Difficulty> = {
  'BASIC': 'BASIC',
  'LIGHT': 'LIGHT',
  'MEDIUM': 'MEDIUM',
  'MODERATE': 'MEDIUM', // alias
  'DEEP': 'DEEP',
  'EXTREME': 'EXTREME',
}

function mapDifficulty(raw: string): Difficulty {
  return DIFFICULTY_MAP[raw.toUpperCase()] || 'BASIC'
}

// === Loading functions ===

/**
 * Load all mantras from a single theme's JSON file.
 * Returns normalized Mantra objects.
 */
export function loadMantrasForTheme(themeName: string): Mantra[] {
  for (const category of MANTRA_CATEGORIES) {
    const jsonPath = path.join(MANTRAS_PATH, category, `${themeName}.json`)

    if (fs.existsSync(jsonPath)) {
      try {
        const raw: RawMantraEntry[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

        return raw.map((entry) => ({
          line: entry.line,
          theme: entry.theme,
          difficulty: mapDifficulty(entry.difficulty),
          dominant: entry.dominant,
          subject: entry.subject,
        }))
      } catch (error) {
        console.error(`Error loading mantras for ${themeName}:`, error)
        return []
      }
    }
  }

  return []
}

/**
 * Load the ontology (metadata) for a theme.
 */
export function loadOntology(themeName: string): ThemeOntology | null {
  const ontologyPath = path.join(ONTOLOGIES_PATH, `${themeName}.json`)

  if (!fs.existsSync(ontologyPath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(ontologyPath, 'utf-8'))
  } catch (error) {
    console.error(`Error loading ontology for ${themeName}:`, error)
    return null
  }
}

/**
 * Get all available theme names (from ontologies directory).
 */
export function listThemes(): string[] {
  try {
    return fs
      .readdirSync(ONTOLOGIES_PATH)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.basename(f, '.json'))
  } catch {
    return []
  }
}

/**
 * Load all mantras from all themes into a single array.
 * Results are cached for performance.
 */
export function loadAllMantras(): Mantra[] {
  if (mantraCache) {
    return Array.from(mantraCache.values()).flat()
  }

  mantraCache = new Map()
  const themes = listThemes()

  for (const theme of themes) {
    const mantras = loadMantrasForTheme(theme)
    if (mantras.length > 0) {
      mantraCache.set(theme, mantras)
    }
  }

  return Array.from(mantraCache.values()).flat()
}

/**
 * Get mantras for a specific theme (with caching).
 */
export function getMantrasForTheme(themeName: string): Mantra[] {
  if (!mantraCache) {
    loadAllMantras() // populate cache
  }

  return mantraCache?.get(themeName) || loadMantrasForTheme(themeName)
}

/**
 * Clear the mantra cache (useful for testing or reloading).
 */
export function clearCache(): void {
  mantraCache = null
  ontologyCache = null
}

// === Pattern Sources ===

export interface FromThemeOptions extends SourceOptions {
  /** Filter to only include mantras matching this difficulty or easier */
  maxDifficulty?: Difficulty
  /** Filter to only include mantras with this subject (or null/generic) */
  subject?: string
  /** Filter to only include mantras with this dominant (or null/generic) */
  dominant?: string
}

/**
 * Create a pattern that draws from a theme's mantra pool.
 *
 * @example
 * const focusPat = fromTheme('Focus')
 * const easyFocus = fromTheme('Focus', { maxDifficulty: 'LIGHT' })
 * const shuffled = fromTheme('Focus', { order: 'shuffle' })
 */
export function fromTheme(
  themeName: string,
  opts: FromThemeOptions = {},
  seed: number = Date.now()
): Pattern<Mantra> {
  let mantras = getMantrasForTheme(themeName)

  // Apply filters
  if (opts.maxDifficulty) {
    mantras = filterByMaxDifficulty(mantras, opts.maxDifficulty)
  }

  if (opts.subject !== undefined) {
    mantras = mantras.filter(
      (m) => m.subject === null || m.subject === opts.subject
    )
  }

  if (opts.dominant !== undefined) {
    mantras = mantras.filter(
      (m) => m.dominant === null || m.dominant === opts.dominant
    )
  }

  if (mantras.length === 0) {
    // Return empty pattern if no mantras match
    return () => []
  }

  return fromPool(mantras, { order: opts.order ?? 'shuffle' }, seed)
}

// === Filtering helpers ===

import { DIFFICULTY_ORDER } from './types'

/**
 * Filter mantras to only include those at or below a max difficulty.
 */
export function filterByMaxDifficulty(
  mantras: Mantra[],
  maxDifficulty: Difficulty
): Mantra[] {
  const maxIndex = DIFFICULTY_ORDER.indexOf(maxDifficulty)
  return mantras.filter((m) => DIFFICULTY_ORDER.indexOf(m.difficulty) <= maxIndex)
}

/**
 * Filter mantras to only include those at or above a min difficulty.
 */
export function filterByMinDifficulty(
  mantras: Mantra[],
  minDifficulty: Difficulty
): Mantra[] {
  const minIndex = DIFFICULTY_ORDER.indexOf(minDifficulty)
  return mantras.filter((m) => DIFFICULTY_ORDER.indexOf(m.difficulty) >= minIndex)
}

/**
 * Filter mantras to a specific difficulty range.
 */
export function filterByDifficultyRange(
  mantras: Mantra[],
  minDifficulty: Difficulty,
  maxDifficulty: Difficulty
): Mantra[] {
  const minIndex = DIFFICULTY_ORDER.indexOf(minDifficulty)
  const maxIndex = DIFFICULTY_ORDER.indexOf(maxDifficulty)
  return mantras.filter((m) => {
    const index = DIFFICULTY_ORDER.indexOf(m.difficulty)
    return index >= minIndex && index <= maxIndex
  })
}

// === Pattern Difficulty Helpers ===

/**
 * Create a pattern modifier that filters to a max difficulty.
 */
export function withMaxDifficulty(
  maxDifficulty: Difficulty,
  pat: Pattern<Mantra>
): Pattern<Mantra> {
  const maxIndex = DIFFICULTY_ORDER.indexOf(maxDifficulty)
  return (span) =>
    pat(span).filter(
      (e) => DIFFICULTY_ORDER.indexOf(e.value.difficulty) <= maxIndex
    )
}

/**
 * Create a pattern modifier that filters to a difficulty range.
 */
export function withDifficultyRange(
  minDifficulty: Difficulty,
  maxDifficulty: Difficulty,
  pat: Pattern<Mantra>
): Pattern<Mantra> {
  const minIndex = DIFFICULTY_ORDER.indexOf(minDifficulty)
  const maxIndex = DIFFICULTY_ORDER.indexOf(maxDifficulty)
  return (span) =>
    pat(span).filter((e) => {
      const index = DIFFICULTY_ORDER.indexOf(e.value.difficulty)
      return index >= minIndex && index <= maxIndex
    })
}
