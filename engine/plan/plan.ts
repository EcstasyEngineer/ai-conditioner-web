/**
 * The planner — DESIGN.md §3, §4.
 *
 * `plan(corpus, config, opts, seed)` materializes a whole session before a
 * pixel is drawn, and returns either a `SessionPlan` or the list of reasons
 * there is not one. It is pure, synchronous, and deterministic from its
 * arguments: no clock, no `Math.random`, no I/O, no platform.
 *
 * PLANNING AHEAD IS THE ARCHITECTURE'S BIGGEST DEPARTURE from both reference
 * systems, which decide incrementally. It is what the visual medium buys, and
 * it is what makes starvation a HARD PLANNING ERROR rather than a silent skip:
 * conditioner skips one delivery, but hypnoapp is building a 20-minute
 * continuous session and a starving slot cannot be skipped silently 400 times.
 * The engine has the whole session in hand at plan time, so every consent
 * filter that would starve a step is surfaced in the form BEFORE the session
 * begins, never at runtime.
 *
 * THE CONSENT ORDERING IS STRUCTURAL, not a convention. `eligibleEntries` runs
 * ONCE, at the top, and every later stage draws only from what it admitted.
 * Nothing downstream has a widening mechanism, so a consent boundary cannot be
 * crossed by a later stage even in principle — which is the guarantee A7 tests
 * at zero tolerance.
 */

import type { Corpus, CorpusEntry, Person } from '../types/record.ts';
import type { SessionOptions, UserConfig } from '../types/config.ts';
import type { LaneContent, PlanError, SessionPlan, TripletTick } from '../types/plan.ts';
import type { Diagnostic } from '../types/diagnostic.ts';
import type { LaneId, SessionPhase } from '../types/frame.ts';
import { CHANNEL_COUNT } from '../types/frame.ts';
import { DEFAULT_SESSION_OPTIONS, MEAN_DWELL_MS } from '../types/config.ts';

import { blockMembers, eligibleEntries } from './consent.ts';
import { computeBookends, phaseOf } from './bookends.ts';
import { buildThemeWalk } from './themeWalk.ts';
import { intensityAt, round6 } from './titration.ts';
import { dwellAt, laneDrift, lengthForDuration } from './pacing.ts';
import { buildPersonSchedule, neutralPreference } from './person.ts';
import { buildBlocks, drawTriplet, type Block } from './blocks.ts';
import { substream } from '../rng/mulberry32.ts';

/** Options for one planning call, over and above the user's config. */
export interface PlanRequest {
  /**
   * Override the length derived from `targetDurationMs`.
   *
   * Exists for `fixtures/plan.reference.json`, which is authored at length 20
   * and states that override in its own text: a 353-tick file cannot be
   * authored by hand, and generating one and labelling it hand-authored is the
   * circularity the fixture exists to prevent wearing a different hat.
   */
  length?: number;
}

/** `plan` returns one or the other; never a partially-built plan. */
export type PlanResult = SessionPlan | PlanError[];

/** Narrowing helper, so callers read as `if (isPlanFailure(result))`. */
export function isPlanFailure(result: PlanResult): result is PlanError[] {
  return Array.isArray(result);
}

/**
 * Validate the options and the config against the corpus.
 *
 * Deliberately LOUD, and deliberately exhaustive rather than fail-fast:
 * unknown theme names, empty theme sets, and a theme marked both induction and
 * emergence are ALL hard errors, because — in the source's own words — "a phase
 * that silently dropped a bad block name would reintroduce the artifact it
 * exists to prevent."
 *
 * Every error carries a `fix`, because §6.3's reject-don't-repair doctrine
 * requires naming the specific change that makes the config plannable rather
 * than reporting that something was wrong.
 */
