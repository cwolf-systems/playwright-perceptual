import { describe, expect, it } from 'vitest';
import { compareImages, PerceptualComparator } from '../../src/compare/comparator.js';
import { ImageSizeError, InvalidOptionError } from '../../src/errors.js';
import type { RgbaImage } from '../../src/image/types.js';
import { pixelAt, setPixel, solid, type Rgba } from '../helpers.js';

const GREY: Rgba = [128, 128, 128, 255];

function edge(greyAt: number): RgbaImage {
  const image = solid(9, 9, [255, 255, 255, 255]);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x <= greyAt; x++) setPixel(image, x, y, x < greyAt ? [0, 0, 0, 255] : GREY);
  }
  return image;
}

describe('PerceptualComparator', () => {
  it('reports nothing for identical images', () => {
    const result = compareImages(solid(8, 8, GREY), solid(8, 8, GREY));
    expect(result.differing).toBe(0);
    expect(result.deltaE).toEqual({ mean: 0, median: 0, p95: 0, p99: 0, max: 0 });
  });

  it('counts a pixel only past the tolerance', () => {
    const actual = solid(4, 4, GREY);
    setPixel(actual, 1, 1, [129, 129, 129, 255]);
    setPixel(actual, 2, 2, [160, 128, 128, 255]);
    const result = compareImages(solid(4, 4, GREY), actual);
    expect(result.differing).toBe(1);
    expect(result.deltaE.max).toBeGreaterThan(5);
  });

  it('honours a looser tolerance', () => {
    const actual = solid(2, 2, GREY);
    setPixel(actual, 0, 0, [134, 128, 128, 255]);
    expect(compareImages(solid(2, 2, GREY), actual).differing).toBe(1);
    expect(compareImages(solid(2, 2, GREY), actual, { maxDeltaE: 5 }).differing).toBe(0);
  });

  it('reports the distribution of differences, not only a count', () => {
    const actual = solid(10, 10, GREY);
    for (let x = 0; x < 10; x++) setPixel(actual, x, 0, [140, 128, 128, 255]);
    const { deltaE } = compareImages(solid(10, 10, GREY), actual);
    expect(deltaE.median).toBe(0);
    expect(deltaE.p95).toBeCloseTo(deltaE.max, 1);
    expect(deltaE.mean).toBeCloseTo(deltaE.max / 10, 6);
  });

  it('sets a shifted anti-aliased edge aside, unless told not to', () => {
    const ignored = compareImages(edge(4), edge(5));
    expect(ignored.differing).toBe(0);
    expect(ignored.antialiased).toBe(18);
    const asShift = compareImages(edge(4), edge(5), { ignoreAntialiasing: false });
    expect(asShift.shifted).toBe(18);
    const counted = { ignoreAntialiasing: false, ignoreShifts: false };
    expect(compareImages(edge(4), edge(5), counted).differing).toBe(18);
  });

  it('counts a colour that was not there before as a change, not a shift', () => {
    const actual = edge(4);
    setPixel(actual, 7, 4, [200, 40, 40, 255]);
    const result = compareImages(edge(4), actual);
    expect(result.differing).toBe(1);
    expect(result.shifted).toBe(0);
  });

  it('judges transparent pixels as they appear over white', () => {
    expect(
      compareImages(solid(2, 2, [0, 0, 0, 0]), solid(2, 2, [255, 255, 255, 255])).differing,
    ).toBe(0);
  });

  it('paints changes red, anti-aliasing yellow, shifts blue and the rest faded', () => {
    const actual = edge(5);
    setPixel(actual, 8, 0, [255, 0, 0, 255]);
    const { diff } = new PerceptualComparator().diff(edge(4), actual);
    expect(pixelAt(diff, 8, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(diff, 4, 4)).toEqual([255, 255, 0, 255]);
    expect(pixelAt(diff, 8, 8)[0]).toBeGreaterThan(240);
    const shifts = new PerceptualComparator({ ignoreAntialiasing: false });
    expect(pixelAt(shifts.diff(edge(4), edge(5)).diff, 4, 4)).toEqual([0, 160, 255, 255]);
  });

  it('takes its colour difference and noise detectors as parts', () => {
    const actual = solid(2, 2, GREY);
    setPixel(actual, 0, 0, [0, 0, 0, 255]);
    const never = new PerceptualComparator({}, { colorDifference: () => 0 });
    expect(never.compare(solid(2, 2, GREY), actual).differing).toBe(0);
    const everyEdge = new PerceptualComparator({}, { antialiasing: () => true });
    expect(everyEdge.compare(solid(2, 2, GREY), actual).antialiased).toBe(1);
    const everyShift = new PerceptualComparator({}, { antialiasing: null, shift: () => true });
    expect(everyShift.compare(solid(2, 2, GREY), actual).shifted).toBe(1);
    const noDetectors = new PerceptualComparator({}, { antialiasing: null, shift: null });
    expect(noDetectors.compare(edge(4), edge(5)).differing).toBe(18);
  });

  it('explains its result in notes, mentioning pixels it set aside only when there are some', () => {
    const [summary, ...rest] = compareImages(solid(2, 2, GREY), solid(2, 2, GREY)).notes;
    expect(summary).toBe(
      'Changed means ΔE00 above 1. Over all pixels: median 0.00, p95 0.00, p99 0.00, max 0.00.',
    );
    expect(rest).toEqual([]);
    expect(compareImages(edge(4), edge(5)).notes).toContain(
      '18 anti-aliased pixels were not counted.',
    );
    expect(compareImages(edge(4), edge(5), { ignoreAntialiasing: false }).notes).toContain(
      '18 pixels shifted by less than a pixel were not counted.',
    );
  });

  it('refuses images of different sizes, and options out of range', () => {
    expect(() => compareImages(solid(2, 2, GREY), solid(3, 2, GREY))).toThrow(ImageSizeError);
    expect(() => new PerceptualComparator({ maxDeltaE: -1 })).toThrow(InvalidOptionError);
  });
});
