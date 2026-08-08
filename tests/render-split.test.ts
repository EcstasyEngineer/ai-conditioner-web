/**
 * The queue-drain split, pause markers, and renderChannel — DESIGN.md §4.9, §5.2.
 *
 * The load-bearing assertion is the one from **[CITED recon-trance §6.1]**: a
 * five-word mantra in WORD mode yields five tokens over five firings, and the
 * same mantra in LINE mode yields one. Same mechanism, one flag. If those two
 * ever need different code paths the graft has been lost and the sides stop
 * being the same thing as the center at a different granularity.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_HOLD_MS,
  hasPauseMarkers,
  parsePauseMarkers,
  stripPauseMarkers,
  totalHoldMs,
} from '../engine/render/pauseMarkers.ts';
import {
  renderChannel,
  splitTokens,
  tokenCount,
  tokenIndexAt,
  tokenSpans,
} from '../engine/render/split.ts';
import { CHANNEL_GEOMETRY } from '../engine/render/geometry.ts';
import { defaultEnvelope, envelopeSpanMs } from '../engine/render/envelope.ts';
import { LANE_IDS, type LaneId } from '../engine/types/frame.ts';
import type { TripletTick } from '../engine/types/plan.ts';

const FIVE_WORDS = 'You sink a little deeper';

const tick: TripletTick = {
  step: 10,
  theme: 'obedience',
  intensity: 0.9,
  dwellMs: 3000,
  phase: 'middle',
  center: {
    mantraId: 'you_obey_operator_before_you_know_you_have',
    person: 'second',
    text: 'You obey {operator} before you know you have',
    split: 'LINE',
  },
  left: {
    mantraId: 'subject_obeys_the_way_subject_breathes',
    person: 'named',
    text: '{subject} obeys the way {subject} breathes',
    split: 'WORD',
  },
  right: {
    mantraId: 'the_command_is_finished_before_it_is_heard',
    person: 'named',
    text: 'The command is finished before it is heard',
    split: 'WORD',
  },
};

describe('WORD/LINE queue drain', () => {
  it('yields 5 tokens over 5 firings in WORD mode', () => {
    const tokens = splitTokens(FIVE_WORDS, 'WORD');
    expect(tokens.map((t) => t.text)).toEqual(['You', 'sink', 'a', 'little', 'deeper']);
    expect(tokenCount(FIVE_WORDS, 'WORD')).toBe(5);
  });

  it('yields exactly one token in LINE mode for the same mantra', () => {
    expect(splitTokens(FIVE_WORDS, 'LINE').map((t) => t.text)).toEqual([FIVE_WORDS]);
    expect(tokenCount(FIVE_WORDS, 'LINE')).toBe(1);
  });

  it('drains one token per firing across the step, in order', () => {
    const tokens = splitTokens(FIVE_WORDS, 'WORD');
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t = i * 600 + 300; // mid-token, 3000ms / 5 tokens
      seen.push(tokens[tokenIndexAt(tokens, t, 3000)].text);
    }
    expect(seen).toEqual(['You', 'sink', 'a', 'little', 'deeper']);
  });

  it('reports the queue as drained past the last token', () => {
    const tokens = splitTokens(FIVE_WORDS, 'WORD');
    expect(tokenIndexAt(tokens, 3000, 3000)).toBe(tokens.length);
    expect(tokenIndexAt(tokens, 99_999, 3000)).toBe(tokens.length);
  });

  it('divides the dwell evenly when no token carries a hold', () => {
    const spans = tokenSpans(splitTokens(FIVE_WORDS, 'WORD'), 3000);
    expect(spans).toHaveLength(5);
    for (const span of spans) expect(span.endMs - span.startMs).toBeCloseTo(600, 10);
    expect(spans[4].endMs).toBeCloseTo(3000, 10);
  });

  it('never spends more than the step, so a lane cannot desynchronize from the plan', () => {
    for (const text of [FIVE_WORDS, 'Breathe [500] and let go', 'One', '']) {
      for (const split of ['WORD', 'LINE'] as const) {
        const spans = tokenSpans(splitTokens(text, split), 3000);
        expect(spans[spans.length - 1].endMs, `${split}:${text}`).toBeCloseTo(3000, 10);
      }
    }
  });

  it('never returns an empty queue, so a caller does not branch on emptiness', () => {
    for (const split of ['WORD', 'LINE'] as const) {
      for (const text of ['', '   ', '[500]']) {
        expect(splitTokens(text, split).length, `${split}:"${text}"`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('tolerates a zero or negative dwell without producing NaN spans', () => {
    for (const dwell of [0, -100, Number.NaN]) {
      const spans = tokenSpans(splitTokens(FIVE_WORDS, 'WORD'), dwell);
      for (const span of spans) {
        expect(Number.isFinite(span.startMs)).toBe(true);
        expect(Number.isFinite(span.endMs)).toBe(true);
      }
    }
  });
});

describe('inline pause markers', () => {
  it('round-trips [500] and holds the visual on a partial line', () => {
    const segments = parsePauseMarkers('Breathe [500] and let go');
    expect(segments).toEqual([
      { text: 'Breathe', holdMs: 500 },
      { text: 'and let go', holdMs: 0 },
    ]);
  });

  it('round-trips [1.5s] as 1500ms', () => {
    expect(parsePauseMarkers('Sink [1.5s] deeper')).toEqual([
      { text: 'Sink', holdMs: 1500 },
      { text: 'deeper', holdMs: 0 },
    ]);
    expect(totalHoldMs('Sink [1.5s] deeper')).toBe(1500);
    expect(parsePauseMarkers('a [2s] b')[0].holdMs).toBe(2000);
  });

  it('carries a leading marker as a beat of nothing before the line', () => {
    expect(parsePauseMarkers('[500] Sink')).toEqual([
      { text: '', holdMs: 500 },
      { text: 'Sink', holdMs: 0 },
    ]);
  });

  it('strips markers and collapses the whitespace they leave behind', () => {
    expect(stripPauseMarkers('Breathe [500] and let go')).toBe('Breathe and let go');
    expect(stripPauseMarkers('No markers here')).toBe('No markers here');
    // The two paths must agree: one feeds the word splitter, one a LINE render.
    expect(splitTokens('Breathe [500] and let go', 'LINE')[0].text).toBe(
      stripPauseMarkers('Breathe [500] and let go'),
    );
  });

  it('emits no blank token from the gap a stripped marker leaves', () => {
    const tokens = splitTokens('Breathe [500] and let go', 'WORD');
    expect(tokens.map((t) => t.text)).toEqual(['Breathe', 'and', 'let', 'go']);
    expect(tokens.every((t) => t.text.length > 0)).toBe(true);
  });

  it('attaches the hold to the token before it in WORD mode', () => {
    const tokens = splitTokens('Breathe [500] and let go', 'WORD');
    expect(tokens[0]).toEqual({ text: 'Breathe', holdMs: 500 });
    expect(tokens.slice(1).every((t) => t.holdMs === 0)).toBe(true);
  });

  it('sums every hold onto the single token in LINE mode', () => {
    expect(splitTokens('a [500] b [250] c', 'LINE')).toEqual([{ text: 'a b c', holdMs: 750 }]);
  });

  it('widens the held token inside the step rather than lengthening the step', () => {
    const tokens = splitTokens('Breathe [500] and let go', 'WORD');
    const spans = tokenSpans(tokens, 3000);
    const widths = spans.map((s) => s.endMs - s.startMs);
    expect(widths[0]).toBeCloseTo(625 + 500, 10);
    for (const w of widths.slice(1)) expect(w).toBeCloseTo(625, 10);
    expect(spans[spans.length - 1].endMs).toBeCloseTo(3000, 10);
  });

  it('leaves malformed brackets in the text as prose', () => {
    for (const prose of ['[maybe]', '[ 500 ]', '[500ms]', '[-500]', '[5.5.5]', '[]']) {
      const segments = parsePauseMarkers(`Sink ${prose} deeper`);
      expect(segments, prose).toHaveLength(1);
      expect(segments[0].text, prose).toBe(`Sink ${prose} deeper`);
      expect(hasPauseMarkers(`Sink ${prose} deeper`), prose).toBe(false);
    }
  });

  it('refuses an over-cap hold and leaves it visible for the corpus lint', () => {
    const over = `[${MAX_HOLD_MS + 1}]`;
    expect(parsePauseMarkers(`Sink ${over}`)).toEqual([{ text: `Sink ${over}`, holdMs: 0 }]);
    expect(parsePauseMarkers(`Sink [${MAX_HOLD_MS}]`)[0].holdMs).toBe(MAX_HOLD_MS);
  });

  it('never throws and always returns at least one segment', () => {
    for (const bad of ['', null, undefined, 5, {}]) {
      expect(() => parsePauseMarkers(bad as never)).not.toThrow();
      expect(parsePauseMarkers(bad as never).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('is re-entrant — repeated calls give the same answer', () => {
    // A module-level regex with the /g flag carries `lastIndex` between calls.
    const line = 'Breathe [500] and [250] let go';
    const first = parsePauseMarkers(line);
    for (let i = 0; i < 5; i += 1) expect(parsePauseMarkers(line)).toEqual(first);
  });
});

describe('renderChannel', () => {
  it('gives each lane its geometry', () => {
    for (const lane of LANE_IDS) {
      const frame = renderChannel(tick, lane, 1000);
      expect(frame.lane).toBe(lane);
      expect(frame.scale).toBe(CHANNEL_GEOMETRY[lane].scale);
      expect(frame.blur).toBe(CHANNEL_GEOMETRY[lane].blur);
      expect(frame.split).toBe(tick[lane].split);
      expect(frame.alpha).toBeLessThanOrEqual(CHANNEL_GEOMETRY[lane].alpha);
    }
  });

  it('shows the center whole and the sides one word at a time', () => {
    const center = renderChannel(tick, 'center', 1000);
    expect(center.text).toBe('You obey {operator} before you know you have');

    const left = renderChannel(tick, 'left', 1000);
    expect(left.text.split(' ')).toHaveLength(1);
  });

  it('substitutes only when names are supplied', () => {
    const names = { subject: 'Alex', operator: 'Morgan' };
    expect(renderChannel(tick, 'center', 1000).text).toContain('{operator}');
    expect(renderChannel(tick, 'center', 1000, { names }).text).toBe(
      'You obey Morgan before you know you have',
    );
  });

  it('carries the raw template beside the painted text', () => {
    const frame = renderChannel(tick, 'center', 1000, { names: { subject: 'Alex', operator: 'Morgan' } });
    expect(frame.template).toBe(tick.center.text);
    expect(frame.template).not.toBe(frame.text);
    expect(frame.mantraId).toBe(tick.center.mantraId);
  });

  it('paints NOTHING when the gate is closed', () => {
    const frame = renderChannel(tick, 'left', 1000, { gate: false });
    expect(frame.active).toBe(false);
    expect(frame.text).toBe('');
    expect(frame.template).toBe('');
    expect(frame.mantraId).toBe('');
    expect(frame.alpha).toBe(0);
    // Geometry survives the gate: the shape of a ChannelFrame is constant.
    expect(frame.scale).toBe(CHANNEL_GEOMETRY.left.scale);
  });

  it('paints nothing past the envelope — the true absent tail reaches the frame', () => {
    const span = envelopeSpanMs(defaultEnvelope(tick.dwellMs));
    expect(renderChannel(tick, 'center', span - 1).active).toBe(true);
    for (const t of [span, span + 1, span * 3]) {
      const frame = renderChannel(tick, 'center', t);
      expect(frame.active, `t=${t}`).toBe(false);
      expect(frame.alpha, `t=${t}`).toBe(0);
      expect(frame.text, `t=${t}`).toBe('');
    }
  });

  it('paints nothing before the step opens', () => {
    for (const t of [-1, -500, Number.NaN]) {
      expect(renderChannel(tick, 'center', t).active, `t=${t}`).toBe(false);
    }
  });

  it('reports the pending hold on the token being shown', () => {
    const held: TripletTick = {
      ...tick,
      left: { ...tick.left, text: 'Breathe [500] and let go' },
    };
    expect(renderChannel(held, 'left', 100).holdMs).toBe(500);
    expect(renderChannel(held, 'left', 1500).holdMs).toBe(0);
  });

  it('is deterministic — the same arguments give the same frame', () => {
    for (const lane of LANE_IDS) {
      for (const t of [0, 250, 900, 1500, 2999]) {
        expect(renderChannel(tick, lane, t)).toEqual(renderChannel(tick, lane, t));
      }
    }
  });

  it('keeps the center dominant at every instant all three lanes are painting', () => {
    // C1 as a frame-level property rather than a table lookup. Guarded on
    // `alpha > 0` rather than on `active`: the lanes share an envelope shape, so
    // at the very first and last instants of a step every alpha is legitimately
    // 0 and there is no dominance to establish because nothing is on screen.
    let compared = 0;
    for (let t = 0; t < tick.dwellMs; t += 25) {
      const center = renderChannel(tick, 'center', t);
      for (const side of ['left', 'right'] as LaneId[]) {
        const lane = renderChannel(tick, side, t);
        if (center.alpha > 0 && lane.alpha > 0) {
          expect(center.alpha, `t=${t}/${side}`).toBeGreaterThan(lane.alpha);
          expect(center.scale, `t=${t}/${side}`).toBeGreaterThan(lane.scale);
          compared += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('is active but transparent only at an envelope boundary, never in the middle', () => {
    // `active` and `alpha > 0` are deliberately separate (§5.2): a lane may be
    // active and momentarily transparent mid-cross-fade. What must not happen is
    // an active lane sitting at zero opacity through the body of its step —
    // that is the "kept in the DOM waiting to flash" state the gate exists to
    // prevent. So the transparent-but-active instants must all be boundaries.
    const span = envelopeSpanMs(defaultEnvelope(tick.dwellMs));
    for (let t = 0; t < tick.dwellMs; t += 5) {
      const frame = renderChannel(tick, 'center', t);
      if (frame.active && frame.alpha === 0) {
        expect(t === 0 || t >= span - 1, `t=${t}`).toBe(true);
      }
    }
  });

  it('never throws on a malformed tick', () => {
    const broken = {
      ...tick,
      center: { ...tick.center, text: '{subject:>4096} [999999]' },
      dwellMs: 0,
    } as TripletTick;
    for (const lane of LANE_IDS) {
      expect(() => renderChannel(broken, lane, 0)).not.toThrow();
    }
  });
});
