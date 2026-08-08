/**
 * Config persistence and the reject-don't-repair rule — DESIGN.md §6.1, §6.3.
 *
 * Two jobs, deliberately in one file because they are the same job seen from
 * two sides:
 *
 *   `normalizeConfig`  turn an untrusted value into a `UserConfig`, or say why
 *                      it is not one.
 *   `loadConfig`/`saveConfig`  move that value through `localStorage`.
 *
 * Storage is untrusted input. A config read back from `localStorage` was
 * written by a previous VERSION of this app, or hand-edited, or truncated by a
 * quota error mid-write, and treating it as a `UserConfig` because it
 * deserialized is how a session starts with `themes: undefined`. Everything
 * that comes out of storage goes through the same normalizer a form submission
 * does.
 *
 * REJECT, DON'T REPAIR (§6.3), and the exact shape of it matters:
 *
 *   A theme cannot be both enrolled and excluded, and THE SAVE BEING ATTEMPTED
 *   LOSES — mirrored in both directions, so the outcome never depends on click
 *   order.
 *
 * `applyThemeChange` is that rule as a function. Enrolling a theme that is
 * currently excluded is refused; excluding a theme that is currently enrolled
 * is refused; and both refusals name the same fix. The tempting alternative —
 * "enrolling silently un-excludes" — is what makes the result depend on which
 * list the user touched last, and a consent surface whose outcome depends on
 * click order is not a consent surface.
 *
 * An EMPTY THEME LIST IS ALLOWED. §6.3's carve-out: it is visible and simply
 * blocks Start. The guard targets the silent trap, not the obvious one.
 */

import type { Names, TripletMode, UserConfig } from '../../engine/types/config.ts';
import { isEnrollable, isTag } from '../../engine/corpus/vocabulary.ts';
import { DEFAULT_DURATION_MS, expandPreset } from '../setup/presets.ts';

/**
 * The storage key, versioned.
 *
 * A schema change bumps the suffix rather than migrating in place: a stored
 * config is worth far less than a correct one, and a migration path for a
 * four-field form is more code than re-picking four fields.
 */
export const CONFIG_STORAGE_KEY = 'hypnoapp.config.v1';

/** The shortest and longest sittings the form will accept, in ms. */
export const MIN_DURATION_MS = 300_000;
export const MAX_DURATION_MS = 3_600_000;

/** A reason a value could not be read as a `UserConfig`. */
export interface ConfigProblem {
  /** The field at fault, in dotted form (`names.subject`). */
  field: string;
  /** What is wrong, in one sentence. */
  message: string;
  /** What to change. Never optional — §6.3 requires the fix be named. */
  fix: string;
}

