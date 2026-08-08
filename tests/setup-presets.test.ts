/**
 * M7 — presets (§6.4) and config persistence (§6.1, §6.3).
 *
 * The claim under test for presets is narrow and worth stating precisely:
 * a preset EXPANDS TO EXPLICIT PRIMITIVES BEFORE VALIDATION, so it cannot carry
 * hidden behavior. Concretely that means every value a preset sets is a field a
 * user could have set on the form, and the expanded config passes the same
 * normalizer a hand-built one does. A preset that could produce a config the
 * form cannot express would be a private path into the engine.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { UserConfig } from '../engine/types/config.ts';
import { DEFAULT_SESSION_OPTIONS } from '../engine/types/config.ts';
import { isEnrollable } from '../engine/corpus/vocabulary.ts';
import { isLoadFailure, loadCorpus } from '../engine/corpus/load.ts';
import { isPlanFailure, plan } from '../engine/plan/plan.ts';

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) as unknown;

import {
  DURATION_CHOICES_MIN,
  PRESET_IDS,
  allPresets,
  expandPreset,
  isPresetId,
  tryExpandPreset,
} from '../web/setup/presets.ts';
import {
  CONFIG_STORAGE_KEY,
  MAX_DURATION_MS,
  MIN_DURATION_MS,
  clearConfig,
  defaultConfig,
  loadConfig,
  normalizeConfig,
  saveConfig,
  type ConfigStorage,
} from '../web/persist/config.ts';

/** An in-memory `localStorage`. Nothing here should touch a real browser store. */
class MemoryStorage implements ConfigStorage {
  readonly map = new Map<string, string>();
  /** Set to make every write throw, as a quota-exceeded store does. */
  failWrites = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('§6.4 — three presets ship, and an unknown one is a hard error', () => {
  it('ships exactly standard, gentle and deep', () => {
    expect([...PRESET_IDS]).toEqual(['standard', 'gentle', 'deep']);
  });

  it('throws on an unknown preset rather than falling back to standard', () => {
    // A typo'd preset that quietly plays a different session is the failure.
    expect(() => expandPreset('gentel')).toThrow(/unknown preset/);
    expect(() => expandPreset('')).toThrow(/unknown preset/);
    expect(tryExpandPreset('gentel')).toBeNull();
    expect(isPresetId('gentel')).toBe(false);
  });

  it('names the presets that do exist in the error', () => {
    expect(() => expandPreset('nope')).toThrow(/standard, gentle, deep/);
  });
});

describe('§6.4 — a preset expands to explicit primitives before validation', () => {
  it('every preset produces a config that passes the SAME normalizer', () => {
    for (const preset of allPresets()) {
      const result = normalizeConfig(preset.config);
      expect(result.ok, `${preset.id} did not normalize`).toBe(true);
    }
  });

  it('every field a preset sets is a field the form exposes', () => {
    for (const preset of allPresets()) {
      const { config } = preset;
      // Themes are all enrollable — a preset cannot enrol an exclusion-only tag.
      expect(config.themes.every(isEnrollable)).toBe(true);
      // Duration is inside the form's range and is one of its choices.
      expect(config.targetDurationMs).toBeGreaterThanOrEqual(MIN_DURATION_MS);
      expect(config.targetDurationMs).toBeLessThanOrEqual(MAX_DURATION_MS);
      expect(DURATION_CHOICES_MIN.map((m) => m * 60_000)).toContain(config.targetDurationMs);
      // Mode is one of the two the toggle offers.
      expect(['parallel', 'unison']).toContain(config.mode);
      // No preset arrives pre-loaded with exclusions or a blocklist.
      expect(config.excludedThemes).toEqual([]);
      expect(config.blocklist).toEqual([]);
    }
  });

  it('every option a preset overrides is a known SessionOptions key', () => {
    const known = new Set(Object.keys(DEFAULT_SESSION_OPTIONS));
    for (const preset of allPresets()) {
      for (const key of Object.keys(preset.options)) {
        expect(known, `${preset.id} set an unknown option ${key}`).toContain(key);
      }
    }
  });

  it('standard overrides nothing — it is the shipped default, nameable', () => {
    expect(expandPreset('standard').options).toEqual({});
  });

  it('gentle and deep differ from standard in stated ways', () => {
    const gentle = expandPreset('gentle');
    const deep = expandPreset('deep');

    // Gentle: shorter, shallower, slower.
    expect(gentle.config.targetDurationMs).toBeLessThan(
      expandPreset('standard').config.targetDurationMs,
    );
    expect(gentle.options.pacing!.dwellMinMs).toBeGreaterThan(
      DEFAULT_SESSION_OPTIONS.pacing.dwellMinMs,
    );
    expect(gentle.options.person!.peakMix).toBeLessThan(DEFAULT_SESSION_OPTIONS.person.peakMix);

    // Deep: longer, wider, tighter.
    expect(deep.config.targetDurationMs).toBeGreaterThan(
      expandPreset('standard').config.targetDurationMs,
    );
    expect(deep.options.intensityBell!.width).toBeGreaterThan(
      DEFAULT_SESSION_OPTIONS.intensityBell.width,
    );
    expect(deep.options.pacing!.dwellMinMs).toBeLessThan(
      DEFAULT_SESSION_OPTIONS.pacing.dwellMinMs,
    );
  });

  it('a preset’s options actually change the session it plans', () => {
    // The regression: forwarding only `expanded.config` and dropping
    // `expanded.options` leaves `gentle` and `deep` as duration changes wearing
    // the name of an arc. The plans must differ in more than length.
    const corpusResult = loadCorpus(
      readJson('corpus/pool.json'),
      readJson('corpus/persons.json'),
      readJson('corpus/provenance.json'),
    );
    if (isLoadFailure(corpusResult)) throw new Error('corpus failed to load');

    const gentle = expandPreset('gentle');
    const standard = expandPreset('standard');

    // Same length for both, so the ONLY difference under test is the tuning.
    const atLength = { length: 120 };
    const withOptions = plan(corpusResult, gentle.config, gentle.options, 7, atLength);
    const withoutOptions = plan(corpusResult, gentle.config, standard.options, 7, atLength);
    if (isPlanFailure(withOptions) || isPlanFailure(withoutOptions)) {
      throw new Error('a preset failed to plan');
    }

    const dwellsWith = withOptions.ticks.map((t) => t.dwellMs);
    const dwellsWithout = withoutOptions.ticks.map((t) => t.dwellMs);
    expect(dwellsWith).not.toEqual(dwellsWithout);
    // Gentle's floor really is slower everywhere.
    expect(Math.min(...dwellsWith)).toBeGreaterThan(Math.min(...dwellsWithout));
  });

  it('names no deleted intensity concept — there is no tier or cap to set', () => {
    const serialized = JSON.stringify(allPresets());
    for (const dead of ['tier', 'base_points', 'intensityCap', 'targetTier']) {
      expect(serialized).not.toContain(dead);
    }
  });

  it('expansion is fresh each call and shares nothing with the frozen defaults', () => {
    const a = expandPreset('deep');
    const b = expandPreset('deep');
    expect(a.config).not.toBe(b.config);
    a.config.themes.push('worship');
    expect(b.config.themes).not.toContain('worship');
    // And the frozen default is untouched by that mutation.
    expect(DEFAULT_SESSION_OPTIONS.person.peakMix).toBe(0.85);
  });
});

describe('persistence — storage is untrusted input', () => {
  it('round-trips a valid config', () => {
    const storage = new MemoryStorage();
    const config = defaultConfig();
    expect(saveConfig(config, storage)).toBe(true);
    expect(loadConfig(storage)).toEqual({ config, stale: false });
  });

  it('falls back to the default for absent storage', () => {
    expect(loadConfig(new MemoryStorage())).toEqual({ config: defaultConfig(), stale: false });
    expect(loadConfig(null)).toEqual({ config: defaultConfig(), stale: false });
  });

  it('discards unparseable storage rather than throwing', () => {
    const storage = new MemoryStorage();
    storage.map.set(CONFIG_STORAGE_KEY, '{not json');
    const result = loadConfig(storage);
    expect(result.config).toEqual(defaultConfig());
    expect(result.stale).toBe(true);
  });

  it('discards a config that no longer validates, whole', () => {
    const storage = new MemoryStorage();
    // A config from a previous vocabulary: `sluttiness` is not a tag any more.
    storage.map.set(
      CONFIG_STORAGE_KEY,
      JSON.stringify({ ...defaultConfig(), themes: ['sluttiness'] }),
    );
    const result = loadConfig(storage);
    // Repaired by DISCARDING, never by patching: a partially-valid stored
    // config must not be able to become a session.
    expect(result.config).toEqual(defaultConfig());
    expect(result.stale).toBe(true);
  });

  it('refuses to store a config that would not load back', () => {
    const storage = new MemoryStorage();
    const broken = { ...defaultConfig(), targetDurationMs: 10 } as UserConfig;
    expect(saveConfig(broken, storage)).toBe(false);
    expect(storage.map.size).toBe(0);
  });

  it('survives a storage that throws on write', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(saveConfig(defaultConfig(), storage)).toBe(false);
  });

  it('clears', () => {
    const storage = new MemoryStorage();
    saveConfig(defaultConfig(), storage);
    clearConfig(storage);
    expect(storage.map.size).toBe(0);
  });
});

