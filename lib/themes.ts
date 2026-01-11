import fs from 'fs';
import path from 'path';
import { prisma } from './db';
import { Difficulty } from '@prisma/client';

export interface ThemeOntology {
  description: string;
  appeal: string;
  keywords: string[];
  cnc?: boolean;
  tags?: string[];
}

export interface MantraEntry {
  type: string;
  line: string;
  theme: string;
  dominant: string | null;
  subject: string | null;
  difficulty: string;
}

export class ThemeLoader {
  private ontologiesPath = path.join(process.cwd(), 'ontologies');
  private mantrasPath = path.join(process.cwd(), 'hypnosis', 'mantras');

  async loadAllThemes() {
    const ontologyFiles = fs.readdirSync(this.ontologiesPath)
      .filter(file => file.endsWith('.json'));

    for (const file of ontologyFiles) {
      const themeName = path.basename(file, '.json');
      await this.loadTheme(themeName);
    }
  }

  async loadTheme(themeName: string) {
    try {
      // Load ontology
      const ontologyPath = path.join(this.ontologiesPath, `${themeName}.json`);
      const ontologyData: ThemeOntology = JSON.parse(
        fs.readFileSync(ontologyPath, 'utf-8')
      );

      // Check if theme already exists
      let theme = await prisma.theme.findUnique({
        where: { name: themeName }
      });

      const tags = ontologyData.tags || this.categorizeTheme(themeName);

      if (!theme) {
        // Create theme with JSON-stringified arrays for SQLite
        theme = await prisma.theme.create({
          data: {
            name: themeName,
            description: ontologyData.description,
            appeal: ontologyData.appeal || '',
            keywords: JSON.stringify(ontologyData.keywords || []),
            categories: JSON.stringify(tags),
            relatedThemes: JSON.stringify([]),
            cnc: ontologyData.cnc || false
          }
        });
      }

      // Load mantras if available
      await this.loadMantras(theme.id, themeName);

      return theme;
    } catch (error) {
      console.error(`Error loading theme ${themeName}:`, error);
      return null;
    }
  }

  private async loadMantras(themeId: string, themeName: string) {
    // Look for mantra files in different category folders
    const categories = ['Behavior', 'Ds', 'Experience', 'Hypnosis', 'Identity', 'Personality'];

    for (const category of categories) {
      const jsonPath = path.join(this.mantrasPath, category, `${themeName}.json`);

      if (fs.existsSync(jsonPath)) {
        await this.loadMantraFile(themeId, jsonPath);
        return; // Found mantras, stop looking
      }
    }
  }

  private async loadMantraFile(themeId: string, filePath: string) {
    try {
      const entries: MantraEntry[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      // Group by template pattern - we want unique templates
      const templates = new Map<string, MantraEntry>();

      for (const entry of entries) {
        // Skip entries with specific subjects/dominants - we want templates
        // OR take the first occurrence as the template
        if (!entry.subject && !entry.dominant) {
          const key = entry.line;
          if (!templates.has(key)) {
            templates.set(key, entry);
          }
        }
      }

      // If no generic templates found, use first 100 unique lines as-is
      if (templates.size === 0) {
        const seen = new Set<string>();
        for (const entry of entries.slice(0, 400)) {
          if (!seen.has(entry.line)) {
            seen.add(entry.line);
            templates.set(entry.line, entry);
            if (templates.size >= 100) break;
          }
        }
      }

      for (const [template, entry] of templates) {
        const difficulty = this.mapDifficulty(entry.difficulty);
        const hasDominant = entry.dominant !== null || template.toLowerCase().includes('master') || template.toLowerCase().includes('mistress');

        try {
          await prisma.mantra.upsert({
            where: {
              themeId_template: {
                themeId,
                template
              }
            },
            update: {
              difficulty,
              points: this.getPoints(difficulty),
              hasDominant
            },
            create: {
              themeId,
              template,
              difficulty,
              points: this.getPoints(difficulty),
              hasDominant,
              crossThemes: JSON.stringify([])
            }
          });
        } catch {
          // Skip duplicates silently
        }
      }
    } catch (error) {
      console.error(`Error loading mantras from ${filePath}:`, error);
    }
  }

  private mapDifficulty(diff: string): Difficulty {
    const map: Record<string, Difficulty> = {
      'BASIC': 'BASIC',
      'LIGHT': 'LIGHT',
      'MODERATE': 'MODERATE',
      'DEEP': 'DEEP',
      'EXTREME': 'EXTREME'
    };
    return map[diff.toUpperCase()] || 'BASIC';
  }

  private getPoints(difficulty: Difficulty): number {
    const points: Record<Difficulty, number> = {
      'BASIC': 12,
      'LIGHT': 25,
      'MODERATE': 40,
      'DEEP': 70,
      'EXTREME': 110
    };
    return points[difficulty];
  }

  private categorizeTheme(themeName: string): string[] {
    const categories: Record<string, string[]> = {
      'Experience': ['Dreaming', 'Ego_Loss', 'Emotion_Joy', 'Emotion_Love', 'Emptiness', 'Fear', 'Pleasure', 'Safety', 'Bliss'],
      'Personality': ['Addiction', 'Brattiness', 'Confidence', 'Dependency', 'Devotion', 'Feminine', 'Neediness', 'Sluttiness', 'Vanity'],
      'Hypnosis': ['Acceptance', 'Brainwashing', 'Confusion', 'Focus', 'Mindbreak', 'Relaxation', 'Suggestibility'],
      'Identity': ['Bimbo', 'Doll', 'Drone', 'Maid', 'Slave', 'Cheerleader', 'Cultist'],
      'Behavior': ['Anal', 'Chastity', 'Edging', 'Exhibitionism', 'Fitness', 'Nudism', 'Productivity'],
      'Ds': ['Clicker', 'Consent_Erosion', 'Free_Use', 'Gaslighting', 'Obedience', 'Submission', 'Worship']
    };

    for (const [category, themes] of Object.entries(categories)) {
      if (themes.includes(themeName)) {
        return [category];
      }
    }

    return ['Uncategorized'];
  }
}
