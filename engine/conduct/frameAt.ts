/**
 * The conductor — DESIGN.md §3, §4.9, §5.2, §5.3.
 *
 * `frameAt(plan, elapsedMs)` is pure and OWNS NO CLOCK. Tests call it with
 * `elapsedMs = 0, 100, 200, ...`; the browser calls it from
 * `requestAnimationFrame`. Neither knows about the other, and that is the
 * schedule/render split recon-trance names "the single best idea here" — moved
 * one stage earlier here, because hypnoapp knows the whole session in advance.
 *
 * WHAT THIS FILE DOES NOT DO. It never decides WHICH mantra. The timeline is
 * the content register (§3.1): a `TripletTick` carries its content by value and
 * the planner settled it before a frame was drawn. This file resolves TIME into
 * geometry — which step each lane is on, how far through its token it is, and
 * what alpha the envelope is at.
 *
 * CHANNELS FREE-RUN. Each lane has its own start offset (right leads at 0, left
 * at +500, center anchors at +1000) and its own `laneDrift` multiplier, and
 * they are NEVER re-synchronized afterward. So a lane's step is computed from
 * its own accumulated time, not from a global step index — which is why
 * `FrameState.step` is documented as the ANCHOR's step rather than a global one.
 */

import type { FrameState, ChannelFrame, LaneId, SessionPhase } from '../types/frame.ts';
import type { SessionPlan, TripletTick } from '../types/plan.ts';
import { LANE_IDS } from '../types/frame.ts';

/**
 * §5.3 lane stratification. Three full-alpha layers just show whichever drew
 * last; 1.0 / 0.30 / 0.30 is what makes the stack legible, and it is a
 * presentation constant rather than a tuning knob.
 */
const LANE_ALPHA: Record<LaneId, number> = { center: 1, left: 0.3, right: 0.3 };
const LANE_SCALE: Record<LaneId, number> = { center: 1, left: 0.55, right: 0.55 };
const LANE_BLUR: Record<LaneId, number> = { center: 0, left: 1.5, right: 1.5 };

/** The threshold fade-in (§6.5) and the closing fade (§6.6). */
const THRESHOLD_MS = 6000;

/** Where a lane is, in its own free-running time. */
interface LanePosition {
  step: number;
  /** Progress through the current step's dwell, in [0,1). */
  within: number;
  /** False before the lane's offset has elapsed, or after its content ends. */
  started: boolean;
}

/**
 * Resolve a lane's own clock to a step.
 *
 * Walks the tick array accumulating each step's drifted dwell. Linear rather
 * than a prefix-sum binary search on purpose: a plan is at most a few hundred
 * steps, this runs once per lane per frame, and the walk is the same arithmetic
 * the plan's own `contentMs` is built from — so the two cannot disagree about
 * where a step starts, which a second summation strategy could.
 */
function lanePosition(plan: SessionPlan, lane: LaneId, elapsedMs: number): LanePosition {
  const offset = plan.meta.laneOffsetsMs[lane];
  const drift = plan.meta.laneDrift[lane];
  const laneTime = elapsedMs - offset;

  if (laneTime < 0) return { step: 0, within: 0, started: false };

  let acc = 0;
  for (let i = 0; i < plan.ticks.length; i += 1) {
    const dwell = plan.ticks[i].dwellMs * drift;
    if (laneTime < acc + dwell) {
      return { step: i, within: dwell > 0 ? (laneTime - acc) / dwell : 0, started: true };
    }
    acc += dwell;
  }

  // Past the end of this lane's content: it holds nothing rather than
  // repeating its last token.
  return { step: plan.ticks.length - 1, within: 1, started: false };
}

/**
 * Split a template into the tokens a lane drains.
 *
 * §5.2's queue-drain, lifted from trance's `change_text`: each firing pops one
 * token and a new line is pulled only when the queue empties. `WORD` makes a
 * five-word mantra display over five firings; `LINE` makes the whole phrase one
 * token. Same mechanism, one flag.
 *
 * Inline pause markers (`[500]`, `[1.5s]`) are stripped from what is PAINTED
 * and reported separately as `holdMs`, so a marker holds the visual on a
 * partial line instead of being rendered as literal text (§4.9).
 */
