/**
 * Placeholder substitution — DESIGN.md §2.4, criterion C6.
 *
 * Three things are being defended, and each one is a port of a measured failure
 * rather than a hypothetical:
 *
 *   C6, never throws. `_safe_format` in conditioner falls back to the raw
 *   template on any error. This is property-tested against malformed input
 *   rather than spot-checked, because the failure mode is a crash MID-SESSION
 *   on one unlucky record out of thousands.
 *
 *   Format specs are REJECTED, not merely unknown. `{subject:>4096}` passes a
 *   naive probe and then blows past output limits.
 *
 *   Exactly two placeholders, bare form. `{subject_subjective}` and
 *   `[verb|verbs]` are Phase B intermediates and must never reach runtime.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLACEHOLDERS,
  capitalizeFirst,
  isSubstitutable,
  substitute,
} from '../engine/render/substitute.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = { subject: 'Alex', operator: 'Morgan' };

describe('substitute', () => {
  it('replaces both placeholders', () => {
    expect(substitute('{subject} obeys {operator}', names)).toBe('Alex obeys Morgan');
    expect(substitute('You obey {operator} before you know you have', names)).toBe(
      'You obey Morgan before you know you have',
    );
  });

  it('replaces every occurrence, not just the first', () => {
    expect(substitute('{subject} obeys the way {subject} breathes', names)).toBe(
      'Alex obeys the way Alex breathes',
    );
  });

  it('leaves a template with no placeholders untouched but for capitalization', () => {
    expect(substitute('The command is finished before it is heard', names)).toBe(
      'The command is finished before it is heard',
    );
  });

  it('supports exactly two placeholders and no others', () => {
    expect(PLACEHOLDERS).toEqual(['subject', 'operator']);
  });
});

describe('capitalization — mantras.py:159-161', () => {
  it('capitalizes the first letter when it is lowercase', () => {
    expect(substitute('you obey', names)).toBe('You obey');
    expect(capitalizeFirst('sinking')).toBe('Sinking');
  });

  it('leaves an already-capitalized first letter alone', () => {
    expect(capitalizeFirst('You obey')).toBe('You obey');
  });

  it('does not override the casing of a name the user chose', () => {
    // Only `if formatted[0].islower()`. A template opening on a placeholder
    // renders a name whose casing belongs to the user.
    expect(substitute('{subject} obeys', { subject: 'eevee', operator: 'Morgan' })).toBe(
      'Eevee obeys',
    );
    expect(substitute('{subject} obeys', { subject: 'McKay', operator: 'Morgan' })).toBe(
      'McKay obeys',
    );
  });

  it('leaves a non-letter opening character alone', () => {
    expect(capitalizeFirst('7 breaths')).toBe('7 breaths');
    expect(capitalizeFirst('')).toBe('');
  });
});

describe('format specs and conversions are REJECTED, not just unknown', () => {
  it('refuses a format spec and renders nothing padded', () => {
    const out = substitute('{subject:>4096}', names);
    expect(out).toBe('{subject:>4096}');
    expect(out.length).toBeLessThan(64);
    expect(out).not.toContain('Alex');
  });

  it('refuses a conversion', () => {
    expect(substitute('{subject!r} obeys', names)).toBe('{subject!r} obeys');
  });

  it('refuses an index or an empty field', () => {
    expect(substitute('{0} obeys', names)).toBe('{0} obeys');
    expect(substitute('{} obeys', names)).toBe('{} obeys');
  });

  it('refuses the renamed placeholder rather than silently dropping it', () => {
    // {controller} was renamed to {operator}. A template still carrying it must
    // show its brackets, not vanish the word.
    expect(substitute('You obey {controller}', names)).toBe('You obey {controller}');
  });

  it('refuses the Phase B intermediate grammar', () => {
    expect(substitute('{subject_subjective} obeys', names)).toBe('{subject_subjective} obeys');
    // [verb|verbs] is not brace grammar at all: it survives verbatim, which is
    // what makes it findable by the corpus lint rather than invisible.
    expect(substitute('{subject} [obey|obeys]', names)).toBe('Alex [obey|obeys]');
  });

  it('refuses unbalanced and nested braces', () => {
    for (const bad of ['{subject', 'subject}', '{{subject}}', '{{subject}', '}{']) {
      expect(isSubstitutable(bad), bad).toBe(false);
      expect(substitute(bad, names), bad).toBe(bad);
    }
  });

  it('accepts exactly the bare forms', () => {
    expect(isSubstitutable('{subject} and {operator}')).toBe(true);
    expect(isSubstitutable('no placeholders here')).toBe(true);
    expect(isSubstitutable('{subject:>4096}')).toBe(false);
  });
});

describe('C6 substitution never throws', () => {
  it('falls back to the raw template on a name it cannot use', () => {
    const long = 'x'.repeat(5000);
    expect(substitute('{subject} obeys', { subject: long, operator: 'Morgan' })).toBe(
      '{subject} obeys',
    );
    expect(substitute('{subject} obeys', { subject: '', operator: 'Morgan' })).toBe(
      '{subject} obeys',
    );
    // A name carrying a brace would re-enter the grammar on a second pass.
    expect(substitute('{subject} obeys', { subject: '{operator}', operator: 'Morgan' })).toBe(
      '{subject} obeys',
    );
    expect(substitute('{subject} obeys', { subject: 'A\nB', operator: 'Morgan' })).toBe(
      '{subject} obeys',
    );
  });

  it('survives a missing or malformed names object', () => {
    const cases: unknown[] = [null, undefined, {}, { subject: 'Alex' }, { subject: 5, operator: 7 }, []];
    for (const bad of cases) {
      expect(() => substitute('{subject} obeys', bad as never)).not.toThrow();
      expect(substitute('{subject} obeys', bad as never)).toBe('{subject} obeys');
    }
  });

  it('survives a non-string template', () => {
    for (const bad of [null, undefined, 5, {}, []]) {
      expect(() => substitute(bad as never, names)).not.toThrow();
      expect(substitute(bad as never, names)).toBe('');
    }
  });

  it('property test: never throws and never grows unboundedly over generated malformed input', () => {
    // A deterministic generator, not Math.random: a property test that cannot be
    // replayed is an anecdote. The alphabet is exactly the characters that make
    // the grammar ambiguous.
    const atoms = [
      '{', '}', '{subject', 'subject}', '{subject}', '{operator}', '{controller}',
      '{subject:>4096}', '{subject!r}', '{0}', '{}', '{{', '}}', ':', '!', '|',
      '[verb|verbs]', '[500]', 'obeys', ' ', '\\', '$&', "'", '\u0000', '\uD83D',
    ];

    let state = 47;
    const next = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state;
    };

    for (let i = 0; i < 4000; i += 1) {
      let template = '';
      const parts = 1 + (next() % 8);
      for (let p = 0; p < parts; p += 1) template += atoms[next() % atoms.length];

      let out = '';
      expect(() => {
        out = substitute(template, names);
      }, template).not.toThrow();

      expect(typeof out, template).toBe('string');
      // The template-or-substitution guarantee: output is either the raw
      // template or a bounded expansion of it. 64 is MAX_NAME_LENGTH, and no
      // template can carry more placeholders than it has characters.
      expect(out.length, template).toBeLessThanOrEqual(template.length * 64 + 1);
    }
  });

  it('never throws on any real corpus record', () => {
    const pool = JSON.parse(
      readFileSync(path.join(repoRoot, 'corpus', 'pool.json'), 'utf8'),
    ) as { mantras: { id: string; text: string }[] };

    expect(pool.mantras.length).toBeGreaterThan(0);
    for (const record of pool.mantras) {
      expect(() => substitute(record.text, names), record.id).not.toThrow();
    }
  });

  it('leaves no placeholder unrendered on any real corpus record', () => {
    // The corpus half of the same claim: every record in the shipping pool uses
    // the bare grammar, so nothing reaches a user wearing its brackets.
    const pool = JSON.parse(
      readFileSync(path.join(repoRoot, 'corpus', 'pool.json'), 'utf8'),
    ) as { mantras: { id: string; text: string }[] };

    const unrendered = pool.mantras.filter((r) => /[{}]/.test(substitute(r.text, names)));
    expect(unrendered.map((r) => r.id)).toEqual([]);
  });
});
