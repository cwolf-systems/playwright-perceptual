import { describe, expect, it } from 'vitest';
import { Raster } from '../../src/image/raster.js';
import { isShifted } from '../../src/image/shift.js';
import type { RgbaImage } from '../../src/image/types.js';
import { setPixel, solid, type Rgba } from '../helpers.js';

const WHITE: Rgba = [255, 255, 255, 255];
const GREY: Rgba = [100, 100, 100, 255];

const grey = (v: number): Rgba => [v, v, v, 255];

/** One row per value, repeated down five rows. */
function columns(values: readonly number[]): RgbaImage {
  const image = solid(values.length, 5, WHITE);
  values.forEach((v, x) => {
    for (let y = 0; y < 5; y++) setPixel(image, x, y, grey(v));
  });
  return image;
}

const shifted = (expected: RgbaImage, actual: RgbaImage, x: number, y: number): boolean =>
  isShifted(new Raster(expected), new Raster(actual), x, y);

describe('isShifted', () => {
  it('accepts a soft edge moved by part of a pixel', () => {
    const expected = columns([0, 0, 64, 192, 255, 255]);
    const actual = columns([0, 0, 32, 160, 255, 255]);
    expect(shifted(expected, actual, 2, 2)).toBe(true);
    expect(shifted(expected, actual, 3, 2)).toBe(true);
  });

  it('works at the border of the image', () => {
    const expected = columns([0, 64, 192, 255]);
    const actual = columns([0, 32, 160, 255]);
    expect(shifted(expected, actual, 1, 0)).toBe(true);
    expect(shifted(expected, actual, 0, 4)).toBe(true);
  });

  it('allows a few levels for rounding, no more', () => {
    const area = solid(5, 5, GREY);
    const rounded = solid(5, 5, GREY);
    setPixel(rounded, 2, 2, [103, 100, 100, 255]);
    expect(shifted(area, rounded, 2, 2)).toBe(true);
    setPixel(rounded, 2, 2, [104, 100, 100, 255]);
    expect(shifted(area, rounded, 2, 2)).toBe(false);
  });

  it('rejects a colour that was not there before, though the old one is still nearby', () => {
    const actual = solid(5, 5, GREY);
    setPixel(actual, 2, 2, [200, 40, 40, 255]);
    expect(shifted(solid(5, 5, GREY), actual, 2, 2)).toBe(false);
  });

  it('rejects a thin line that went away', () => {
    const expected = solid(5, 5, WHITE);
    for (let y = 0; y < 5; y++) setPixel(expected, 2, y, grey(0));
    expect(shifted(expected, solid(5, 5, WHITE), 2, 2)).toBe(false);
  });

  it('rejects a faint change across a flat area', () => {
    expect(shifted(solid(5, 5, GREY), solid(5, 5, [108, 100, 100, 255]), 2, 2)).toBe(false);
  });

  it('accepts a hard shape moved by a whole pixel, which it cannot tell apart', () => {
    expect(shifted(columns([0, 0, 255, 255]), columns([0, 255, 255, 255]), 1, 2)).toBe(true);
  });

  it('rejects a speck in either image, though the window around it keeps nearly its colour', () => {
    // Twenty levels over 49 pixels moves the window's mean by less than half a level.
    const speck = solid(9, 9, GREY);
    setPixel(speck, 4, 4, [120, 100, 100, 255]);
    expect(shifted(solid(9, 9, GREY), speck, 4, 4)).toBe(false);
    expect(shifted(speck, solid(9, 9, GREY), 4, 4)).toBe(false);
  });
});

describe('isShifted, on a uniform change over a gradient', () => {
  /** A ramp of four levels per pixel along x, `offset` levels lighter. */
  const ramp = (offset: number) => {
    const image = solid(15, 9, WHITE);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 15; x++) setPixel(image, x, y, grey(60 + 4 * x + offset));
    return image;
  };

  it('takes it for a move where the offset slides along the ramp, which looks the same', () => {
    // Two levels lighter is the ramp moved half a pixel.
    expect(shifted(ramp(0), ramp(2), 7, 4)).toBe(true);
  });

  it('rejects it where the ramp is too shallow for a move of a pixel to make up', () => {
    expect(shifted(ramp(0), ramp(6), 7, 4)).toBe(false);
  });
});

describe('isShifted, on any pixels', () => {
  /** A textured image, the same moved by `dx` along x, and a hash for its texture. */
  function texture(width: number, height: number, dx: number): RgbaImage {
    const image = solid(width, height, WHITE);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = x - dx;
        const v = 128 + 60 * Math.sin(t / 3) * Math.cos(y / 4) + 20 * Math.sin((t + y) / 2);
        setPixel(image, x, y, [Math.round(v), Math.round(255 - v), Math.round(v / 2), 255]);
      }
    }
    return image;
  }

  /** Read access with no raster behind it, as a custom detector may pass. */
  const plain = (image: RgbaImage) => {
    const raster = new Raster(image);
    return {
      width: raster.width,
      height: raster.height,
      rgbAt: (x: number, y: number) => raster.rgbAt(x, y),
    };
  };

  it('judges a raster as it judges the same pixels read one by one, in any order', () => {
    const expected = texture(70, 40, 0);
    const actual = texture(70, 40, 0.4);
    const rasters = [new Raster(expected), new Raster(actual)] as const;
    const pixels = [plain(expected), plain(actual)] as const;
    const verdicts: [boolean, boolean][] = [];
    // Bottom to top and right to left, so the window totals are not filled in reading order.
    for (let y = 39; y >= 0; y--) {
      for (let x = 69; x >= 0; x--) {
        verdicts.push([isShifted(...rasters, x, y), isShifted(...pixels, x, y)]);
      }
    }
    expect(verdicts.filter(([a, b]) => a !== b)).toEqual([]);
    expect(verdicts.filter(([a]) => a).length).toBeGreaterThan(1_000);
  });
});