function validate(
  corpus: Corpus,
  config: UserConfig,
  options: SessionOptions,
  length: number,
): PlanError[] {
  const errors: PlanError[] = [];
  const { bookends } = options;

  if (options.intensityBell.width <= 0) {
    errors.push({
      kind: 'invalid-options',
      message: `intensity bell width must be > 0, got ${options.intensityBell.width}`,
      fix: 'set options.intensityBell.width to a positive number, e.g. 0.25',
    });
  }
  if (options.intensityBell.peak < 0 || options.intensityBell.peak > 1) {
    errors.push({
      kind: 'invalid-options',
      message: `intensity bell peak must be within [0,1], got ${options.intensityBell.peak}`,
      fix: 'set options.intensityBell.peak between 0 and 1, e.g. 0.5',
    });
  }
  if (options.pacing.dwellBell.width <= 0) {
    errors.push({
      kind: 'invalid-options',
      message: `pacing bell width must be > 0, got ${options.pacing.dwellBell.width}`,
      fix: 'set options.pacing.dwellBell.width to a positive number, e.g. 0.25',
    });
  }
  if (options.pacing.dwellMinMs <= 0 || options.pacing.dwellMaxMs < options.pacing.dwellMinMs) {
    errors.push({
      kind: 'invalid-options',
      message: `pacing dwell band is empty: min ${options.pacing.dwellMinMs}, max ${options.pacing.dwellMaxMs}`,
      fix: 'set options.pacing.dwellMinMs > 0 and dwellMaxMs >= dwellMinMs',
    });
  }

  if (length < 1) {
    errors.push({
      kind: 'duration-too-short',
      message: `targetDurationMs ${config.targetDurationMs} yields a length below 1 step`,
      fix: `ask for at least ${MEAN_DWELL_MS}ms of session`,
    });
  }

  // A theme in both lists is rejected here rather than reconciled: silently
  // preferring one list over the other would make the consent surface depend on
  // an implementation detail of this function.
  for (const theme of config.themes) {
    if (config.excludedThemes.includes(theme)) {
      errors.push({
        kind: 'theme-enrolled-and-excluded',
        message: `theme ${JSON.stringify(theme)} is both enrolled and excluded`,
        fix: `remove ${JSON.stringify(theme)} from one of the two lists`,
        theme,
      });
    }
  }

  if (config.themes.length === 0) {
    errors.push({
      kind: 'no-themes',
      message: 'no themes are enrolled',
      fix: 'select at least one theme on the setup screen',
    });
  }

  // §4.2's silent-drop trap, stated as an error in both directions.
  for (const theme of bookends.inductionThemes) {
    if (bookends.emergenceThemes.includes(theme)) {
      errors.push({
        kind: 'bookend-theme-conflict',
        message: `theme ${JSON.stringify(theme)} is designated both induction and emergence`,
        fix: `remove ${JSON.stringify(theme)} from options.bookends.inductionThemes or emergenceThemes`,
        theme,
      });
    }
  }

  for (const [role, themes] of [
    ['induction', bookends.inductionThemes],
    ['emergence', bookends.emergenceThemes],
  ] as const) {
    for (const theme of themes) {
      if (corpus.byTheme[theme] === undefined) {
        errors.push({
          kind: 'unknown-bookend-theme',
          message: `${role} theme ${JSON.stringify(theme)} is not a theme in the corpus`,
          fix: `remove ${JSON.stringify(theme)} from options.bookends.${role}Themes, or load a corpus that carries it`,
          theme,
        });
      }
    }
  }

  return errors;
}

/**
 * Which enrolled themes are available to the titrating middle.
 *
 * Bookend themes are removed ENTIRELY (§4.2) rather than down-weighted, even
 * when a user enrolled one. This is the structural half of the "Wide awake at
 * line 2" fix: a theme that is absent from the pool cannot be reached by any
 * curve on any seed.
 */
function middleThemesFor(config: UserConfig, options: SessionOptions): string[] {
  const bookendThemes = new Set([
    ...options.bookends.inductionThemes,
    ...options.bookends.emergenceThemes,
  ]);
  return config.themes.filter((theme) => !bookendThemes.has(theme));
}

/**
 * Which person a side lane actually renders, given what the schedule wanted.
 *
 * An `invariant` record reads identically in all three persons, so the schedule
 * is honoured trivially and no `person-unavailable` is recorded — the sidecar
 * has a complete triple for every loaded record, which is exactly what
 * `CorpusEntry` guarantees at the type level. This function exists so that the
 * guarantee is stated in one place rather than assumed at three call sites.
 */
function personFor(entry: CorpusEntry, wanted: Person): Person {
  const variant = entry.persons[wanted];
  return variant.length > 0 ? wanted : 'second';
}

/** Build one lane's content. `text` stays a RAW TEMPLATE (§2.4). */
function laneContent(entry: CorpusEntry, person: Person, split: 'LINE' | 'WORD'): LaneContent {
  return {
    mantraId: entry.record.id,
    person,
    text: entry.persons[person],
    split,
  };
}

/**
 * Reorder a step's three draws so the side lanes prefer the record best suited
 * to the person they are scheduled in.
 *
 * The draw itself is person-blind — the shuffler serves the theme, not the
 * person axis — so without this the scheduled person and the drawn record are
 * independent, and a `named` lane lands on a record whose `named` variant is
 * identical to its `first` variant as often as not. Assigning the three drawn
 * records to the three lanes by fit costs nothing (it is a permutation of what
 * was already drawn, so it cannot reach past consent or repeat a suppressed
 * record) and it is what makes the person schedule legible on screen.
 *
 * `neutralBias` rides here too: at the drift midpoint a side lane prefers an
 * `invariant` record, so the triplet passes through a person-free moment on its
 * way from "I" to "{subject}" (§4.6).
 */
