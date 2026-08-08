/**
 * Presets — DESIGN.md §6.4.
 *
 * A preset is a NAMED SET OF PRIMITIVES and nothing else. `expandPreset` returns
 * a complete `UserConfig` plus an explicit `Partial<SessionOptions>`, and both
 * are handed to the same validation path a hand-built config takes. There is no
 * branch anywhere downstream that asks "was this a preset?", because the whole
 * point of §6.4 is that a preset cannot carry behavior a user could not have
 * typed themselves.
 *
 * That is why this module returns data rather than calling `plan` for you: the
 * moment a preset can invoke the planner on its own terms, it has a private path
 * to the engine and the expansion stops being auditable.
 *
 * An unknown preset is a HARD ERROR (`expandPreset` throws, `tryExpandPreset`
 * returns null). It is not silently coerced to `standard`: a typo'd preset name
 * that quietly plays a different session is exactly the class of failure §6.3
 * refuses.
 *
 * The three that ship are `standard`, `gentle` and `deep`. DESIGN.md §6.4
 * describes `gentle` as "cap at light" — that phrasing predates the deletion of
 * the intensity axis and there is no cap to set, so `gentle` expresses the same
 * intent with the knobs that still exist: a lower bell peak, a slower dwell band
 * and a shorter sitting. Nothing here reaches for `base_points`, a tier, or an
 * intensity ceiling, because none of those exist.
 */

import type { Names, SessionOptions, TripletMode, UserConfig } from '../../engine/types/config.ts';
import { DEFAULT_SESSION_OPTIONS } from '../../engine/types/config.ts';

/** The three presets that ship. Not extensible at runtime — §6.4. */
export const PRESET_IDS = ['standard', 'gentle', 'deep'] as const;

export type PresetId = (typeof PRESET_IDS)[number];

const PRESET_SET = new Set<string>(PRESET_IDS);

/** True when `id` names a preset that ships. */
export function isPresetId(id: string): id is PresetId {
  return PRESET_SET.has(id);
}

/**
 * A preset, fully expanded.
 *
 * `config` is a complete `UserConfig`; `options` is the explicit `SessionOptions`
 * overlay. Neither is merged in secret — a caller passes them to `plan` exactly
 * as it would pass a config the user assembled by hand.
 */
export interface ExpandedPreset {
  id: PresetId;
  /** One line, shown next to the preset. Not a tooltip — §6.2 forbids those. */
  summary: string;
  config: UserConfig;
  options: Partial<SessionOptions>;
}

/** Twenty minutes, the confirmed default sitting (DECISIONS.md #1). */
export const DEFAULT_DURATION_MS = 1_200_000;

/** The sitting lengths the duration control offers, in minutes. */
export const DURATION_CHOICES_MIN = [10, 15, 20, 30, 45] as const;

/**
 * The default names.
 *
 * Deliberately generic rather than empty: an unset `{subject}` renders the
 * placeholder itself in the live sample, and a first-run user reading
 * "{subject} is safe" learns nothing about what the person axis does.
 */
export const DEFAULT_NAMES: Names = Object.freeze({ subject: 'you', operator: 'the voice' });

/**
 * The starting theme set for a fresh install.
 *
 * Four tags, inside §6.8's "sessions read best with 3-5 themes" advisory, all
 * comfortably above `CORPUS_FLOOR`, and none of them heavy register. `induction`
 * and `emergence` are deliberately absent: §4.2 removes them from the titration
 * pool entirely and designates their bookend role from `SessionOptions`, so
 * enrolling them would put "you stand up rested and present" in reach at step 2.
 */
export const DEFAULT_THEMES: readonly string[] = Object.freeze([
  'focus',
  'submission',
  'obedience',
  'devotion',
]);

/** The baseline every preset starts from, before its own overrides. */
function baseConfig(): UserConfig {
  return {
    themes: [...DEFAULT_THEMES],
    excludedThemes: [],
    allowOperator: true,
    names: { ...DEFAULT_NAMES },
    targetDurationMs: DEFAULT_DURATION_MS,
    mode: 'parallel' as TripletMode,
    blocklist: [],
  };
}

/**
 * Expand a preset into explicit primitives.
 *
 * @throws when `id` is not one of `PRESET_IDS` — §6.4's hard error.
 *
 * The returned value is fresh on every call and shares no structure with the
 * frozen defaults, so a caller may mutate it without reaching back into
 * `DEFAULT_SESSION_OPTIONS` (a mutated shared default turns determinism into a
 * function of import order).
 */
export function expandPreset(id: string): ExpandedPreset {
  const expanded = tryExpandPreset(id);
  if (expanded === null) {
    throw new Error(
      `unknown preset ${JSON.stringify(id)}; the presets that ship are ${PRESET_IDS.join(', ')}`,
    );
  }
  return expanded;
}

/** `expandPreset` without the throw. Returns null for an unknown id. */
export function tryExpandPreset(id: string): ExpandedPreset | null {
  if (!isPresetId(id)) return null;

  const config = baseConfig();

  switch (id) {
    case 'standard':
      // Gaussian, parallel, 20 minutes. Every knob is the shipped default;
      // this preset exists to be nameable, not to change anything.
      return {
        id,
        summary: 'Twenty minutes, the default arc, three lanes running in parallel.',
        config,
        options: {},
      };

    case 'gentle':
      // A shallower bell and a slower dwell band. The bell peak drops so the
      // middle sits lower for longer; the dwell floor rises so nothing ever gets
      // as insistent as `standard` does at its peak.
      return {
        id,
        summary: 'Fifteen minutes, a shallower peak and a slower dwell — the least demanding sitting.',
        config: { ...config, targetDurationMs: 900_000 },
        options: {
          intensityBell: { peak: 0.5, width: 0.18 },
          pacing: {
            ...DEFAULT_SESSION_OPTIONS.pacing,
            dwellMinMs: 3400,
            dwellMaxMs: 4600,
          },
          person: {
            ...DEFAULT_SESSION_OPTIONS.person,
            // A shallower drift into the named self, and out again the same way.
            peakMix: 0.6,
          },
        },
      };

    case 'deep':
      // A wider, later-cresting bell and a tighter dwell floor. Thirty minutes,
      // because a deeper arc that finishes in twenty spends most of its length
      // climbing.
      return {
        id,
        summary: 'Thirty minutes, a wider peak and a tighter dwell — the most sustained sitting.',
        config: { ...config, targetDurationMs: 1_800_000 },
        options: {
          intensityBell: { peak: 0.55, width: 0.3 },
          pacing: {
            ...DEFAULT_SESSION_OPTIONS.pacing,
            dwellMinMs: 2600,
            dwellMaxMs: 4200,
          },
          person: {
            ...DEFAULT_SESSION_OPTIONS.person,
            peakMix: 0.9,
          },
        },
      };
  }
}

/** Every preset, expanded. For rendering the preset row. */
export function allPresets(): ExpandedPreset[] {
  return PRESET_IDS.map((id) => expandPreset(id));
}