export function tokenize(text: string, split: 'WORD' | 'LINE'): string[] {
  const clean = stripPauses(text).text;
  if (split === 'LINE') return [clean];
  return clean.split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Pull inline pause markers out of a template.
 *
 * Kept in the corpus format because it costs almost nothing and keeps the
 * corpus compatible with a future TTS path, where the same marker becomes a
 * silence rather than a hold.
 */
export function stripPauses(text: string): { text: string; holdMs: number } {
  let holdMs = 0;
  const stripped = text.replace(/\[(\d+(?:\.\d+)?)(m?s)?\]/g, (_match, value: string, unit) => {
    const n = Number(value);
    holdMs += unit === 's' ? Math.round(n * 1000) : Math.round(n);
    return '';
  });
  return { text: stripped.replace(/\s{2,}/g, ' ').trim(), holdMs };
}

/** Build one lane's frame. */
function channelFrame(
  plan: SessionPlan,
  lane: LaneId,
  elapsedMs: number,
  contentEndMs: number,
): ChannelFrame {
  const position = lanePosition(plan, lane, elapsedMs);
  const tick: TripletTick = plan.ticks[position.step];
  const content = tick[lane];

  // §5.2: the `.active` gate is separate from `alpha === 0` on purpose. An
  // inactive lane paints NOTHING — it is not kept in the DOM waiting to flash,
  // and it is not transparent text that a screen reader would still announce.
  const active = position.started && elapsedMs < contentEndMs;

  if (!active) {
    return {
      lane,
      text: '',
      template: '',
      mantraId: '',
      active: false,
      alpha: 0,
      scale: LANE_SCALE[lane],
      blur: LANE_BLUR[lane],
      split: content.split,
      holdMs: 0,
    };
  }

  const { holdMs } = stripPauses(content.text);
  const tokens = tokenize(content.text, content.split);
  const index = Math.min(tokens.length - 1, Math.floor(position.within * tokens.length));

  return {
    lane,
    // The RAW template, unsubstituted. Substitution is M3's job at display
    // time, so renaming an operator re-renders content already in flight.
    text: tokens[index] ?? '',
    template: content.text,
    mantraId: content.mantraId,
    active: true,
    alpha: LANE_ALPHA[lane],
    scale: LANE_SCALE[lane],
    blur: LANE_BLUR[lane],
    split: content.split,
    holdMs,
  };
}

/**
 * The whole session's state at one instant.
 *
 * `elapsedMs` beyond the end yields `ended: true` with every lane dark, rather
 * than throwing or clamping to the last frame: the shell polls this to know
 * when to leave the session screen, and an exception is not an answer to
 * "are we done".
 */
export function frameAt(plan: SessionPlan, elapsedMs: number): FrameState {
  const contentEndMs = plan.meta.contentMs;
  const totalMs = plan.meta.totalMs;

  const channels = {} as Record<LaneId, ChannelFrame>;
  for (const lane of LANE_IDS) {
    channels[lane] = channelFrame(plan, lane, elapsedMs, contentEndMs);
  }

  // The CENTER's step is the session's step: the sides free-run against their
  // own offsets and drift and may sit on a neighbouring one.
  const anchor = lanePosition(plan, 'center', elapsedMs);
  const tick = plan.ticks[anchor.step];
  const phase: SessionPhase = tick.phase;

  // §6.5 the threshold: the first six seconds fade in rather than cutting to a
  // full field of text. §6.6 the exit: the closing fade runs after the quiet
  // tail, so a session never stops abruptly.
  const fadeInAlpha = Math.min(1, Math.max(0, elapsedMs / THRESHOLD_MS));
  const fadeStartMs = totalMs - plan.meta.tailFadeMs;
  const fadeOutAlpha =
    elapsedMs <= fadeStartMs
      ? 1
      : Math.max(0, 1 - (elapsedMs - fadeStartMs) / Math.max(plan.meta.tailFadeMs, 1));
  const masterAlpha = Math.min(fadeInAlpha, fadeOutAlpha);

  return {
    elapsedMs,
    progress: Math.min(1, Math.max(0, elapsedMs / Math.max(totalMs, 1))),
    step: anchor.step,
    phase,
    theme: tick.theme,
    channels,
    masterAlpha,
    bed: {
      // The bed sounds for the whole session including the tail — the quiet
      // after the last line is quiet of TEXT, not of the bed, and cutting it
      // with the content is what makes an ending feel abrupt.
      active: elapsedMs < totalMs,
      // Rides the tick's intensity so the bed breathes with the arc, faded by
      // the same master envelope the text uses.
      gainDb: plan.bed.gainDb + (1 - tick.intensity) * -6 + (masterAlpha - 1) * 12,
      // §5.6 hard ceiling: nothing in the field exceeds ~3Hz, and the backdrop
      // derives its rate from this, so a bed above the ceiling would take the
      // visuals with it.
      pulseHz: 0.5 + tick.intensity * 1.5,
    },
    ended: elapsedMs >= totalMs,
  };
}
