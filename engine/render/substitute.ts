/**
 * Placeholder substitution — DESIGN.md §2.4.
 *
 * Ported from `conditioner/utils/mantras.py:153-162`: substitute
 * `{subject}` / `{operator}`, then capitalize the first letter if lowercase.
 * Substitution happens at DISPLAY TIME, never at selection or storage time
 * (§2.4), so renaming an operator retroactively re-renders content already in
 * flight — the raw template is what the plan carries.
 *
 * Two hardening rules are carried deliberately, and both are ports of measured
 * failures rather than defensive habit:
 *
 *   FORMAT SPECS AND CONVERSIONS ARE REJECTED, not merely unknown
 *   (`conditioner/utils/custom_mantras.py:92-110`). `{subject:>4096}` passes a
 *   naive `.format()` probe and then blows past output limits — a user-authored
 *   mantra DoS'ing the renderer. Python's formatter is what makes that reachable
 *   there; here there is no formatter at all, so the rule is expressed as: a
 *   brace group is a placeholder or it is not text we substitute. Nothing is
 *   ever evaluated.
 *
 *   SUBSTITUTION NEVER THROWS (`conditioner/cogs/dynamic/mantras.py:125-131`).
 *   `_safe_format` falls back to the raw template on any error. A malformed
 *   mantra degrades to showing its template, never to a blank screen or a crash
 *   mid-session. Everything in this file is inside that guarantee, including
 *   the guard itself.
 *
 * EXACTLY TWO placeholders are supported, bare form only. `{subject_subjective}`
 * and `[verb|verbs]` are Phase B intermediates — the ingester resolves them into
 * the three authored person variants (§2.3) — and neither ever reaches runtime.
 * A runtime that understood them would be a second, weaker conjugator competing
 * with the sidecar.
 */

import type { Names } from '../types/config.ts';

/** The complete set of placeholder names. There is no third and no extension point. */
export const PLACEHOLDERS = ['subject', 'operator'] as const;

/** A placeholder name. */
export type Placeholder = (typeof PLACEHOLDERS)[number];

/**
 * A brace group: `{` then anything but a brace, then `}`.
 *
 * Deliberately permissive in what it MATCHES and strict in what it accepts —
 * `{subject:>4096}` must be seen in order to be rejected. A pattern that only
 * matched the two legal names would leave the spec form in the output as
 * literal text, which "passes" while showing a user `{subject:>4096}` on screen.
 */
const BRACE_GROUP = /\{([^{}]*)\}/g;

/** A bare, legal placeholder: the name alone, nothing else inside the braces. */
function placeholderFor(inner: string): Placeholder | null {
  return (PLACEHOLDERS as readonly string[]).includes(inner) ? (inner as Placeholder) : null;
}

/**
 * Whether a template contains only well-formed, bare placeholders.
 *
 * The corpus lint's runtime twin. False for a format spec (`{subject:>4096}`),
 * a conversion (`{subject!r}`), an unknown field (`{controller}` — the name this
 * project renamed away from), an index (`{0}`), or an unbalanced brace.
 */
export function isSubstitutable(template: string): boolean {
  if (typeof template !== 'string') return false;

  let balance = 0;
  for (const ch of template) {
    if (ch === '{') balance += 1;
    else if (ch === '}') balance -= 1;
    if (balance < 0 || balance > 1) return false;
  }
  if (balance !== 0) return false;

  BRACE_GROUP.lastIndex = 0;
  for (let m = BRACE_GROUP.exec(template); m !== null; m = BRACE_GROUP.exec(template)) {
    if (placeholderFor(m[1]) === null) return false;
  }
  return true;
}

/**
 * Capitalize the first letter if it is lowercase — `mantras.py:159-161`.
 *
 * Only if LOWERCASE, which is not the same as "always capitalize": a template
 * that opens on `{subject}` renders a name whose casing the user chose, and
 * upcasing `eevee` to `Eevee` overrides them. Non-letters are left alone, so a
 * line opening on a brace or a digit is unchanged.
 */
export function capitalizeFirst(text: string): string {
  if (text.length === 0) return text;
  const head = text[0];
  const upper = head.toUpperCase();
  // `head !== upper` is the test rather than a regex: it is true exactly for
  // characters that HAVE an uppercase form and are not already in it, which is
  // what `str.islower()` means for a single character in the Python original.
  return head !== upper ? upper + text.slice(1) : text;
}

/**
 * Substitute `{subject}` and `{operator}`, then capitalize.
 *
 * NEVER THROWS. Any malformed input — a format spec, an unbalanced brace, a
 * missing name, a non-string — falls back to returning the template exactly as
 * it was given, and a non-string template falls back to the empty string, which
 * is the only value a renderer can paint without a crash.
 */
export function substitute(template: string, names: Names): string {
  try {
    if (typeof template !== 'string') return '';
    if (!isSubstitutable(template)) return template;

    const subject = safeName(names?.subject);
    const operator = safeName(names?.operator);
    if (subject === null || operator === null) return template;

    BRACE_GROUP.lastIndex = 0;
    const filled = template.replace(BRACE_GROUP, (raw, inner: string) => {
      const name = placeholderFor(inner);
      if (name === null) return raw;
      return name === 'subject' ? subject : operator;
    });

    return capitalizeFirst(filled);
  } catch {
    // The fallback of the fallback. Unreachable by inspection — nothing above
    // can throw on a string — and kept anyway, because "never throws" is the
    // contract C6 tests and a contract that holds by inspection is a contract
    // that holds until the next edit.
    return typeof template === 'string' ? template : '';
  }
}

/**
 * A name that is safe to splice into a line, or `null` to refuse the whole
 * substitution.
 *
 * The length cap is the direct analogue of the `{subject:>4096}` rejection:
 * that attack pads the OUTPUT, and refusing the spec form while accepting a
 * 4096-character name closes the syntax and leaves the effect. A refused name
 * shows the raw template, which is visibly wrong and therefore reportable —
 * the fail-soft §2.4 asks for.
 */
const MAX_NAME_LENGTH = 64;

function safeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_NAME_LENGTH) return null;
  // A name carrying a brace would re-enter the grammar on a second pass and a
  // name carrying a newline breaks single-line layout. Both are refusals rather
  // than repairs: §6.3's reject-don't-repair applies to what a user typed.
  if (/[{}\r\n]/.test(value)) return null;
  return value;
}