function assignSides(
  draws: readonly CorpusEntry[],
  wanted: { left: Person; right: Person },
  neutral: number,
): { left: CorpusEntry; right: CorpusEntry } {
  const score = (entry: CorpusEntry, person: Person): number => {
    // A record whose requested variant differs from its `first` variant
    // actually EXPRESSES the person axis; one where they match renders the
    // same either way and wastes a scheduled `named`.
    const expresses = entry.persons[person] !== entry.persons.first ? 1 : 0;
    const neutralFit = entry.invariant ? neutral : 0;
    return (person === 'named' ? expresses : 0) + neutralFit;
  };

  const [a, b] = draws;
  const straight = score(a, wanted.left) + score(b, wanted.right);
  const swapped = score(b, wanted.left) + score(a, wanted.right);
  return swapped > straight ? { left: b, right: a } : { left: a, right: b };
}

/**
 * Materialize a session.
 *
 * @param corpus the loaded, validated corpus
 * @param config what the user chose — consent lives here
 * @param opts   engine tuning; every knob is a field, never a module constant
 * @param seed   the plan is byte-identical for a given `(corpus, config, opts, seed)`
 */
export function plan(
  corpus: Corpus,
  config: UserConfig,
  opts: Partial<SessionOptions> = {},
  seed = 0,
  request: PlanRequest = {},
): PlanResult {
  const options: SessionOptions = { ...DEFAULT_SESSION_OPTIONS, ...opts };

  const length =
    request.length ?? Math.max(1, lengthForDuration(config.targetDurationMs, MEAN_DWELL_MS));

  const configErrors = validate(corpus, config, options, length);
  if (configErrors.length > 0) return configErrors;

  // ---- THE CONSENT CHOKEPOINT --------------------------------------------
  //
  // Once, here, before a single candidate is gathered. Everything below draws
  // from `eligible` and nothing below can widen past it.
  const eligible = eligibleEntries(corpus, config);

  const errors: PlanError[] = [];
  const diagnostics: Diagnostic[] = [];

  if (eligible.consented.length === 0) {
    return [
      {
        kind: 'empty-pool',
        message: 'the consent filters left no eligible mantras at all',
        fix:
          config.excludedThemes.length > 0
            ? `drop one of your exclusions (${config.excludedThemes.join(', ')}), or re-enable operator mantras`
            : 'enrol more themes, or re-enable operator mantras',
      },
    ];
  }

  const bookends = computeBookends(length, options.bookends);
  const middleThemes = middleThemesFor(config, options);

  if (middleThemes.length === 0) {
    return [
      {
        kind: 'no-themes',
        message: 'every enrolled theme is designated as a bookend, so the middle has nothing to play',
        fix: 'enrol at least one theme that is not an induction or emergence theme',
      },
    ];
  }

  // ---- bookend servability, checked against the CONSENTED set -------------
  //
  // A bookend theme that exists in the corpus but is emptied by the user's
  // exclusions is `no-induction-content`, not `unknown-bookend-theme`: the two
  // have different fixes, and reporting the wrong one sends a user to change
  // something that is already correct.
  const servable = (theme: string): number => blockMembers(eligible.consented, theme).length;

  if (bookends.head > 0) {
    const total = options.bookends.inductionThemes.reduce((sum, t) => sum + servable(t), 0);
    if (options.bookends.inductionThemes.length === 0 || total < CHANNEL_COUNT) {
      errors.push({
        kind: 'no-induction-content',
        message: `the induction bookend has ${total} eligible mantras, below the ${CHANNEL_COUNT} a triplet needs`,
        fix: 'drop an exclusion that covers the induction theme, or re-enable operator mantras',
      });
    }
  }
  if (bookends.tail > 0) {
    const total = options.bookends.emergenceThemes.reduce((sum, t) => sum + servable(t), 0);
    if (options.bookends.emergenceThemes.length === 0 || total < CHANNEL_COUNT) {
      errors.push({
        kind: 'no-emergence-content',
        message: `the emergence bookend has ${total} eligible mantras, below the ${CHANNEL_COUNT} a triplet needs`,
        fix: 'drop an exclusion that covers the emergence theme, or re-enable operator mantras',
      });
    }
  }

  // ---- every theme that will actually be played must serve a triplet ------
  for (const theme of middleThemes) {
    const count = servable(theme);
    if (count < CHANNEL_COUNT) {
      errors.push({
        kind: 'theme-cannot-serve-triplet',
        message: `theme ${JSON.stringify(theme)} has ${count} eligible mantras, below the ${CHANNEL_COUNT} a triplet needs`,
        fix: `unselect ${JSON.stringify(theme)}, or drop an exclusion that is emptying it`,
        theme,
      });
    }
  }

  if (errors.length > 0) return errors;

  // ---- schedules ----------------------------------------------------------

  const themes = buildThemeWalk({
    length,
    head: bookends.head,
    tail: bookends.tail,
    inductionThemes: options.bookends.inductionThemes,
    emergenceThemes: options.bookends.emergenceThemes,
    middleThemes,
    options: options.themeWalk,
    shufflerOptions: options.shuffler,
    rng: substream(seed, 'themewalk'),
  });

  const persons = buildPersonSchedule(length, options.person, seed);

  // ---- blocks -------------------------------------------------------------
  //
  // One shuffler per theme, shared across all three channels, built once. The
  // head and tail get their own per-channel substreams via the theme name, so
  // the three channels do not echo each other during the bookends (§4.2.3).
  const blocks = buildBlocks({
    themes: [...new Set(themes)],
    membersOf: (theme) => {
      const preferred = blockMembers(eligible.preferred, theme);
      // The blocklist is a PREFERENCE and is relaxed rather than starving. The
      // relax is decided here, per block, and recorded — never silently.
      if (preferred.length >= CHANNEL_COUNT) return preferred;
      const consented = blockMembers(eligible.consented, theme);
      if (consented.length > preferred.length) {
        diagnostics.push({ kind: 'blocklist-relaxed' });
        return consented;
      }
      return preferred;
    },
    relaxableOf: (theme) => blockMembers(eligible.consented, theme),
    options: options.shuffler,
    rngFor: (theme) => substream(seed, `block:${theme}`),
  });

  // A degraded shuffler is the documented exception to A6, so it is reported
  // once per block rather than once per draw.
  for (const block of blocks.values()) {
    if (block.members.length < options.shuffler.degradedBelow) {
      diagnostics.push({
        kind: 'shuffler-degraded',
        theme: block.theme,
        poolSize: block.members.length,
      });
    }
  }

  // ---- ticks --------------------------------------------------------------

  const ticks: TripletTick[] = [];
  let contentMs = 0;

  for (let step = 0; step < length; step += 1) {
    const theme = themes[step];
    const block = blocks.get(theme) as Block;
    const phase: SessionPhase = phaseOf(step, bookends, length);

    const drawn = drawTriplet({ block, step, mode: config.mode, diagnostics });
    if (drawn === undefined) {
      // Unreachable given the servability checks above, which is why it is a
      // typed error rather than a throw: if it ever fires, the check and the
      // draw disagree, and that is worth surfacing as a plan error naming the
      // theme rather than as a stack trace.
      return [
        {
          kind: 'theme-cannot-serve-triplet',
          message: `theme ${JSON.stringify(theme)} could not fill a triplet at step ${step}`,
          fix: `unselect ${JSON.stringify(theme)}, or drop an exclusion that is emptying it`,
          step,
          theme,
        },
      ];
    }

    const intensity = round6(intensityAt(step, length, options.titration, options.intensityBell));
    const dwellMs = dwellAt(step, length, options.pacing);
    contentMs += dwellMs;

    let center: LaneContent;
    let left: LaneContent;
    let right: LaneContent;

    if (config.mode === 'unison') {
      // One mantra, three persons. The center still anchors in `second`.
      const entry = drawn.center.entry;
      center = laneContent(entry, 'second', 'LINE');
      left = laneContent(entry, personFor(entry, persons.left[step]), 'WORD');
      right = laneContent(entry, personFor(entry, persons.right[step]), 'WORD');
    } else {
      const wanted = { left: persons.left[step], right: persons.right[step] };
      const sides = assignSides(
        [drawn.left.entry, drawn.right.entry],
        wanted,
        neutralPreference(persons.pNamed[step], options.person),
      );
      center = laneContent(drawn.center.entry, 'second', 'LINE');
      left = laneContent(sides.left, personFor(sides.left, wanted.left), 'WORD');
      right = laneContent(sides.right, personFor(sides.right, wanted.right), 'WORD');
    }

    ticks.push({ step, theme, intensity, dwellMs, phase, center, left, right });
  }

  return {
    meta: {
      schema: 'hypnoapp.plan.v1',
      seed,
      length,
      head: bookends.head,
      middle: bookends.middle,
      tail: bookends.tail,
      mode: config.mode,
      totalMs: contentMs + options.pacing.tailQuietMs + options.pacing.tailFadeMs,
      contentMs,
      tailQuietMs: options.pacing.tailQuietMs,
      tailFadeMs: options.pacing.tailFadeMs,
      laneOffsetsMs: { ...options.pacing.laneOffsetsMs },
      laneDrift: laneDrift(seed, options.pacing),
      subjectName: config.names.subject,
      operatorName: config.names.operator,
    },
    ticks,
    bed: { ...options.bed },
    diagnostics,
  };
}

/** Lane iteration order used by the planner's own reporting. */
export const PLAN_LANES: readonly LaneId[] = ['center', 'left', 'right'] as const;
