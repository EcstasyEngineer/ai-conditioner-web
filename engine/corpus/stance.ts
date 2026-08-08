/**
 * The stance of a stored template — DESIGN.md §2.2.
 *
 * `pov` is DERIVED from the text and never stored. It was a schema field until
 * it was measured: it is 100% recomputable by this function, its `second` value
 * has zero instances in the corpus, and its one load-bearing distinction —
 * person-free, meaning the record can serve a side lane without exposing the
 * person axis — is already carried by `persons[id].invariant`.
 *
 * Deriving it is strictly stronger than reading it back. A stored stance can be
 * wrong, and a sidecar integrity check that trusts it validates the record
 * against its own mistake rather than against its text.
 *
 * This is the engine's copy of the rule the ingester enforces at write time.
 * The two must agree, which is what `tests/shared-contract.test.ts` asserts:
 * the engine may not import from `tools/`, so the alternative to a second
 * implementation is a runtime dependency the architecture forbids.
 */

import type { Pov } from '../types/record.ts';

/**
 * First-person pronouns, the closed set. Contractions are listed because the
 * tokenizer keeps `i'm` whole, so a set without them reads "I'm sinking" as
 * person-free.
 */
const FIRST_PRONOUNS = new Set([
  'i', 'me', 'my', 'mine', 'myself',
  "i'm", "i've", "i'll", "i'd",
]);

/** Second-person pronouns, the closed set. Same contraction rule. */
const SECOND_PRONOUNS = new Set([
  'you', 'your', 'yours', 'yourself', 'yourselves',
  "you're", "you've", "you'll", "you'd",
]);

/**
 * Tokenize to comparable words. Placeholders survive as single tokens, and a
 * placeholder carries its own possessive: `{operator}'s` is ONE token.
 */
function tokenize(text: string): string[] {
  return (
    text.match(/\{subject\}(?:'s)?|\{operator\}(?:'s)?|[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []
  ).map((t) => (t.startsWith('{') ? t : t.toLowerCase()));
}

function stripPossessive(token: string): string {
  return token.endsWith("'s") ? token.slice(0, -2) : token;
}

function hasAny(tokens: string[], set: Set<string>): boolean {
  return tokens.some((t) => set.has(stripPossessive(t)));
}

/**
 * The stance of `text`, or `'mixed'` when it carries more than one.
 *
 * `mixed` is not a `Pov` — §4.2 forbids mixing voice frames within one line and
 * MEASURED zero records need it — so callers reject rather than coerce.
 */
export function derivePov(text: string): Pov | 'mixed' {
  const tokens = tokenize(text);
  const first = hasAny(tokens, FIRST_PRONOUNS);
  const second = hasAny(tokens, SECOND_PRONOUNS);
  const named = text.includes('{subject}');

  if ([first, second, named].filter(Boolean).length > 1) return 'mixed';
  if (second) return 'second';
  if (first) return 'first';
  if (named) return 'named';
  return 'impersonal';
}
