/**
 * The tag vocabulary — one flat namespace, no categories, no ordering.
 *
 * A record's `themes[]` is an opaque set of these strings and is the only
 * selection and exclusion surface in the product. The record never knows what a
 * content warning is; a consumer that wants that behaviour enumerates tags itself.
 *
 * Two kinds of tag, and the distinction is load-bearing:
 *
 *   ENROLLABLE     — may be selected to fill a lane, and may also be excluded.
 *   EXCLUSION_ONLY — may be excluded, never selected.
 *
 * MEASURED, and the reason `EXCLUSION_ONLY` exists at all: a tag derived by
 * riding on top of a parent tag has no independent territory, so excluding the
 * parent guts it. With `explicit` and `machine_register` both enrollable, 9
 * enroll×exclude pairs fall below the 54-line dwell floor — worst cases
 * `explicit`−`slut` (50.0% collateral) and `machine_register`−`drone` (51.2%).
 * With both exclusion-only, 0 of the 552 selectable pairs starve. `intense` is
 * kept enrollable because it is the only positive handle a user has on heavy
 * register, and it is measured to starve nothing.
 *
 * The floor itself is an engine parameter, not a law: 3 lanes × an 18-step peak
 * gaussian dwell. Every headroom figure moves if the dwell curve or lane count
 * changes.
 */

/** Tags a user may select to fill a lane. Also excludable. */
export const ENROLLABLE_TAGS = [
  'addiction',
  'amnesia',
  'bimbo',
  'conditioning',
  'degradation',
  'devotion',
  'dollification',
  'drone',
  'emergence',
  'exhibitionism',
  'feminization',
  'focus',
  'gratitude',
  'induction',
  'intense',
  'mindless',
  'objectification',
  'obedience',
  'orgasm_denial',
  'resistance',
  'slut',
  'submission',
  'worship',
] as const;

/**
 * Tags a user may exclude but never select.
 *
 * Both are derived from `text` by lexical probe rather than authored, and both
 * ride on parent tags — which is exactly why selecting them starves and
 * excluding them does not. A spurious probe hit therefore makes a line slightly
 * harder to reach and can never expose a user to something they excluded; that
 * asymmetry is why these two need no precision pass.
 */
export const EXCLUSION_ONLY_TAGS = ['explicit', 'machine_register'] as const;

export type EnrollableTag = (typeof ENROLLABLE_TAGS)[number];
export type ExclusionOnlyTag = (typeof EXCLUSION_ONLY_TAGS)[number];
export type Tag = EnrollableTag | ExclusionOnlyTag;

/** Every tag in the vocabulary. Selection is a strict subset of this. */
export const ALL_TAGS: readonly Tag[] = [...ENROLLABLE_TAGS, ...EXCLUSION_ONLY_TAGS];

const ENROLLABLE = new Set<string>(ENROLLABLE_TAGS);
const EXCLUSION_ONLY = new Set<string>(EXCLUSION_ONLY_TAGS);

/** True if `tag` is in the vocabulary at all. */
export function isTag(tag: string): tag is Tag {
  return ENROLLABLE.has(tag) || EXCLUSION_ONLY.has(tag);
}

/** True if `tag` may be selected to fill a lane. */
export function isEnrollable(tag: string): tag is EnrollableTag {
  return ENROLLABLE.has(tag);
}

/**
 * True if `tag` may only be excluded.
 *
 * Callers building a picker list this to keep the tag out of the selection UI
 * while leaving it in the exclusion UI.
 */
export function isExclusionOnly(tag: string): tag is ExclusionOnlyTag {
  return EXCLUSION_ONLY.has(tag);
}

/**
 * Minimum records a selectable tag must hold: 3 lanes × 18-step peak dwell.
 *
 * Enforced at load time so a thin tag cannot reach the picker and starve a lane
 * mid-session — the failure is surfaced against the corpus, once, instead of
 * against the user 400 times during playback.
 */
export const CORPUS_FLOOR = 54;

/**
 * The two (enroll, exclude) combinations measured below `CORPUS_FLOOR`.
 *
 * A full sweep of all 552 enrollable×tag pairs puts 550 above the floor. These
 * two sit at 53 and 51, and neither is repairable without damage:
 *
 *   drone − machine_register (105 → 53). Half of `drone` is written in machine
 *   idiom, verified by reading all 52 overlapping lines. The overlap is a fact
 *   about how the content is authored, not a probe defect; `drone` is a self
 *   concept and `machine_register` is a register, so merging them would erase a
 *   real distinction to move a number.
 *
 *   intense − submission (80 → 51). `intense` is the smallest tag and the only
 *   positive handle a user has on heavy register. Demoting it to exclusion-only
 *   would drop the pair from the sweep without adding a single line, which is
 *   gaming the measurement rather than fixing it.
 *
 * So the floor is treated as a picker constraint with two named exceptions
 * rather than a vocabulary mandate: a picker warns at configuration time, with
 * the resulting count, instead of failing the corpus at load. Surfacing it here
 * keeps the exception list auditable and forces a re-measure when the corpus
 * grows — the pairs should be re-swept and removed once they clear.
 */
export const KNOWN_THIN_PAIRS: readonly { enroll: Tag; exclude: Tag; remaining: number }[] = [
  // Empty as of the target-voice generation pass: both former exceptions
  // recovered when the corpus grew (drone-machine_register 53 -> 118,
  // intense-submission 51 -> 96), so they are removed rather than carried.
  // A pair that starves again belongs here with its measured count.
];