/** `normalizeConfig` returns one or the other; never a half-repaired config. */
export type NormalizeResult =
  | { ok: true; config: UserConfig }
  | { ok: false; problems: ConfigProblem[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every element is a string, and the array is deduplicated in first-seen order. */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Read an untrusted value as a `UserConfig`.
 *
 * Exhaustive rather than fail-fast: a form showing one problem at a time makes
 * a user fix four things in four round trips, and the planner's own validator
 * reports every error at once for the same reason.
 *
 * What this does NOT do is repair. A theme in both lists is reported, not
 * removed from one of them; an out-of-range duration is reported, not clamped.
 * The one exception is deduplication, which changes no meaning: a list
 * containing `focus` twice denotes exactly the set a list containing it once
 * denotes.
 */
export function normalizeConfig(value: unknown): NormalizeResult {
  const problems: ConfigProblem[] = [];

  if (!isPlainObject(value)) {
    return {
      ok: false,
      problems: [
        {
          field: '',
          message: 'the stored config is not an object',
          fix: 'start from a preset',
        },
      ],
    };
  }

  const themes = stringList(value.themes);
  if (themes === null) {
    problems.push({
      field: 'themes',
      message: 'themes must be a list of tag names',
      fix: 'pick your themes again, or start from a preset',
    });
  }

  const excludedThemes = stringList(value.excludedThemes);
  if (excludedThemes === null) {
    problems.push({
      field: 'excludedThemes',
      message: 'excludedThemes must be a list of tag names',
      fix: 'clear your exclusions and set them again',
    });
  }

  // Unknown tags are rejected rather than dropped. A stored config naming a tag
  // this build does not have is a config from a different vocabulary, and
  // silently dropping the name would hand the user a session filtered by fewer
  // exclusions than they set — the one direction a consent surface may never
  // fail in.
  if (themes !== null) {
    for (const theme of themes) {
      if (!isEnrollable(theme)) {
        problems.push({
          field: 'themes',
          message: `${theme} is not a theme that can be enrolled`,
          fix: `remove ${theme} from your themes`,
        });
      }
    }
  }
  if (excludedThemes !== null) {
    for (const theme of excludedThemes) {
      if (!isTag(theme)) {
        problems.push({
          field: 'excludedThemes',
          message: `${theme} is not a tag in this vocabulary`,
          fix: `remove ${theme} from your exclusions`,
        });
      }
    }
  }

  // §6.3, checked here as well as at the mutation site: `applyThemeChange`
  // prevents the state from ever being reached through the form, and this
  // catches a stored or hand-edited config that reached it another way.
  if (themes !== null && excludedThemes !== null) {
    const excludedSet = new Set(excludedThemes);
    for (const theme of themes) {
      if (excludedSet.has(theme)) {
        problems.push({
          field: 'themes',
          message: `${theme} is both enrolled and excluded`,
          fix: `remove ${theme} from one of the two lists — it cannot be in both`,
        });
      }
    }
  }

  if (typeof value.allowOperator !== 'boolean') {
    problems.push({
      field: 'allowOperator',
      message: 'allowOperator must be true or false',
      fix: 'set the operator toggle again',
    });
  }

  const names = normalizeNames(value.names, problems);

  const targetDurationMs = value.targetDurationMs;
  if (
    typeof targetDurationMs !== 'number' ||
    !Number.isFinite(targetDurationMs) ||
    targetDurationMs < MIN_DURATION_MS ||
    targetDurationMs > MAX_DURATION_MS
  ) {
    problems.push({
      field: 'targetDurationMs',
      message: `session length must be between ${MIN_DURATION_MS / 60_000} and ${MAX_DURATION_MS / 60_000} minutes`,
      fix: `set a length in that range, e.g. ${DEFAULT_DURATION_MS / 60_000} minutes`,
    });
  }

  const mode = value.mode;
  if (mode !== 'parallel' && mode !== 'unison') {
    problems.push({
      field: 'mode',
      message: 'mode must be parallel or unison',
      fix: 'set the mode toggle again',
    });
  }

  const blocklist = value.blocklist === undefined ? [] : stringList(value.blocklist);
  if (blocklist === null) {
    problems.push({
      field: 'blocklist',
      message: 'blocklist must be a list of mantra ids',
      fix: 'clear the blocklist',
    });
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config: {
      themes: themes as string[],
      excludedThemes: excludedThemes as string[],
      allowOperator: value.allowOperator as boolean,
      names: names as Names,
      targetDurationMs: targetDurationMs as number,
      mode: mode as TripletMode,
      blocklist: blocklist as string[],
    },
  };
}

/**
 * Names are trimmed, and empty is refused.
 *
 * A blank name is not a neutral choice: `substitute` would render an empty
 * string into the middle of a sentence, producing "  is safe" on a lane at full
 * opacity. Trimming is a normalization (the surrounding whitespace denotes
 * nothing); emptiness is a problem.
 */
function normalizeNames(value: unknown, problems: ConfigProblem[]): Names | null {
  if (!isPlainObject(value)) {
    problems.push({
      field: 'names',
      message: 'names must be an object with a subject and an operator',
      fix: 'set both names again',
    });
    return null;
  }
  const subject = typeof value.subject === 'string' ? value.subject.trim() : '';
  const operator = typeof value.operator === 'string' ? value.operator.trim() : '';
  if (subject === '') {
    problems.push({
      field: 'names.subject',
      message: 'the subject name is empty',
      fix: 'enter the name you want the lines to call you',
    });
  }
  if (operator === '') {
    problems.push({
      field: 'names.operator',
      message: 'the operator name is empty',
      fix: 'enter a name for the voice, or turn operator mantras off',
    });
  }
  if (subject === '' || operator === '') return null;
  return { subject, operator };
}

/**
 * The result of a theme toggle, under §6.3.
 *
 * `rejected` carries the message shown next to the control. The config comes
 * back UNCHANGED on a rejection rather than partially applied, which is what
 * "the save being attempted loses" means concretely.
 */
export interface ThemeChangeResult {
  config: UserConfig;
  rejected: ConfigProblem | null;
}

/** Which of the two lists a toggle targets. */
export type ThemeList = 'themes' | 'excludedThemes';

/**
 * Enrol, exclude, or clear a tag — the ONE mutation path for both lists.
 *
 * The mirror is the point. Enrolling an excluded tag and excluding an enrolled
 * tag are both refused, with the same fix named from either side, so the two
 * controls cannot disagree about the outcome and clicking them in the other
 * order cannot produce a different config.
 *
 * REMOVING is never refused. A user pulling a tag out of a list is narrowing
 * nothing and can always do it; only the addition that would create the
 * contradiction loses.
 */
export function applyThemeChange(
  config: UserConfig,
  list: ThemeList,
  tag: string,
  next: boolean,
): ThemeChangeResult {
  const other: ThemeList = list === 'themes' ? 'excludedThemes' : 'themes';

  if (!next) {
    return { config: { ...config, [list]: config[list].filter((t) => t !== tag) }, rejected: null };
  }

  if (config[other].includes(tag)) {
    const asEnrolled = other === 'themes';
    return {
      config,
      rejected: {
        field: list,
        message: asEnrolled
          ? `${tag} is already enrolled, so it cannot also be excluded`
          : `${tag} is already excluded, so it cannot also be enrolled`,
        fix: asEnrolled
          ? `remove ${tag} from your themes first, then exclude it`
          : `remove ${tag} from your exclusions first, then enrol it`,
      },
    };
  }

  if (list === 'themes' && !isEnrollable(tag)) {
    return {
      config,
      rejected: {
        field: 'themes',
        message: `${tag} can be excluded but never enrolled`,
        fix: `use the exclusion list for ${tag}`,
      },
    };
  }

  if (config[list].includes(tag)) return { config, rejected: null };

  return { config: { ...config, [list]: [...config[list], tag] }, rejected: null };
}

/**
 * The storage surface, narrowed to the two methods used.
 *
 * Injectable so a test never touches a real `localStorage` and so a browser
 * that denies storage (private mode, disabled cookies) degrades to running
 * without persistence rather than throwing during module init.
 */
export interface ConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The real `localStorage`, or null when it is unavailable.
 *
 * Accessing `localStorage` THROWS in some privacy configurations rather than
 * returning null, so the probe is a try/catch and not a truthiness check.
 */
export function defaultStorage(): ConfigStorage | null {
  try {
    const ls = (globalThis as { localStorage?: ConfigStorage }).localStorage;
    if (!ls) return null;
    // A denied store can be present and throw on first use; find out now, once,
    // rather than at the moment a user presses Save.
    const probe = `${CONFIG_STORAGE_KEY}.probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/** The config a fresh install starts with — `standard`, fully expanded. */
export function defaultConfig(): UserConfig {
  return expandPreset('standard').config;
}

/**
 * Read the stored config.
 *
 * Returns `defaultConfig()` for absent, unparseable, or invalid storage — this
 * is the ONE place a repair happens, and it repairs by discarding rather than
 * by patching, so a partially-valid stored config can never become a session.
 * `stale` says which happened, so the setup screen can mention it once instead
 * of silently replacing what the user had.
 */
export function loadConfig(storage: ConfigStorage | null = defaultStorage()): {
  config: UserConfig;
  stale: boolean;
} {
  if (storage === null) return { config: defaultConfig(), stale: false };

  let raw: string | null = null;
  try {
    raw = storage.getItem(CONFIG_STORAGE_KEY);
  } catch {
    return { config: defaultConfig(), stale: false };
  }
  if (raw === null) return { config: defaultConfig(), stale: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { config: defaultConfig(), stale: true };
  }

  const result = normalizeConfig(parsed);
  if (!result.ok) return { config: defaultConfig(), stale: true };
  return { config: result.config, stale: false };
}

/**
 * Write the config, refusing to store one that would not load.
 *
 * A save that persists an invalid config is a save that hands the next visit a
 * broken form, so the normalizer runs on the way OUT as well as on the way in.
 * Returns false when the config was refused or storage was unavailable; the
 * caller treats that as "not persisted", never as "not configured".
 */
export function saveConfig(
  config: UserConfig,
  storage: ConfigStorage | null = defaultStorage(),
): boolean {
  const result = normalizeConfig(config);
  if (!result.ok) return false;
  if (storage === null) return false;
  try {
    storage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(result.config));
    return true;
  } catch {
    // A quota or permission failure is not worth interrupting a session for.
    return false;
  }
}

/** Forget the stored config. Used by the "start over" control. */
export function clearConfig(storage: ConfigStorage | null = defaultStorage()): void {
  if (storage === null) return;
  try {
    storage.removeItem(CONFIG_STORAGE_KEY);
  } catch {
    // Nothing to do and nothing worth reporting: the config is already gone
    // from the caller's point of view.
  }
}
