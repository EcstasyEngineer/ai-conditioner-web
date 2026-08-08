/**
 * The consent chokepoint — DESIGN.md §2.6.
 *
 * This is the file with zero tolerance attached to it. A7 sweeps 1000 random
 * configs and one violation blocks 1.0, so the design here is not "filter
 * carefully" but "make the violating state unreachable".
 *
 * THE STRUCTURAL GUARANTEE. Consent is applied ONCE, here, to produce the
 * eligible set, and every later stage — theme walk, blocks, shuffler, person
 * scheduler, unison redraw — draws only from what this file already admitted.
 * No stage can widen. That matters because the deleted intensity axis used to
 * carry an adjacency-widening ladder that could reach past a filter applied
 * afterward; with the cap gone the ladder is gone too, and the ordering that
 * made it safe is kept as the invariant that makes widening unrepresentable
 * rather than merely absent.
 *
 * THE CROSS-TAG RULE. An exclusion is checked against a record's FULL
 * `themes[]`, never against the block it was collected under. A record tagged
 * {obedience, degradation} sitting in the `obedience` block is invisible to a
 * user who excluded `degradation` — that is the leak this closes, and it is
 * live machinery the moment the corpus carries a cross-tagged record.
 *
 * THE ORDER IS NORMATIVE, and the two halves have different failure semantics:
 *
 *   1. CONSENT   excluded themes, then the operator toggle. NEVER relaxed. If
 *                these empty a slot, the slot starves and that is a hard
 *                planning error surfaced before playback.
 *   2. PREFERENCE the blocklist. Relaxed as a last resort rather than starving,
 *                and the plan carries a `blocklist-relaxed` diagnostic saying
 *                so.
 *
 * Getting that order backwards would let a preference decide whether a consent
 * boundary is enforced, which is why it is stated as data below rather than
 * left implicit in the sequence of `if`s.
 */

import type { Corpus, CorpusEntry } from '../types/record.ts';
import type { UserConfig } from '../types/config.ts';

/**
 * The eligible set, and what it cost to get there.
 *
 * `consented` is the consent-filtered set — the widest set any later stage may
 * ever see. `preferred` additionally honours the blocklist. Both are returned
 * because the relax path needs to fall back from `preferred` to `consented`
 * WITHOUT re-running a filter: re-filtering at relax time is how a consent
 * check gets accidentally omitted from the fallback branch.
 */
export interface EligibleSet {
  /** Survived consent. The ceiling on everything downstream. */
  consented: CorpusEntry[];
  /** Survived consent AND the blocklist. What a draw prefers. */
  preferred: CorpusEntry[];
  /** Ids removed by the blocklist alone. Non-empty means a relax is possible. */
  blocked: string[];
}

/**
 * True when `entry` passes every CONSENT boundary in `config`.
 *
 * Exported for A7, which asserts on this predicate directly as well as on
 * whole plans: a whole-plan sweep proves no violation was emitted, and a
 * predicate sweep proves the rule itself is right. They fail for different
 * reasons and both are wanted.
 */
export function passesConsent(entry: CorpusEntry, config: UserConfig): boolean {
  // 1. Exclusions, against the FULL tag list. `some` over the record's themes
  //    rather than a check on the bucket key is the whole point of the rule.
  if (config.excludedThemes.length > 0) {
    const excluded = new Set(config.excludedThemes);
    for (const theme of entry.record.themes) {
      if (excluded.has(theme)) return false;
    }
  }

  // 2. The operator toggle, on the mechanical marker. `has_operator` is a
  //    substring test against the text it describes, so it cannot drift from
  //    the record the way a hand-set flag could.
  if (!config.allowOperator && entry.record.markers.has_operator) return false;

  return true;
}

/**
 * Apply consent, then preference, to the whole corpus.
 *
 * Computed ONCE per plan and threaded everywhere, rather than re-derived per
 * step. That is a correctness property before it is a performance one: a
 * filter applied in N places is a filter that can be omitted in one of them,
 * and A11's 40ms budget for a 500-step plan is met by not doing this 500 times.
 */
export function eligibleEntries(corpus: Corpus, config: UserConfig): EligibleSet {
  const consented: CorpusEntry[] = [];
  const preferred: CorpusEntry[] = [];
  const blocked: string[] = [];
  const blocklist = new Set(config.blocklist);

  // Load order is preserved: the corpus is order-dependent (meter and rhyme
  // adjacency are authored properties) and the planner must never be the stage
  // that sorts it.
  for (const entry of corpus.entries) {
    if (!passesConsent(entry, config)) continue;
    consented.push(entry);
    if (blocklist.has(entry.record.id)) {
      blocked.push(entry.record.id);
      continue;
    }
    preferred.push(entry);
  }

  return { consented, preferred, blocked };
}

/**
 * The eligible members of one theme block — DESIGN.md §4.3.
 *
 * A block IS a theme, and its members are every record tagged with that theme
 * that survived consent. Note what this function does NOT do: it never widens
 * to a neighbouring theme, because there is no second dimension left to widen
 * along and no ladder to widen toward. `|candidates| < CHANNEL_COUNT` is a
 * plan error, not a prompt to look elsewhere.
 *
 * Filtering the already-consented list rather than indexing `corpus.byTheme`
 * is deliberate: `byTheme` is the unfiltered index, and reaching for it here
 * is precisely how a record the user excluded would re-enter through the
 * bucket it was collected under.
 */
export function blockMembers(eligible: readonly CorpusEntry[], theme: string): CorpusEntry[] {
  return eligible.filter((entry) => entry.record.themes.includes(theme));
}
