/**
 * Theme blocks and the triplet draw — DESIGN.md §4.3, §4.7, §4.8.
 *
 * A BLOCK IS A THEME. Its members are every mantra tagged with that theme that
 * passed the consent filters, and there is no second dimension. MEASURED, the
 * per-(theme,tier) cells the base design would have used as blocks held a
 * median of 5 records against 80-358 at theme level — and that measurement
 * outlived the axis it was taken against, because with tier deleted there is
 * nothing left to subdivide a theme by.
 *
 *   candidates = block members surviving the consent filters
 *   if |candidates| < CHANNEL_COUNT:  PLAN ERROR — this theme cannot serve a triplet
 *
 * ADJACENCY WIDENING IS DELETED. The whole widening ladder existed to
 * compensate for thin (theme, tier) cells; with no tier target there is nothing
 * to widen toward. Its absence is what makes the consent guarantee structural:
 * the eligible set is computed once, before any block is built, and no stage
 * downstream can reach past it because no stage downstream has a mechanism for
 * reaching anywhere.
 *
 * ONE SHUFFLER PER THEME, SHARED ACROSS ALL THREE CHANNELS (§4.8). That sharing
 * is not an optimization — it is what makes the three lanes say DIFFERENT lines
 * of the same theme, which is hypnocli's measured flagship texture and parity
 * row 6.
 */

import type { CorpusEntry } from '../types/record.ts';
import type { ShufflerOptions, TripletMode } from '../types/config.ts';
import type { Diagnostic } from '../types/diagnostic.ts';
import type { LaneId } from '../types/frame.ts';
import { Shuffler } from './shuffler.ts';
import type { Rng } from '../rng/mulberry32.ts';

/** A theme's eligible members plus the shared picker that serves them. */
export interface Block {
  theme: string;
  members: CorpusEntry[];
  shuffler: Shuffler;
  /** Ids removed by the blocklist that could be restored if the block starves. */
  relaxable: CorpusEntry[];
}

/**
 * Build the per-theme block set, one shuffler each.
 *
 * Blocks are built ONCE per plan, not per step: the shuffler is stateful and a
 * per-step rebuild would reset the suppression window every step, silently
 * turning anti-repeat off while looking exactly like working code.
 */
export function buildBlocks(params: {
  themes: readonly string[];
  membersOf: (theme: string) => CorpusEntry[];
  relaxableOf: (theme: string) => CorpusEntry[];
  options: ShufflerOptions;
  rngFor: (theme: string) => Rng;
}): Map<string, Block> {
  const blocks = new Map<string, Block>();
  for (const theme of params.themes) {
    if (blocks.has(theme)) continue;
    const members = params.membersOf(theme);
    blocks.set(theme, {
      theme,
      members,
      shuffler: new Shuffler(members.length, params.options, params.rngFor(theme)),
      relaxable: params.relaxableOf(theme),
    });
  }
  return blocks;
}

/** One lane's resolved draw. */
export interface Draw {
  entry: CorpusEntry;
  /** Set when the blocklist had to be ignored to fill this lane. */
  relaxed: boolean;
}

/**
 * Draw the three lanes for one step.
 *
 * CENTER FIRST, because it is the anchor: §4.7 specifies drawing it first and
 * then excluding what it took, so the anchor never loses a contest to a
 * peripheral lane.
 *
 * `parallel`: three DIFFERENT mantras, enforced through the shuffler's `allow`
 * filter rather than by drawing and retrying — a retry loop can spin, and a
 * filtered draw cannot.
 *
 * `unison`: ONE mantra, all three lanes, each in its own person. The planner
 * REFUSES a unison step whose drawn mantra is `invariant` and redraws, because
 * an invariant record under unison renders as three byte-identical strings
 * across the screen, which a user reads as a bug rather than as emphasis. That
 * refusal is C7's engine half, and every redraw is recorded as a typed
 * diagnostic rather than done quietly.
 */
export function drawTriplet(params: {
  block: Block;
  step: number;
  mode: TripletMode;
  diagnostics: Diagnostic[];
}): { center: Draw; left: Draw; right: Draw } | undefined {
  const { block, step, mode, diagnostics } = params;

  if (mode === 'unison') {
    // Refuse invariants. `allow` filters them out of the candidate set up
    // front, so the "redraw" is a single filtered draw rather than a loop that
    // could exhaust its attempts and fall through to the artifact.
    const invariantFree = (index: number): boolean => !block.members[index].invariant;
    const hasNonInvariant = block.members.some((entry) => !entry.invariant);

    const index = hasNonInvariant ? block.shuffler.next(invariantFree) : block.shuffler.next();
    if (index === undefined) return undefined;

    const entry = block.members[index];
    if (entry.invariant) {
      // Only reachable when the whole block is invariant. Recorded rather than
      // hidden: the diagnostic is how a corpus gap of this shape becomes
      // visible to Phase B instead of only to a user mid-session.
      diagnostics.push({ kind: 'unison-redraw', step, reason: 'invariant' });
    } else if (hasNonInvariant && block.members.some((candidate) => candidate.invariant)) {
      // The filter actually excluded something — that IS the redraw §4.7 names.
      diagnostics.push({ kind: 'unison-redraw', step, reason: 'invariant' });
    }

    const draw: Draw = { entry, relaxed: false };
    return { center: draw, left: draw, right: draw };
  }

  const taken = new Set<number>();
  const drawLane = (): number | undefined => {
    const index = block.shuffler.next((i) => !taken.has(i));
    if (index !== undefined) taken.add(index);
    return index;
  };

  const centerIndex = drawLane();
  const leftIndex = drawLane();
  const rightIndex = drawLane();
  if (centerIndex === undefined || leftIndex === undefined || rightIndex === undefined) {
    return undefined;
  }

  return {
    center: { entry: block.members[centerIndex], relaxed: false },
    left: { entry: block.members[leftIndex], relaxed: false },
    right: { entry: block.members[rightIndex], relaxed: false },
  };
}

/** Lane order for reporting, so a diagnostic names lanes in a stable order. */
export const DRAW_ORDER: readonly LaneId[] = ['center', 'left', 'right'] as const;
