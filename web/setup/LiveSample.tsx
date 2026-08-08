/**
 * The live sample — DESIGN.md §6.2.
 *
 * "Two randomly drawn samples rendered as a live triplet with the user's own
 * names, so the person axis is visible before committing twenty minutes. For a
 * first-time user, that sample IS the explanation — better than a tour. No
 * modal, no walkthrough, no tooltips."
 *
 * So this component is load-bearing onboarding, not decoration, and two things
 * follow from that:
 *
 *   It renders a REAL TRIPLET drawn from the REAL PLAN. The samples are ticks
 *   the planner actually produced for the config on screen, in their scheduled
 *   persons, with §5.3's geometry applied. A mocked-up sample that showed three
 *   pretty lines would teach the user something the session will not do.
 *
 *   Substitution happens HERE, at display time (§2.4), through the engine's
 *   `substitute`. The tick carries the raw template; typing a new name
 *   re-renders content already drawn rather than requiring a redraw.
 *
 * There is no animation. The session's motion is M4's job and belongs to the
 * play route; a setup screen that cross-faded its sample would be a second,
 * divergent implementation of the thing being previewed.
 */

import type { TripletTick } from '../../engine/types/plan.ts';
import type { Names } from '../../engine/types/config.ts';
import type { LaneId } from '../../engine/types/frame.ts';
import { CHANNEL_GEOMETRY } from '../../engine/render/geometry.ts';
import { substitute } from '../../engine/render/substitute.ts';

/** The lanes in draw order: sides first, the anchor last and on top. */
const SAMPLE_LANES: readonly LaneId[] = ['left', 'center', 'right'];

/**
 * Which ticks to sample from a plan — DESIGN.md §6.2's "two samples".
 *
 * Taken from the plan's MIDDLE rather than its head, and spaced apart: the head
 * is induction, which is written to be unremarkable on purpose, and two
 * adjacent ticks share a theme (§4.4's theme hold) so they would show the same
 * content twice.
 *
 * Deterministic from the plan alone, with no randomness of its own. The plan is
 * already a function of `(config, seed)`, so a sample drawn at a fixed position
 * inherits that determinism — and a user who changes nothing sees the sample
 * stay put instead of shuffling under them while they read it.
 */
export function sampleTicks(ticks: readonly TripletTick[], count = 2): TripletTick[] {
  if (ticks.length === 0) return [];
  if (ticks.length <= count) return [...ticks];

  const out: TripletTick[] = [];
  // Spread the samples across the middle: at count=2 that is roughly the
  // one-third and two-thirds marks, which straddle the peak.
  for (let i = 0; i < count; i += 1) {
    const at = Math.floor((ticks.length * (i + 1)) / (count + 1));
    out.push(ticks[Math.min(at, ticks.length - 1)]);
  }
  return out;
}

/** How a person reads in the sample's caption. Never shown inside a lane. */
const PERSON_LABEL: Record<string, string> = {
  first: 'first person',
  second: 'second person',
  named: 'named self',
};

export interface LiveSampleProps {
  /** Ticks from the real plan. Empty renders the empty state, never a mock. */
  ticks: readonly TripletTick[];
  names: Names;
  /**
   * Whether to caption each lane with the person it is rendering.
   *
   * On by default: §6.2 wants the person axis VISIBLE before a user commits
   * twenty minutes, and three lines with no labels show the effect without
   * naming the mechanism.
   */
  showPersonLabels?: boolean;
}

/**
 * One tick, laid out as the session lays it out.
 *
 * The geometry table is the same one M4 paints from (`CHANNEL_GEOMETRY`), read
 * rather than restated, so the sample cannot drift from the session it previews
 * — a preview that disagrees with the thing previewed is worse than no preview.
 */
function SampleTriplet({
  tick,
  names,
  showPersonLabels,
}: {
  tick: TripletTick;
  names: Names;
  showPersonLabels: boolean;
}) {
  return (
    <div className="sample-triplet" data-testid="sample-triplet">
      {SAMPLE_LANES.map((lane) => {
        const content = tick[lane];
        const spec = CHANNEL_GEOMETRY[lane];
        return (
          <div
            key={lane}
            className={`sample-lane sample-lane--${lane}`}
            data-lane={lane}
            data-person={content.person}
            style={{
              // §5.3's geometry: the center is unambiguously dominant, the
              // sides are smaller, dimmer and softer.
              fontSize: `${spec.scale}rem`,
              opacity: spec.alpha,
              filter: spec.blur > 0 ? `blur(${spec.blur}px)` : undefined,
              fontWeight: spec.anchor ? 500 : 400,
            }}
          >
            {/* §2.4: substitution at DISPLAY time, from the raw template. */}
            <span className="sample-text">{substitute(content.text, names)}</span>
            {showPersonLabels ? (
              <span className="sample-person">{PERSON_LABEL[content.person] ?? content.person}</span>
            ) : null}
          </div>
        );
      })}
      <div className="sample-theme">{tick.theme}</div>
    </div>
  );
}

/**
 * The sample block.
 *
 * Renders nothing but the samples: no heading explaining what a sample is, no
 * tooltip on the person labels. §6.2 is explicit that the sample is the
 * explanation, and prose around it would be the walkthrough it replaces.
 */
export function LiveSample({ ticks, names, showPersonLabels = true }: LiveSampleProps) {
  const samples = sampleTicks(ticks);

  if (samples.length === 0) {
    return (
      <div className="live-sample live-sample--empty" data-testid="live-sample">
        <p className="sample-empty">Pick a theme to see what a moment of this session looks like.</p>
      </div>
    );
  }

  return (
    <div className="live-sample" data-testid="live-sample">
      {samples.map((tick) => (
        <SampleTriplet
          key={tick.step}
          tick={tick}
          names={names}
          showPersonLabels={showPersonLabels}
        />
      ))}
    </div>
  );
}
