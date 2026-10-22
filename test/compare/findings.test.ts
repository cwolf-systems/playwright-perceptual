import { describe, expect, it } from 'vitest';
import {
  bilinearRounding,
  labelEdge,
  labelMoved,
  rasteriserOverlay,
  rasteriserTerrain,
  surfaceOpacity,
  surfacePanned,
} from '../../bench/synthetic.mjs';
import { compareImages } from '../../src/compare/comparator.js';
import type { RgbaImage } from '../../src/image/types.js';

// Findings from a renderer's test suite, reproduced with synthetic images (bench/synthetic.mjs).
// Each test pins down what the comparator does with them, right or wrong; the accuracy benchmark
// reports the same pairs.

/** Every pixel past ΔE00 1 counted: nothing set aside as noise. */
const STRICT = { ignoreAntialiasing: false, ignoreShifts: false, ignoreRounding: false } as const;

/** The largest difference in any colour channel, in levels. */
function maxLevels(expected: RgbaImage, actual: RgbaImage): number {
  let max = 0;
  for (let i = 0; i < expected.data.length; i++) {
    if (i % 4 !== 3) max = Math.max(max, Math.abs(expected.data[i]! - actual.data[i]!));
  }
  return max;
}

/** 0.1% of the image, the allowance the benchmark also judges at. */
const allowance = (image: RgbaImage): number => Math.floor(0.001 * image.width * image.height);

describe('finding 1: a translucent surface from 35% to 30% opacity', () => {
  const { expected, actual } = surfaceOpacity();
  const strict = compareImages(expected, actual, STRICT);
  const result = compareImages(expected, actual);

  it('changes thousands of pixels past ΔE00 1, by at most three levels', () => {
    expect(strict.differing).toBeGreaterThan(20_000);
    expect(maxLevels(expected, actual)).toBeLessThanOrEqual(3);
  });

  it('fails: the detectors no longer take a change of colour over an area for noise', () => {
    expect(result.differing).toBeGreaterThan(0.6 * strict.differing);
    expect(result.differing).toBeGreaterThan(allowance(expected));
  });

  it('sets aside at most a third of it as shifts, near edges a move could carry colour across', () => {
    // A known gap: some of it still passes as shifts. Only the wrong behaviour is bounded, so a
    // fix that sets aside less passes too.
    expect(result.antialiased).toBeLessThan(0.01 * strict.differing);
    expect(result.shifted).toBeLessThan(0.4 * strict.differing);
  });

  it('has a control: the same scene panned 0.3 px leaves few pixels counted', () => {
    const panned = surfacePanned();
    const control = compareImages(panned.expected, panned.actual);
    expect(control.differing).toBeLessThanOrEqual(allowance(panned.expected));
    expect(control.shifted).toBeGreaterThan(1_000);
  });
});

describe('finding 2: a label that lands on another pixel between loads of the same scene', () => {
  it('fails with no allowance and passes with 0.1%, when moved a whole pixel', () => {
    const { expected, actual } = labelMoved();
    const result = compareImages(expected, actual);
    expect(result.differing).toBeGreaterThan(0);
    expect(result.differing).toBeLessThanOrEqual(allowance(expected));
    expect(result.deltaE.max).toBeGreaterThan(40);
  });

  it('fails with no allowance and passes with 0.1%, when its box covers one more row', () => {
    const { expected, actual } = labelEdge();
    const result = compareImages(expected, actual);
    expect(result.differing).toBeGreaterThan(0);
    expect(result.differing).toBeLessThanOrEqual(allowance(expected));
  });
});

describe('finding 3: one rasteriser snaps vertices to 1/16 px, the other does not', () => {
  it('passes the terrain alone, within two levels per channel', () => {
    const { expected, actual } = rasteriserTerrain();
    expect(maxLevels(expected, actual)).toBeLessThanOrEqual(2);
    expect(compareImages(expected, actual).differing).toBe(0);
  });

  it('fails a geofence whose bottom edge passes 0.02 px from a row of pixel centres', () => {
    const { expected, actual } = rasteriserOverlay();
    const result = compareImages(expected, actual);
    expect(result.differing).toBeGreaterThan(0);
    expect(result.differing).toBeLessThanOrEqual(allowance(expected));
    expect(result.deltaE.max).toBeGreaterThan(20);
  });
});

describe('finding 4: bilinear filtering in half precision against exact filtering', () => {
  const { expected, actual } = bilinearRounding();

  it('stays within one level per channel, yet passes ΔE00 1 where channels round apart', () => {
    expect(maxLevels(expected, actual)).toBe(1);
    expect(compareImages(expected, actual, STRICT).differing).toBeGreaterThan(0);
  });

  it('passes as rounding, not as a shift', () => {
    const result = compareImages(expected, actual);
    expect(result.differing).toBe(0);
    expect(result.shifted).toBe(0);
    expect(result.rounded).toBeGreaterThan(0);
  });

  it('passes with the noise detectors off when rounding is asked for, as GPU readbacks may want', () => {
    const detectorsOff = { ignoreAntialiasing: false, ignoreShifts: false };
    expect(compareImages(expected, actual, detectorsOff).differing).toBeGreaterThan(0);
    expect(
      compareImages(expected, actual, { ...detectorsOff, ignoreRounding: true }).differing,
    ).toBe(0);
  });
});
