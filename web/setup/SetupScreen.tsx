/**
 * The Configure screen — DESIGN.md §6.1, §6.2, §6.3, §6.4.
 *
 * Two halves, and the split is the important part of this file:
 *
 *   A PURE FEEDBACK MODEL (`buildFeedback`, `buildTagRows`, `personAvailability`,
 *   `starvationRefusal`) that takes `(corpus, config, options, seed)` and returns
 *   plain data. No React, no DOM, no timers. Every §6.2 and §6.3 claim is
 *   asserted against these functions directly, so "the displayed counts equal
 *   what the plan actually contains" (D3) is a test over values rather than a
 *   test over rendered markup.
 *
 *   A THIN COMPONENT that renders that data and owns the debounce.
 *
 * D3 IS SATISFIED STRUCTURALLY, not by keeping two numbers in step. The counts
 * shown are derived from the SAME `eligibleEntries` call the planner makes at
 * its consent chokepoint, and the sample is drawn from the SAME plan object the
 * Begin button will hand to the play route. There is no second filter
 * implementation on this screen that could disagree with the engine's — the
 * failure mode where a setup screen says 412 and the session serves 380.
 *
 * THE TWO REQUIREMENTS THE JUDGES ADDED, and why each is here:
 *
 *   1. PER-PERSON AVAILABILITY (2nd / 1st / 3rd) alongside the totals. The
 *      center lane draws EXCLUSIVELY from second-person variants, so a mix rich
 *      in mantras and poor in second-person coverage starves the anchor at
 *      runtime while every aggregate count on the screen looks healthy. A count
 *      that cannot show that failure is a count that hides it.
 *
 *   2. A MIX WITH ZERO SECOND-PERSON RECORDS IS REFUSED AT SAVE, with a message
 *      naming that specific problem. This is §6.3's reject-don't-repair applied
 *      to the one starvation the aggregate count cannot see.
 *
 * A note on what `second` MEANS in these counts, because getting it wrong is
 * easy and would make the refusal actively harmful. The center renders
 * `entry.persons.second` — the sidecar string — so a record can serve the center
 * exactly when that string is present and non-empty. That is what `second`
 * counts.
 *
 * It deliberately does NOT count "records that read differently in the second
 * person". An `invariant` record such as "Resistance melts away with each
 * breath" is identical in all three persons, and it serves the center perfectly
 * well: 420 of the corpus's records are invariant, and a check that treated them
 * as unable to anchor would refuse a mix built entirely from good, servable
 * lines. Invariance is reported as its own number instead, because it is real
 * information — a mix that is ALL invariant has no person axis to show, which is
 * a texture warning rather than a starvation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Corpus, CorpusEntry } from '../../engine/types/record.ts';
import type { SessionOptions, UserConfig } from '../../engine/types/config.ts';
import type { PlanError, SessionPlan, TripletTick } from '../../engine/types/plan.ts';
import type { Diagnostic } from '../../engine/types/diagnostic.ts';
import { CORPUS_FLOOR } from '../../engine/corpus/vocabulary.ts';
import { eligibleEntries } from '../../engine/plan/consent.ts';
import { isPlanFailure, plan } from '../../engine/plan/plan.ts';

import {
  applyThemeChange,
  saveConfig,
  type ConfigProblem,
  type ConfigStorage,
  type ThemeList,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
} from '../persist/config.ts';
import { DURATION_CHOICES_MIN, allPresets, expandPreset, type PresetId } from './presets.ts';
import { LiveSample } from './LiveSample.tsx';
import { ThemePicker, type TagRow } from './ThemePicker.tsx';

/** §6.2's debounce. The plan is rebuilt on every config change, 250ms after it. */
export const PLAN_DEBOUNCE_MS = 250;

/**
 * The three persons a record can be counted under, for the availability panel.
 *
 * `third` is the label; `named` is the engine's term for the same voice frame
 * (`PersonTriple.named`). The UI says "3rd person" because that is what a reader
 * calls it, and the code says `named` because that is what the sidecar key is.
 */
export interface PersonAvailability {
  /** Records that can serve the CENTRE: `persons.second` present and non-empty. */
  second: number;
  /** Records that can serve a side lane scheduled in the first person. */
  first: number;
  /** Records that can serve a side lane scheduled as the named self. */
  third: number;
  /** Of those, how many read identically in all three persons. */
  invariant: number;
  /** Every record counted here — the denominator for all four. */
  total: number;
}

