import { describe, expect, it } from 'vitest';
import { Raster } from '../../src/image/raster.js';
import { isShifted } from '../../src/image/shift.js';
import type { RgbaImage } from '../../src/image/types.js';
import { pixelAt, setPixel, solid, type Rgba } from '../helpers.js';

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

/** A `width`×`height` image of grey `level(x, y)`, plus `tint` in each channel. */
function solidImage(
  width: number,
  height: number,
  level: (x: number, y: number) => number,
  tint: readonly [number, number, number] = [0, 0, 0],
): RgbaImage {
  const image = solid(width, height, WHITE);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = level(x, y);
      setPixel(image, x, y, [v + tint[0], v + tint[1], v + tint[2], 255]);
    }
  }
  return image;
}

const sameAt = (a: RgbaImage, b: RgbaImage, x: number, y: number): boolean =>
  pixelAt(a, x, y).join() === pixelAt(b, x, y).join();

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
});

describe('isShifted, on the colour of an area and on moves', () => {
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

  it('accepts a soft edge moved by part of a pixel, which an offset explains', () => {
    const before = [0, 0, 0, 0, 64, 192, 255, 255, 255, 255, 255];
    const after = [0, 0, 0, 0, 32, 160, 255, 255, 255, 255, 255];
    const edge = (values: number[]) => image((x) => grey(values[x]!));
    expect(shifted(edge(before), edge(after), 4, 5)).toBe(true);
    expect(shifted(edge(before), edge(after), 5, 5)).toBe(true);
  });

  it('judges a window clipped at the border too', () => {
    expect(shifted(textured(0), textured(-2), 2, 5)).toBe(false);
    expect(shifted(textured(0), textured(-2), 5, 8)).toBe(false);
    expect(shifted(textured(0), textured(-2), 0, 0)).toBe(false);
    expect(shifted(textured(0), textured(-2), 10, 10)).toBe(false);
  });

  it('accepts a soft edge moved by part of a pixel at the border', () => {
    const before = [0, 64, 192, 255, 255, 255, 255, 255, 255, 255, 255];
    const after = [0, 32, 160, 255, 255, 255, 255, 255, 255, 255, 255];
    const edge = (values: number[]) => image((x) => grey(values[x]!));
    expect(shifted(edge(before), edge(after), 1, 0)).toBe(true);
    expect(shifted(edge(before), edge(after), 2, 10)).toBe(true);
  });

  it('accepts a soft shape moved diagonally, registered on both axes at once', () => {
    // A soft spot, bright on dark, moved by (0.3, 0.3): the mean over a window beside it changes
    // by more than noise would, and one offset explains the change.
    const spot = (centre: number) =>
      solidImage(15, 15, (x, y) =>
        Math.round(30 + 200 * Math.exp(-((x - centre) ** 2 + (y - centre) ** 2) / 12)),
      );
    const before = spot(7);
    const after = spot(7.3);
    let changed = 0;
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        if (!sameAt(before, after, x, y)) {
          changed++;
          expect(shifted(before, after, x, y)).toBe(true);
        }
      }
    }
    expect(changed).toBeGreaterThan(100);
  });

  it('rejects a change of two levels over textured ground beside an edge', () => {
    // An edge runs down column 7 of faintly textured ground. Two levels darker on its left, the
    // change is no move of the edge: the edge did not move, so no offset explains it. Its own
    // column is another matter: there the window is two-fifths unchanged (see the limits).
    const ground = (offset: number) =>
      image((x, y) => grey(x >= 7 ? 200 : 60 + ((x * 3 + y * 5) % 7) + offset));
    for (const x of [2, 3, 4, 5]) expect(shifted(ground(0), ground(-2), x, 5)).toBe(false);
  });
});

describe('isShifted, on smooth texture', () => {
  const SIDE = 96;

  /** Dark, smooth texture moved by (dx, dy), plus `drift(x, y, channel)` levels. */
  function texture(dx: number, dy: number, drift?: (x: number, y: number, c: number) => number) {
    const image = solid(SIDE, SIDE, WHITE);
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        const [u, v] = [x - dx, y - dy];
        const level = 40 + 25 * Math.sin(u / 17) * Math.cos(v / 23) + 10 * Math.sin((u + v) / 5);
        const [r, g, b] = [0, 8, 16].map((offset, c) =>
          Math.round(level + offset + (drift?.(x, y, c) ?? 0)),
        );
        setPixel(image, x, y, [r!, g!, b!, 255]);
      }
    }
    return image;
  }

  /** The share of changed pixels taken for a move. */
  function shiftedShare(before: RgbaImage, after: RgbaImage): number {
    let changed = 0;
    let moved = 0;
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) {
        if (sameAt(before, after, x, y)) continue;
        changed++;
        if (shifted(before, after, x, y)) moved++;
      }
    }
    return moved / changed;
  }

  it('accepts the texture moved by part of a pixel', () => {
    expect(shiftedShare(texture(0, 0), texture(0.3, 0))).toBe(1);
  });

  it('rejects a drift of one to three levels, though over five pixels it fits a move', () => {
    // A drift of two levels on average, over texture rising a few levels per pixel, is what a move
    // of under a pixel would leave in any one 5×5 window. Over the tile the texture turns, and the
    // offsets a drift fits disagree with the tile's.
    const drift = (x: number, y: number, c: number) => 1 + ((y * SIDE + x + c) % 3);
    expect(shiftedShare(texture(0, 0), texture(0, 0, drift))).toBeLessThan(0.01);
  });
});

describe('isShifted, on an edge resampled rather than moved', () => {
  /** A 9×9 image: dark left of column 4, light right of it, and column 4 a mixture. */
  const edge = (mixed: number, left = 40, right = 220) =>
    solidImage(9, 9, (x) => (x < 4 ? left : x > 4 ? right : mixed));

  it('accepts an edge pixel mixed differently from two sides that kept their colour', () => {
    // A GPU and a software rasteriser cover the edge column differently, with 160 and 120.
    expect(shifted(edge(160), edge(120), 4, 4)).toBe(true);
  });

  it('rejects a colour that is no mixture of the two sides', () => {
    const tinted = solidImage(9, 9, (x) => (x < 4 ? 40 : x > 4 ? 220 : 120), [0, 0, 60]);
    expect(shifted(edge(160), tinted, 4, 4)).toBe(false);
  });

  it('rejects an edge pixel whose sides changed colour too', () => {
    expect(shifted(edge(160), edge(120, 48, 228), 4, 4)).toBe(false);
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
    [2, 200],
    [1, 50],
    [2, 2],
    [1, 1],
  ])(
    'takes none of a %i×%i sliver for a move either: a flat panel has nothing to register',
    (width, height) => {
      expect(shiftedPixels(width, height)).toBe(0);
    },
  );
});
