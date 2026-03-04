export interface Mantra {
  text: string;
  base_points: number;
}

export interface Theme {
  theme: string;
  description: string;
  mantras: Mantra[];
}

const themeCache = new Map<string, Theme>();

/**
 * Load a single theme by name
 */
export async function loadTheme(themeName: string): Promise<Theme> {
  const cached = themeCache.get(themeName);
  if (cached) return cached;

  const response = await fetch(`/data/mantras/${themeName}.json`);
  if (!response.ok) {
    throw new Error(`Failed to load theme: ${themeName}`);
  }

  const theme: Theme = await response.json();
  themeCache.set(themeName, theme);
  return theme;
}

/**
 * Get list of available theme names
 */
export async function getAvailableThemes(): Promise<string[]> {
  // For now, hardcode the list since we know what's in public/data/mantras/
  // Could be replaced with a manifest file if themes change frequently
  return [
    'acceptance',
    'addiction',
    'amnesia',
    'bimbo',
    'blank',
    'brainwashing',
    'degradation',
    'denial',
    'devotion',
    'drone',
    'exhibition',
    'feminine',
    'focus',
    'free_use',
    'gratitude',
    'obedience',
    'puppet',
    'resistance',
    'sluttiness',
    'submission',
    'suggestibility',
    'worship',
  ];
}

/**
 * Capitalize the first letter of a string
 */
function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Substitute template variables in mantra text
 * Ensures first letter is capitalized after substitution
 */
export function renderMantra(
  text: string,
  petName: string,
  dominantName: string
): string {
  const rendered = text
    .replace(/\{subject\}/g, petName)
    .replace(/\{controller\}/g, dominantName);
  return capitalizeFirst(rendered);
}

export interface PlaylistItem {
  originalText: string;
  renderedText: string;
  points: number;
}

/**
 * Generate a playlist from a theme with the given duration target
 */
export function generatePlaylist(
  theme: Theme,
  petName: string,
  dominantName: string,
  durationMinutes: number
): PlaylistItem[] {
  // Rough estimate: ~4 seconds per mantra on average
  const estimatedMantrasNeeded = Math.ceil((durationMinutes * 60) / 4);

  // Shuffle mantras
  const shuffled = [...theme.mantras].sort(() => Math.random() - 0.5);

  // Take what we need, cycling if necessary
  const playlist: PlaylistItem[] = [];
  for (let i = 0; i < estimatedMantrasNeeded; i++) {
    const mantra = shuffled[i % shuffled.length];
    playlist.push({
      originalText: mantra.text,
      renderedText: renderMantra(mantra.text, petName, dominantName),
      points: mantra.base_points,
    });
  }

  return playlist;
}