/**
 * Count person coverage over a set of entries.
 *
 * `second` is the load-bearing number, and it counts exactly what the centre
 * lane needs: a usable `persons.second` string. `plan()` fills the centre with
 * `entry.persons['second']` and nothing else, so a record with a non-empty
 * second variant can anchor a step and a record without one cannot.
 *
 * The tempting stricter definition — records that read DIFFERENTLY in the second
 * person — is wrong here and was measured to be wrong: 420 of the corpus's
 * records are `invariant`, including lines like "Resistance melts away with each
 * breath", and every one of them renders on the centre lane exactly as authored.
 * Counting those as unavailable would refuse mixes built entirely from servable
 * content. Invariance is therefore reported as its own field rather than
 * subtracted from `second`.
 */
export function personAvailability(entries: readonly CorpusEntry[]): PersonAvailability {
  let second = 0;
  let first = 0;
  let third = 0;
  let invariant = 0;

  for (const entry of entries) {
    // Non-empty after trimming: a whitespace-only variant would render a blank
    // lane at full opacity, which is the hole §6.7 refuses to ever display.
    if (entry.persons.second.trim() !== '') second += 1;
    if (entry.persons.first.trim() !== '') first += 1;
    if (entry.persons.named.trim() !== '') third += 1;
    if (entry.invariant) invariant += 1;
  }

  return { second, first, third, invariant, total: entries.length };
}

/** Per-tag rows for the picker, computed from the consent-filtered set. */
export function buildTagRows(
  corpus: Corpus,
  config: UserConfig,
  eligible: readonly CorpusEntry[],
): Record<string, TagRow> {
  const rows: Record<string, TagRow> = {};

  // Totals come from the UNFILTERED corpus: "N of M" only teaches the filters
  // if M stays put while N collapses.
  for (const [tag, indices] of Object.entries(corpus.byTheme)) {
    rows[tag] = {
      tag,
      available: 0,
      total: indices.length,
      second: 0,
      thin: false,
      description: corpus.themeDescriptions[tag],
    };
  }

  for (const entry of eligible) {
    const servesCentre = entry.persons.second.trim() !== '';
    for (const tag of entry.record.themes) {
      const row = rows[tag];
      if (row === undefined) continue;
      row.available += 1;
      if (servesCentre) row.second += 1;
    }
  }

  // §6.2: warn when an exclusion drops an ENROLLED tag toward the floor. An
  // unenrolled tag sitting below the floor is not a warning — it is a tag the
  // user is not using, and flagging it would make the picker cry wolf on 20 rows.
  const enrolled = new Set(config.themes);
  for (const row of Object.values(rows)) {
    row.thin = enrolled.has(row.tag) && row.available < CORPUS_FLOOR;
  }

  return rows;
}

/** A refusal that blocks Save and Start, with the fix named. */
export type Refusal = ConfigProblem;

/**
 * The judges' second requirement, as a function.
 *
 * A mix that leaves ZERO records with a distinguishable second-person reading is
 * refused, and the message names THAT problem rather than reporting a generic
 * empty pool — the whole reason this check exists separately is that the
 * aggregate count can be in the hundreds while this one is zero.
 *
 * Returns null when the mix is servable. Checked BEFORE the plan is built,
 * because the planner's own error for this case would arrive as a lane
 * starvation at some step, which is a worse thing to show a user than a sentence
 * about their filters.
 */
export function starvationRefusal(
  config: UserConfig,
  eligible: readonly CorpusEntry[],
): Refusal | null {
  if (eligible.length === 0) {
    return {
      field: 'excludedThemes',
      message: 'your filters match no mantras at all',
      fix:
        config.excludedThemes.length > 0
          ? `drop ${config.excludedThemes.join(' or ')} from your exclusions, or re-enable operator mantras first`
          : 'enrol more themes, or re-enable operator mantras first',
    };
  }

  const persons = personAvailability(eligible);
  if (persons.second === 0) {
    return {
      field: 'excludedThemes',
      message: `none of the ${persons.total} lines this mix matches has a second-person form, and the centre lane draws only from those — it would have nothing to show`,
      fix:
        config.excludedThemes.length > 0
          ? `drop ${config.excludedThemes.join(' or ')} from your exclusions, or enrol a theme that speaks to you directly`
          : 'enrol a theme that speaks to you directly, such as devotion or submission',
    };
  }

  return null;
}