describe('normalization — reject, do not repair', () => {
  it('reports every problem at once rather than the first', () => {
    const result = normalizeConfig({
      themes: ['focus'],
      excludedThemes: ['focus'],
      allowOperator: 'yes',
      names: { subject: '', operator: '' },
      targetDurationMs: 10,
      mode: 'chorus',
      blocklist: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.problems.map((p) => p.field);
      expect(fields).toContain('themes');
      expect(fields).toContain('allowOperator');
      expect(fields).toContain('names.subject');
      expect(fields).toContain('names.operator');
      expect(fields).toContain('targetDurationMs');
      expect(fields).toContain('mode');
      // Every problem names a fix — §6.3 makes that a required field.
      for (const p of result.problems) expect(p.fix.trim().length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown tag rather than silently dropping it', () => {
    // Dropping would hand the user a session filtered by FEWER exclusions than
    // they set — the one direction a consent surface may never fail in.
    const result = normalizeConfig({ ...defaultConfig(), excludedThemes: ['not_a_tag'] });
    expect(result.ok).toBe(false);
  });

  it('rejects an exclusion-only tag in the enrolled list', () => {
    expect(normalizeConfig({ ...defaultConfig(), themes: ['explicit'] }).ok).toBe(false);
  });

  it('accepts an exclusion-only tag in the excluded list', () => {
    expect(normalizeConfig({ ...defaultConfig(), excludedThemes: ['explicit'] }).ok).toBe(true);
  });

  it('trims names but refuses empty ones', () => {
    const trimmed = normalizeConfig({
      ...defaultConfig(),
      names: { subject: '  Alex  ', operator: ' Morgan ' },
    });
    expect(trimmed.ok).toBe(true);
    if (trimmed.ok) expect(trimmed.config.names).toEqual({ subject: 'Alex', operator: 'Morgan' });

    expect(normalizeConfig({ ...defaultConfig(), names: { subject: '   ', operator: 'M' } }).ok).toBe(
      false,
    );
  });

  it('deduplicates lists — the one change that alters no meaning', () => {
    const result = normalizeConfig({ ...defaultConfig(), themes: ['focus', 'focus', 'worship'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.themes).toEqual(['focus', 'worship']);
  });

  it('rejects a non-object outright', () => {
    for (const value of [null, undefined, 42, 'config', []]) {
      expect(normalizeConfig(value).ok).toBe(false);
    }
  });
});
