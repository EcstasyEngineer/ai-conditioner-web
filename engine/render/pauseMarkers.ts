/**
 * Inline pause markers — DESIGN.md §4.9.
 *
 * **[CITED recon-hypnocli §3.3]** `[500]` and `[1.5s]` inside a line hold the
 * delivery on a PARTIAL line. §4.9 keeps them for two reasons: they are cheap
 * and expressive, and they keep the corpus format compatible with a future TTS
 * path, where the same marker means the same silence.
 *
 * The grammar is deliberately tiny — a bare integer in milliseconds, or a
 * decimal followed by `s` for seconds — because it is the ONLY author-facing
 * syntax that survives into runtime. §5.2 rejects the v3 surface DSL wholesale
 * ("shipping a parser to talk to ourselves is pure cost"), and every additional
 * marker form is a step back toward one.
 *
 * A marker is a property of the SEGMENT BEFORE IT: the visual holds on what has
 * been shown so far, then continues. So `"Breathe [500] and let go"` is two
 * segments — `"Breathe"` held an extra 500ms, then `"and let go"`. A marker at
 * the very start of a line yields a leading empty segment carrying the hold,
 * which is a beat of nothing before the line begins, and that is the correct
 * reading rather than a degenerate one.
 *
 * Anything that is not a well-formed marker is LEFT IN THE TEXT verbatim. A
 * `[maybe]` in a mantra is prose, and prose that vanishes because it wore
 * brackets is worse than prose that shows.
 */

/** One piece of a line, with the hold that follows it. */
export interface PauseSegment {
  /** The text of this segment, with its markers removed. */
  text: string;
  /** Extra milliseconds to hold on this segment before continuing. 0 when none. */
  holdMs: number;
}

/**
 * The marker grammar, anchored and total.
 *
 * `[500]`     — milliseconds, integer only.
 * `[1.5s]`    — seconds, integer or decimal, `s` suffix.
 *
 * No sign, no whitespace inside the brackets, no units other than `s`. Each
 * omission is a rejection that falls through to "this is prose".
 */
const MARKER = /\[(\d+(?:\.\d+)?)(s?)\]/g;

/**
 * The largest hold a single marker may request.
 *
 * A cap rather than trust: a marker is corpus content, and corpus content is
 * generated in bulk. `[999999]` is a sixteen-minute freeze inside a
 * twenty-minute session — the same class of failure as `{subject:>4096}`, and
 * refused for the same reason. Over-cap markers are treated as prose and left
 * visible, so the corpus lint has something to find.
 */
export const MAX_HOLD_MS = 10_000;

/**
 * Parse a line into segments.
 *
 * Never throws and never returns an empty array: a line with no markers is one
 * segment holding the whole line, which is the shape a caller can use without
 * branching on whether markers were present.
 */
export function parsePauseMarkers(text: string): PauseSegment[] {
  const source = typeof text === 'string' ? text : '';
  const segments: PauseSegment[] = [];

  let cursor = 0;
  let buffer = '';

  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(source); m !== null; m = MARKER.exec(source)) {
    const [raw, value, unit] = m;
    const holdMs = unit === 's' ? Math.round(Number(value) * 1000) : Math.round(Number(value));

    if (!Number.isFinite(holdMs) || holdMs <= 0 || holdMs > MAX_HOLD_MS) {
      // Not a usable hold. Keep it as prose, including its brackets, and carry
      // on scanning after it.
      buffer += source.slice(cursor, m.index) + raw;
      cursor = m.index + raw.length;
      continue;
    }

    buffer += source.slice(cursor, m.index);
    cursor = m.index + raw.length;
    segments.push({ text: collapse(buffer), holdMs });
    buffer = '';
  }

  buffer += source.slice(cursor);
  const tail = collapse(buffer);
  if (tail.length > 0 || segments.length === 0) {
    segments.push({ text: tail, holdMs: 0 });
  }

  return segments;
}

/**
 * The line with every usable marker stripped, ready to display or to split.
 *
 * Equal to joining the segments with a single space, which is asserted in the
 * tests rather than assumed here — the two paths must not drift, because one
 * feeds the word splitter and the other feeds a plain LINE render.
 */
export function stripPauseMarkers(text: string): string {
  return parsePauseMarkers(text)
    .map((s) => s.text)
    .filter((s) => s.length > 0)
    .join(' ');
}

/** Total hold requested by every marker in a line. */
export function totalHoldMs(text: string): number {
  return parsePauseMarkers(text).reduce((sum, s) => sum + s.holdMs, 0);
}

/** Whether a line carries at least one usable marker. */
export function hasPauseMarkers(text: string): boolean {
  return parsePauseMarkers(text).some((s) => s.holdMs > 0);
}

/**
 * Collapse the whitespace a removed marker leaves behind.
 *
 * `"Breathe [500] and let go"` leaves `"Breathe "` and `" and let go"`; without
 * this the word splitter emits an empty token and a lane blinks for one firing.
 */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