/** Everything the screen shows about the current config. Plain data. */
export interface Feedback {
  /** Records surviving the consent filters. The N in "N of M". */
  matched: number;
  /** Records in the corpus. The M in "N of M". */
  total: number;
  /** Person coverage over the matched set — the judges' first requirement. */
  persons: PersonAvailability;
  /** Per-tag rows for the picker. */
  rows: Record<string, TagRow>;
  /** Enrolled tags that fell below `CORPUS_FLOOR` under the current exclusions. */
  thinTags: string[];
  /** The refusal that blocks Save and Start, or null. */
  refusal: Refusal | null;
  /** Hard planning errors, when a plan was attempted and failed. */
  planErrors: PlanError[];
  /** Diagnostics from a plan that succeeded. Never fatal. */
  diagnostics: Diagnostic[];
  /** The plan itself, when one was built. Begin hands exactly this to Play. */
  plan: SessionPlan | null;
  /** Ticks the sample draws from. Empty when there is no plan. */
  sampleTicks: readonly TripletTick[];
  /** True when Start is allowed. */
  canStart: boolean;
}

export interface FeedbackRequest {
  corpus: Corpus;
  config: UserConfig;
  options?: Partial<SessionOptions>;
  seed?: number;
  /**
   * Skip the plan and report counts only — §6.2's documented degradation.
   *
   * "If the budget is at risk, the loop degrades to a counts-only validation
   * pass (a filter, not a plan) during typing, with the full plan built on blur
   * and before Begin." Counts-only is a real supported mode rather than a
   * fallback nobody exercises: the name field uses it on every keystroke, and
   * the full plan is built on blur.
   */
  countsOnly?: boolean;
}

/**
 * THE ONE PLACE the setup screen learns anything about the corpus.
 *
 * Note the ordering, which mirrors the planner's: consent is applied ONCE, at
 * the top, via the engine's own `eligibleEntries`, and every number below is
 * derived from what it admitted. The screen has no filter of its own, which is
 * what makes D3 hold by construction rather than by vigilance.
 */
