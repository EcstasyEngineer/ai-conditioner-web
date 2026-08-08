/**
 * The queue-drain WORD/LINE split, and the channel render — DESIGN.md §5.2, §5.3.
 *
 * **[CITED recon-trance §6.1]** documents `change_text`: each firing pops one
 * token, and a new line is pulled only when the queue EMPTIES. That is the whole
 * mechanism. With `split = WORD` a five-word mantra displays word-by-word over
 * five firings; with `split = LINE` the whole phrase is one token. Same code
 * path, one flag — which is why the anchor/periphery distinction gets a temporal
 * dimension on top of alpha, scale and blur at nearly zero cost.
 *
 * §5.2 assigns the flags: the center is `LINE` because it is the anchor and you
 * read it whole; the sides are `WORD` because they are peripheral and they SEEP.
 *
 * `renderChannel` is the whole of M3's output — it answers "what does this lane
 * look like right now" and nothing else. It does not know when frames happen,
 * it holds no state between calls, and it never decides WHICH mantra: the
 * planner settled that before a frame was drawn (§3.1, "the timeline is the
 * content register"). Give it the same arguments twice and it returns the same
 * value, which is what makes the render model testable without a browser.
 */

import type { LaneId, SplitMode, ChannelFrame } from '../types/frame.ts';
import type { TripletTick, LaneContent } from '../types/plan.ts';
import type { Names } from '../types/config.ts';

import { CHANNEL_GEOMETRY } from './geometry.ts';
import { type Envelope, compositeAlpha, defaultEnvelope, envelopeAt, envelopeActive } from './envelope.ts';
import { parsePauseMarkers } from './pauseMarkers.ts';
import { substitute } from './substitute.ts';

/** One token in a lane's queue, with the hold that follows it. */
export interface Token {
  /** The text this firing shows. Already stripped of markers, never substituted. */
  text: string;
  /** Extra ms the visual holds on this token, from an inline `[500]` (§4.9). */
  holdMs: number;
}

/**
 * Split a line into the queue a lane drains.
 *
 * WORD yields one token per word; LINE yields one token for the whole line. A
 * pause marker's hold attaches to the token it follows, so a `[500]` mid-line
 * holds the partial line in WORD mode and holds the whole line in LINE mode —
 * the same authored intent read at each lane's own granularity.
 *
 * Never returns an empty array. An empty line yields one empty token, so a
 * caller draining a queue does not have to distinguish "no tokens" from "a
 * token that is blank" — the `.active` gate is what decides whether anything
 * paints, and it is not this function's job.
 */
export function splitTokens(text: string, split: SplitMode): Token[] {
  const segments = parsePauseMarkers(typeof text === 'string' ? text : '');

  if (split === 'LINE') {
    const line = segments
      .map((s) => s.text)
      .filter((s) => s.length > 0)
      .join(' ');
    const holdMs = segments.reduce((sum, s) => sum + s.holdMs, 0);
    return [{ text: line, holdMs }];
  }

  const tokens: Token[] = [];
  for (const segment of segments) {
    const words = segment.text.length > 0 ? segment.text.split(' ') : [];
    for (const word of words) {
      tokens.push({ text: word, holdMs: 0 });
    }
    if (segment.holdMs > 0) {
      // The hold belongs to the last token emitted — the visual holds on what
      // has been shown SO FAR (§4.9, "hold the visual on a partial line"). With
      // no preceding token the hold is a beat of nothing before the line opens,
      // which is carried on an empty token rather than dropped.
      const last = tokens[tokens.length - 1];
      if (last) last.holdMs += segment.holdMs;
      else tokens.push({ text: '', holdMs: segment.holdMs });
    }
  }

  return tokens.length > 0 ? tokens : [{ text: '', holdMs: 0 }];
}

/** How many firings a line takes to drain at a given split. */
export function tokenCount(text: string, split: SplitMode): number {
  return splitTokens(text, split).length;
}

/**
 * Which token a lane is showing, given how far into its step it is.
 *
 * The queue drains across the STEP, so a lane's tokens divide the step's dwell
 * evenly and each token's own hold extends its share. Returning the index
 * rather than the token lets a caller ask "has the queue emptied" — index at or
 * past the count is the drained state, and a drained queue paints nothing.
 */