describe('isShifted, on colour a move would have to conserve', () => {
  /** An 11×11 image whose pixel (x, y) is `rgba(x, y)`. */
  function image(rgba: (x: number, y: number) => Rgba): RgbaImage {
    const result = solid(11, 11, WHITE);
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) setPixel(result, x, y, rgba(x, y));
    return result;
  }

  /** Faint texture: a checkerboard one level deep. */
  const textured = (offset: number) => image((x, y) => grey(100 + ((x + y) % 2) + offset));

  it('rejects a change of two levels over an area, though each pixel stays near its old colour', () => {
    expect(shifted(textured(0), textured(-2), 5, 5)).toBe(false);
    expect(shifted(solid(11, 11, GREY), solid(11, 11, grey(102)), 5, 5)).toBe(false);
  });

  it('accepts a change of one level over an area, which rounding alone explains', () => {
    expect(shifted(textured(0), textured(-1), 5, 5)).toBe(true);
  });

  it('accepts a soft edge moved by part of a pixel, which carries colour across the window', () => {
    const before = [0, 0, 0, 0, 64, 192, 255, 255, 255, 255, 255];
    const after = [0, 0, 0, 0, 32, 160, 255, 255, 255, 255, 255];
    const edge = (values: number[]) => image((x) => grey(values[x]!));
    expect(shifted(edge(before), edge(after), 4, 5)).toBe(true);
    expect(shifted(edge(before), edge(after), 5, 5)).toBe(true);
  });

  it('judges a window near the border too, moved inward so what a move carries in is known', () => {
    expect(shifted(textured(0), textured(-2), 2, 5)).toBe(false);
    expect(shifted(textured(0), textured(-2), 5, 8)).toBe(false);
    expect(shifted(textured(0), textured(-2), 0, 0)).toBe(false);
    expect(shifted(textured(0), textured(-2), 10, 10)).toBe(false);
  });

  it('accepts a soft edge moved by part of a pixel at the border, with the window moved inward', () => {
    const before = [0, 64, 192, 255, 255, 255, 255, 255, 255, 255, 255];
    const after = [0, 32, 160, 255, 255, 255, 255, 255, 255, 255, 255];
    const edge = (values: number[]) => image((x) => grey(values[x]!));
    expect(shifted(edge(before), edge(after), 1, 0)).toBe(true);
    expect(shifted(edge(before), edge(after), 2, 10)).toBe(true);
  });

  it('accepts points moved diagonally, where colour enters past the corner of the window', () => {
    // Bright points at (4, 4) and (2, 2), just beyond the corner of (5, 5)'s window, resampled
    // bilinearly after a move of (0.75, 0.75). The move carries 0.75² of the corner point into the
    // window, more than the rows and columns beside it show before the move; after it, the
    // window's own first row and column show it.
    const points = [
      [4, 4],
      [2, 2],
    ] as const;
    const t = 0.75;
    const weight = (d: number) => (d === 0 ? 1 - t : d === 1 ? t : 0);
    const before = image((x, y) => grey(points.some(([px, py]) => px === x && py === y) ? 255 : 0));
    const after = image((x, y) =>
      grey(
        Math.round(points.reduce((v, [px, py]) => v + 255 * weight(x - px) * weight(y - py), 0)),
      ),
    );
    expect(shifted(before, after, 5, 5)).toBe(true);
  });
});

describe('isShifted, on a faint tint over a flat dark panel, at every size', () => {
  // Three levels of blue over (20, 24, 30): ΔE00 2.11, and inside the 3×3 range test's slack.
  const panel = (width: number, height: number, blueLevel: number) =>
    solid(width, height, [20, 24, blueLevel, 255]);

  /** How many pixels of the tinted panel pass as shifts. */
  function shiftedPixels(width: number, height: number): number {
    const expected = new Raster(panel(width, height, 30));
    const actual = new Raster(panel(width, height, 33));
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) if (isShifted(expected, actual, x, y)) count++;
    }
    return count;
  }

  it.each([
    [60, 60],
    [300, 12],
    [120, 24],
    [200, 6],
    [6, 6],
    [3, 3],
  ])('takes none of a %i×%i panel for a move, at its border included', (width, height) => {
    expect(shiftedPixels(width, height)).toBe(0);
  });

  it.each([
    [200, 2],
    [1, 50],
    [2, 2],
    [1, 1],
  ])('takes none of a %i×%i sliver for a move either', (width, height) => {
    expect(shiftedPixels(width, height)).toBe(0);
  });
});