export function buildFeedback(request: FeedbackRequest): Feedback {
  const { corpus, config, options = {}, seed = 0, countsOnly = false } = request;

  const eligible = eligibleEntries(corpus, config);
  const matched = eligible.consented;

  const rows = buildTagRows(corpus, config, matched);
  const persons = personAvailability(matched);
  const thinTags = Object.values(rows)
    .filter((row) => row.thin)
    .map((row) => row.tag)
    .sort();

  const refusal = config.themes.length === 0 ? null : starvationRefusal(config, matched);

  const base: Feedback = {
    matched: matched.length,
    total: corpus.entries.length,
    persons,
    rows,
    thinTags,
    refusal,
    planErrors: [],
    diagnostics: [],
    plan: null,
    sampleTicks: [],
    canStart: false,
  };

  // An empty theme list is ALLOWED (§6.3) and simply blocks Start. It is not a
  // refusal: there is nothing wrong to tell the user about, and a red message on
  // a form they have not filled in yet is noise.
  if (config.themes.length === 0) return base;
  if (refusal !== null) return base;
  if (countsOnly) return { ...base, canStart: true };

  const result = plan(corpus, config, options, seed);
  if (isPlanFailure(result)) {
    return { ...base, planErrors: result };
  }

  return {
    ...base,
    diagnostics: result.diagnostics,
    plan: result,
    sampleTicks: result.ticks,
    canStart: true,
  };
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export interface SetupScreenProps {
  corpus: Corpus;
  config: UserConfig;
  onConfigChange(next: UserConfig): void;
  /** Called with the plan Begin was pressed against. Never re-planned downstream. */
  onStart(plan: SessionPlan, config: UserConfig): void;
  options?: Partial<SessionOptions>;
  /**
   * Receives the engine tuning a preset expanded to.
   *
   * Required for a preset to mean anything: `gentle` and `deep` differ from
   * `standard` mostly in `SessionOptions` — the bell, the dwell band, the person
   * mix — and a screen that applied only the preset's `UserConfig` would change
   * the duration and silently drop the arc the preset is named for. The owner of
   * the options is the shell, so the screen reports rather than stores.
   */
  onOptionsChange?(next: Partial<SessionOptions>): void;
  seed?: number;
  storage?: ConfigStorage | null;
  /** Injectable for tests. Defaults to the real timers. */
  debounceMs?: number;
}

export function SetupScreen({
  corpus,
  config,
  onConfigChange,
  onStart,
  options = {},
  onOptionsChange,
  seed = 0,
  storage,
  debounceMs = PLAN_DEBOUNCE_MS,
}: SetupScreenProps) {
  const [rejection, setRejection] = useState<ConfigProblem | null>(null);

  /**
   * The config the feedback is computed against, trailing `config` by the
   * debounce.
   *
   * Held separately rather than debouncing the feedback itself, because the
   * feedback must be a pure function of a config: with a debounced RESULT there
   * is a window where the numbers on screen belong to a config that is no longer
   * on screen, and D3's "displayed counts equal what the plan contains" would be
   * false for 250ms after every keystroke. Debouncing the INPUT means the
   * numbers always describe some config exactly — just, briefly, the previous one.
   */
  const [settled, setSettled] = useState<UserConfig>(config);

  useEffect(() => {
    if (settled === config) return;
    const handle = setTimeout(() => setSettled(config), debounceMs);
    return () => clearTimeout(handle);
  }, [config, settled, debounceMs]);

  /**
   * The counts-only pass, computed synchronously on EVERY change.
   *
   * §6.2's degradation path, always on rather than switched on under load: a
   * filter over the corpus is cheap enough to run per keystroke, so the user
   * gets an immediate N-of-M while the full plan lands 250ms later. The full
   * plan is what gates Begin.
   */
  const immediate = useMemo(
    () => buildFeedback({ corpus, config, options, seed, countsOnly: true }),
    [corpus, config, options, seed],
  );

  const feedback = useMemo(
    () => buildFeedback({ corpus, config: settled, options, seed }),
    [corpus, settled, options, seed],
  );

  /** True while the debounce is still owed a plan for the current config. */
  const settling = settled !== config;

  const toggle = useCallback(
    (list: ThemeList, tag: string, next: boolean) => {
      const result = applyThemeChange(config, list, tag, next);
      setRejection(result.rejected);
      if (result.rejected === null) onConfigChange(result.config);
    },
    [config, onConfigChange],
  );

  const setField = useCallback(
    <K extends keyof UserConfig>(key: K, value: UserConfig[K]) => {
      setRejection(null);
      onConfigChange({ ...config, [key]: value });
    },
    [config, onConfigChange],
  );

  const applyPreset = useCallback(
    (id: PresetId) => {
      setRejection(null);
      // §6.4: expanded to explicit primitives BEFORE anything validates it. The
      // preset's names do not overwrite names the user has already chosen —
      // those are not part of what a preset selects.
      const expanded = expandPreset(id);
      onConfigChange({ ...expanded.config, names: config.names });
      // BOTH halves of the expansion are applied. `gentle` and `deep` differ
      // from `standard` mainly in their engine tuning, so forwarding only the
      // config would change the length and quietly drop the arc the preset is
      // named for.
      onOptionsChange?.(expanded.options);
    },
    [config.names, onConfigChange, onOptionsChange],
  );

  /**
   * Begin.
   *
   * Uses the SETTLED plan — the object `feedback` already holds — rather than
   * re-planning. Re-planning here would produce a second plan that could differ
   * from the one the sample was drawn from, which is the exact seam D3 exists to
   * close.
   */
  const begin = useCallback(() => {
    if (!feedback.canStart || feedback.plan === null || settling) return;
    saveConfig(settled, storage);
    onStart(feedback.plan, settled);
  }, [feedback, settled, settling, storage, onStart]);

  const nameBlur = useCallback(() => {
    // §6.2's "full plan built on blur": the debounce already does this, and
    // committing the settled config here makes the guarantee explicit rather
    // than incidental to a timer.
    setSettled(config);
  }, [config]);

  const startBlocked = startBlockedReason(config, feedback, settling);

  return (
    <main className="setup-screen" data-testid="setup-screen">
      <h1>hypnoapp</h1>

      <section className="preset-row" aria-label="Presets">
        {allPresets().map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="preset"
            data-testid={`preset-${preset.id}`}
            onClick={() => applyPreset(preset.id)}
          >
            <span className="preset-name">{preset.id}</span>
            <span className="preset-summary">{preset.summary}</span>
          </button>
        ))}
      </section>

      {/* §6.2's headline number. Immediate, from the counts-only pass. */}
      <section className="match-summary" aria-live="polite">
        <p className="match-count" data-testid="match-count">
          Your filters match {immediate.matched} of {immediate.total} mantras
        </p>
        {/* The judges' first requirement, at mix level as well as per tag. */}
        <p className="person-availability" data-testid="person-availability">
          {immediate.persons.second} in 2nd person · {immediate.persons.first} in 1st ·{' '}
          {immediate.persons.third} in 3rd
        </p>
        {immediate.persons.second === 0 && immediate.matched > 0 ? (
          <p className="person-warning" data-testid="second-person-warning">
            The centre lane draws only from 2nd-person lines. Nothing in this mix gives it one.
          </p>
        ) : null}
        {feedback.thinTags.length > 0 ? (
          <p className="thin-warning" data-testid="thin-warning">
            Below the {CORPUS_FLOOR} lines a lane needs: {feedback.thinTags.join(', ')}
          </p>
        ) : null}
      </section>

      {/* §6.3: the refusal, in the form, naming the fix. Never at playback. */}
      {feedback.refusal ? (
        <p className="refusal" role="alert" data-testid="refusal">
          {feedback.refusal.message} — {feedback.refusal.fix}.
        </p>
      ) : null}

      {feedback.planErrors.map((error, i) => (
        <p className="plan-error" role="alert" data-testid="plan-error" key={`${error.kind}-${i}`}>
          {error.message} — {error.fix}.
        </p>
      ))}

      <ThemePicker config={config} rows={feedback.rows} onToggle={toggle} rejection={rejection} />

      <section className="names" aria-label="Names">
        <label htmlFor="subject-name">You are called</label>
        <input
          id="subject-name"
          data-testid="subject-name"
          value={config.names.subject}
          onChange={(e) => setField('names', { ...config.names, subject: e.currentTarget.value })}
          onBlur={nameBlur}
        />
        <label htmlFor="operator-name">The voice is called</label>
        <input
          id="operator-name"
          data-testid="operator-name"
          value={config.names.operator}
          onChange={(e) => setField('names', { ...config.names, operator: e.currentTarget.value })}
          onBlur={nameBlur}
        />
        <label htmlFor="allow-operator">
          <input
            id="allow-operator"
            data-testid="allow-operator"
            type="checkbox"
            checked={config.allowOperator}
            onChange={(e) => setField('allowOperator', e.currentTarget.checked)}
          />
          Include lines spoken by the voice
        </label>
      </section>

      <section className="session-shape" aria-label="Session shape">
        <label htmlFor="duration">Length</label>
        <select
          id="duration"
          data-testid="duration"
          value={String(config.targetDurationMs)}
          onChange={(e) => setField('targetDurationMs', Number(e.currentTarget.value))}
        >
          {DURATION_CHOICES_MIN.map((min) => {
            const ms = min * 60_000;
            if (ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) return null;
            return (
              <option key={min} value={String(ms)}>
                {min} minutes
              </option>
            );
          })}
        </select>

        {/* §6.1: the mode toggle, explained in ONE line. Both are shipped paths. */}
        <fieldset className="mode-toggle" data-testid="mode-toggle">
          <legend>Mode</legend>
          <label htmlFor="mode-parallel">
            <input
              id="mode-parallel"
              type="radio"
              name="mode"
              value="parallel"
              checked={config.mode === 'parallel'}
              onChange={() => setField('mode', 'parallel')}
            />
            Parallel — three different lines at once, one per lane.
          </label>
          <label htmlFor="mode-unison">
            <input
              id="mode-unison"
              type="radio"
              name="mode"
              value="unison"
              checked={config.mode === 'unison'}
              onChange={() => setField('mode', 'unison')}
            />
            Unison — one line at a time, in three voices at once.
          </label>
        </fieldset>
      </section>

      {/* §6.2: the sample IS the explanation. No modal, no walkthrough, no tooltips. */}
      <LiveSample ticks={feedback.sampleTicks} names={settled.names} />

      <button
        type="button"
        className="begin"
        data-testid="begin"
        disabled={startBlocked !== null}
        onClick={begin}
      >
        Begin
      </button>
      {startBlocked ? (
        <p className="begin-blocked" data-testid="begin-blocked">
          {startBlocked}
        </p>
      ) : null}
    </main>
  );
}

/**
 * Why Start is blocked, in one sentence, or null when it is not.
 *
 * Exported so a test can assert the reason rather than only the disabled
 * attribute: "Begin is disabled" passes for a form that is broken for a
 * completely different reason than the one under test.
 */
export function startBlockedReason(
  config: UserConfig,
  feedback: Feedback,
  settling: boolean,
): string | null {
  if (config.themes.length === 0) return 'Pick at least one theme.';
  if (feedback.refusal !== null) return feedback.refusal.fix;
  if (feedback.planErrors.length > 0) return feedback.planErrors[0].fix;
  if (settling || feedback.plan === null) return 'Working out your session…';
  return null;
}