export function tokenIndexAt(tokens: Token[], tInStepMs: number, dwellMs: number): number {
  if (tokens.length === 0) return 0;
  if (!Number.isFinite(tInStepMs) || tInStepMs < 0) return 0;

  const spans = tokenSpans(tokens, dwellMs);
  for (let i = 0; i < spans.length; i += 1) {
    if (tInStepMs < spans[i].endMs) return i;
  }
  return tokens.length;
}

/** Where each token starts and ends within a step. Exported for tests and M4. */
export function tokenSpans(tokens: Token[], dwellMs: number): { startMs: number; endMs: number }[] {
  const span = Math.max(0, Number.isFinite(dwellMs) ? dwellMs : 0);
  const totalHold = tokens.reduce((sum, t) => sum + Math.max(0, t.holdMs), 0);

  // Holds are carved OUT of the dwell rather than added to it. The plan owns
  // the session's timeline (§5.1) and a renderer that lengthened a step would
  // silently desynchronize the lane from the plan it is rendering — and, over a
  // 350-step session, from the other two lanes as well.
  const base = tokens.length > 0 ? Math.max(0, span - totalHold) / tokens.length : 0;

  const spans: { startMs: number; endMs: number }[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const width = base + Math.max(0, token.holdMs);
    spans.push({ startMs: cursor, endMs: cursor + width });
    cursor += width;
  }
  return spans;
}

/** What `renderChannel` may be told beyond the tick itself. */
export interface RenderOptions {
  /**
   * The names to substitute at display time. Omitted, the raw template is
   * emitted — which is what a dump or a diff wants, and what §2.4 stores.
   */
  names?: Names;
  /**
   * Whether the lane is gated on at all — the `.active` half M3 cannot know.
   * The sides fade in at head→middle and out at middle→tail (§5.3), and which
   * side of that transition a step sits on is the conductor's fact, not the
   * render model's. Defaults to true.
   */
  gate?: boolean;
  /** Override the envelope. Defaults to `defaultEnvelope(tick.dwellMs)`. */
  envelope?: Envelope;
}

/**
 * What one lane looks like at one instant — M3's whole export surface.
 *
 * `tInStepMs` is time INTO THE STEP for this lane, already adjusted by the
 * lane's offset and drift by the caller. M3 does not apply the offset itself:
 * offsets live on `SessionPlan.meta.laneOffsetsMs` because a plan must replay
 * exactly as planned, and a render model that re-derived them from its own
 * table would quietly override the plan (§5.3).
 */
export function renderChannel(
  tick: TripletTick,
  lane: LaneId,
  tInStepMs: number,
  options: RenderOptions = {},
): ChannelFrame {
  const spec = CHANNEL_GEOMETRY[lane];
  const content: LaneContent = tick[lane];
  const env = options.envelope ?? defaultEnvelope(tick.dwellMs);

  const gate = options.gate !== false;
  const template = content.text;
  const tokens = splitTokens(template, content.split);
  const index = tokenIndexAt(tokens, tInStepMs, tick.dwellMs);
  const token = index < tokens.length ? tokens[index] : null;

  // The `.active` gate is the AND of three independent facts (§5.2): the
  // caller's gate, the envelope's true absent tail, and whether the queue still
  // has a token. Any one of them false means the lane paints NOTHING — it is
  // not kept in the DOM at zero opacity waiting to flash.
  const active = gate && token !== null && envelopeActive(env, tInStepMs);
  const alpha = active ? compositeAlpha(envelopeAt(env, tInStepMs), spec.alpha) : 0;

  const raw = token?.text ?? '';
  const text = active ? (options.names ? substitute(raw, options.names) : raw) : '';

  return {
    lane,
    text,
    template: active ? template : '',
    mantraId: active ? content.mantraId : '',
    active,
    alpha,
    scale: spec.scale,
    blur: spec.blur,
    split: content.split,
    holdMs: token?.holdMs ?? 0,
  };
}
