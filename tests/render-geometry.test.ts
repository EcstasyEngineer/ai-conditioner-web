/**
 * Channel geometry against DESIGN.md §5.3 and the hand-authored frame fixture.
 *
 * The fixture is checked as well as the table because the two are independent
 * statements of the same claim: §5.3 is prose, `fixtures/frame.reference.json`
 * is M1's hand-authored instance of what a renderer must paint, and M3's table
 * is the code. A test that only compared the table to itself would pass while
 * the renderer painted a lane the fixture never described.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHANNEL_GEOMETRY, PAINT_ORDER, laneSpec } from '../engine/render/geometry.ts';
import { LANE_IDS, type ChannelFrame, type LaneId } from '../engine/types/frame.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface FrameFixture {
  frames: {
    label: string;
    channels: Record<LaneId, ChannelFrame>;
  }[];
}

const frameFixture = JSON.parse(
  readFileSync(path.join(repoRoot, 'fixtures', 'frame.reference.json'), 'utf8'),
) as FrameFixture;

describe('CHANNEL_GEOMETRY matches DESIGN.md 5.3', () => {
  it('gives the center scale 1.0, alpha 1.0, split LINE and offset +1000ms', () => {
    expect(CHANNEL_GEOMETRY.center).toMatchObject({
      lane: 'center',
      scale: 1,
      alpha: 1,
      blur: 0,
      split: 'LINE',
      offsetMs: 1000,
      anchor: true,
    });
  });

  it('gives both sides scale 0.55, alpha 0.30 and split WORD', () => {
    for (const lane of ['left', 'right'] as const) {
      expect(CHANNEL_GEOMETRY[lane]).toMatchObject({
        lane,
        scale: 0.55,
        alpha: 0.3,
        split: 'WORD',
        anchor: false,
      });
      expect(CHANNEL_GEOMETRY[lane].blur).toBeGreaterThan(0);
    }
  });

  it('offsets left by +500ms and lets the right lane lead at 0ms', () => {
    expect(CHANNEL_GEOMETRY.left.offsetMs).toBe(500);
    expect(CHANNEL_GEOMETRY.right.offsetMs).toBe(0);
    // The sides lead and the center arrives last and stays.
    expect(CHANNEL_GEOMETRY.right.offsetMs).toBeLessThan(CHANNEL_GEOMETRY.left.offsetMs);
    expect(CHANNEL_GEOMETRY.left.offsetMs).toBeLessThan(CHANNEL_GEOMETRY.center.offsetMs);
  });

  it('places the lanes left third, center, right third', () => {
    expect(CHANNEL_GEOMETRY.left.position).toBeLessThan(CHANNEL_GEOMETRY.center.position);
    expect(CHANNEL_GEOMETRY.center.position).toBeLessThan(CHANNEL_GEOMETRY.right.position);
    expect(CHANNEL_GEOMETRY.center.position).toBe(0.5);
    for (const lane of LANE_IDS) {
      expect(CHANNEL_GEOMETRY[lane].position).toBeGreaterThan(0);
      expect(CHANNEL_GEOMETRY[lane].position).toBeLessThan(1);
    }
  });

  it('makes the center unambiguously dominant on every visual axis at once', () => {
    // C1. Dominance is not one property: three full-alpha layers show whichever
    // drew last, so the ratio has to hold on scale, alpha and blur together.
    for (const lane of ['left', 'right'] as const) {
      expect(CHANNEL_GEOMETRY.center.alpha).toBeGreaterThan(CHANNEL_GEOMETRY[lane].alpha);
      expect(CHANNEL_GEOMETRY.center.scale).toBeGreaterThan(CHANNEL_GEOMETRY[lane].scale);
      expect(CHANNEL_GEOMETRY.center.blur).toBeLessThan(CHANNEL_GEOMETRY[lane].blur);
    }
  });

  it('names exactly one anchor, and it is the center', () => {
    const anchors = LANE_IDS.filter((l) => CHANNEL_GEOMETRY[l].anchor);
    expect(anchors).toEqual(['center']);
  });

  it('paints the anchor last so the stratification survives compositing', () => {
    expect(PAINT_ORDER[PAINT_ORDER.length - 1]).toBe('center');
    expect(new Set(PAINT_ORDER)).toEqual(new Set(LANE_IDS));
  });

  it('is frozen, so geometry is not a function of import order', () => {
    expect(Object.isFrozen(CHANNEL_GEOMETRY)).toBe(true);
    for (const lane of LANE_IDS) expect(Object.isFrozen(CHANNEL_GEOMETRY[lane])).toBe(true);
  });

  it('resolves every lane through laneSpec with no miss case', () => {
    for (const lane of LANE_IDS) expect(laneSpec(lane)).toBe(CHANNEL_GEOMETRY[lane]);
  });
});

describe('geometry agrees with fixtures/frame.reference.json', () => {
  it('matches scale, blur and split on every channel of every sample frame', () => {
    expect(frameFixture.frames.length).toBeGreaterThan(0);
    for (const frame of frameFixture.frames) {
      for (const lane of LANE_IDS) {
        const channel = frame.channels[lane];
        const spec = CHANNEL_GEOMETRY[lane];
        expect(channel.scale, `${frame.label}/${lane} scale`).toBe(spec.scale);
        expect(channel.blur, `${frame.label}/${lane} blur`).toBe(spec.blur);
        expect(channel.split, `${frame.label}/${lane} split`).toBe(spec.split);
      }
    }
  });

  it('never lets a channel exceed its lane alpha ceiling', () => {
    for (const frame of frameFixture.frames) {
      for (const lane of LANE_IDS) {
        expect(frame.channels[lane].alpha, `${frame.label}/${lane}`).toBeLessThanOrEqual(
          CHANNEL_GEOMETRY[lane].alpha,
        );
      }
    }
  });

  it('paints nothing on an inactive lane', () => {
    // The `.active` gate is structural: an inactive lane carries no text, no id
    // and no alpha, rather than sitting transparent waiting to flash.
    for (const frame of frameFixture.frames) {
      for (const lane of LANE_IDS) {
        const channel = frame.channels[lane];
        if (!channel.active) {
          expect(channel.text, `${frame.label}/${lane}`).toBe('');
          expect(channel.mantraId, `${frame.label}/${lane}`).toBe('');
          expect(channel.alpha, `${frame.label}/${lane}`).toBe(0);
        }
      }
    }
  });
});
