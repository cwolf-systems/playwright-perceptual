import { describe, expect, it } from 'vitest';
import { Raster } from '../../src/image/raster.js';
import { conserved, isShifted } from '../../src/image/shift.js';
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
    const patch = textured(0);
    for (let y = 3; y < 8; y++) {
      for (let x = 3; x < 8; x++) setPixel(patch, x, y, grey(99 + ((x + y) % 2)));
    }
    expect(shifted(textured(0), patch, 5, 5)).toBe(true);
  });

  it('leaves a level across the whole of the large box to the rounding class', () => {
    // Rounding goes both ways over the large box: a level everywhere, the same way, is a drift.
    // The comparator still sets such pixels aside as rounding unless told not to.
    expect(shifted(textured(0), textured(-1), 5, 5)).toBe(false);
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

  it('takes none of a panel one or two pixels high or wide for a move', () => {
    expect(shiftedPixels(200, 2)).toBe(0);
    expect(shiftedPixels(2, 50)).toBe(0);
    expect(shiftedPixels(2, 2)).toBe(0);
    expect(shiftedPixels(200, 1)).toBe(0);
    expect(shiftedPixels(1, 50)).toBe(0);
    expect(shiftedPixels(1, 1)).toBe(0);
  });

  it('accepts a soft edge moved along an image one pixel high, though not across it', () => {
    const row = (values: number[]) => {
      const image = solid(values.length, 1, WHITE);
      values.forEach((v, x) => {
        setPixel(image, x, 0, grey(v));
      });
      return image;
    };
    const before = row([0, 0, 64, 192, 255, 255, 255, 255]);
    const after = row([0, 0, 32, 160, 255, 255, 255, 255]);
    expect(shifted(before, after, 2, 0)).toBe(true);
    expect(shifted(before, after, 3, 0)).toBe(true);
  });
});

describe('isShifted, as a box filter', () => {
  it('rejects a colour that appears in a corner, where no move from beyond can explain it', () => {
    const actual = solid(4, 4, GREY);
    setPixel(actual, 0, 0, [255, 0, 0, 255]);
    expect(shifted(solid(4, 4, GREY), actual, 0, 0)).toBe(false);
    setPixel(actual, 0, 0, [101, 100, 100, 255]);
    expect(shifted(solid(4, 4, GREY), actual, 0, 0)).toBe(true);
  });

  it('rejects a colour that appears beside an edge, though the edge could carry colour', () => {
    const before = [0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255];
    const expected = columns(before);
    const actual = columns(before);
    setPixel(actual, 8, 2, [200, 40, 40, 255]);
    expect(shifted(expected, actual, 8, 2)).toBe(false);
  });

  it('judges pixels the same way whichever tile of the image they fall in', () => {
    // Larger than the tiles the image is filtered in, so pixels either side of a tile's edge are
    // judged from different tiles: a soft edge down a tall image, and one across a wide image.
    /** A soft edge at column `at`, `height` rows of `width`, its two grey columns given. */
    const edge = (width: number, height: number, at: number, soft: readonly number[]) => {
      const values = Array.from({ length: width }, (_, x) =>
        x < at ? 0 : x - at < soft.length ? soft[x - at]! : 255,
      );
      const image = solid(width, height, WHITE);
      for (let y = 0; y < height; y++) {
        values.forEach((v, x) => {
          setPixel(image, x, y, grey(v));
        });
      }
      return new Raster(image);
    };
    for (const [width, height, at] of [
      [8, 300, 3],
      [600, 8, 511],
    ] as const) {
      const before = edge(width, height, at, [64, 192]);
      const after = edge(width, height, at, [32, 160]);
      for (let y = 0; y < height; y++) {
        for (const x of [at, at + 1]) {
          expect([isShifted(before, after, x, y), isShifted(after, before, x, y)]).toEqual([
            true,
            true,
          ]);
        }
      }
    }
  });
});

describe('isShifted, on a drift over texture', () => {
  const SIZE = 160;

  /** A smooth texture, each grey level `level(x, y)` plus `offset(x, y)`, rounded. */
  function texture(level: (x: number, y: number) => number): Raster {
    const image = solid(SIZE, SIZE, WHITE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) setPixel(image, x, y, grey(Math.round(level(x, y))));
    }
    return new Raster(image);
  }

  const smooth = (base: number) => (x: number, y: number) =>
    base + 25 * Math.sin(x / 17) * Math.cos(y / 23) + 10 * Math.sin((x + y) / 5);

  /** The share of the pixels that differ which pass as shifts. */
  function shiftedShare(expected: Raster, actual: Raster): number {
    let changed = 0;
    let shifts = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (expected.rgbAt(x, y) === actual.rgbAt(x, y)) continue;
        changed++;
        if (isShifted(expected, actual, x, y)) shifts++;
      }
    }
    return shifts / changed;
  }

  /** One to three levels lighter, in a fixed pattern. */
  const drift = (x: number, y: number) => 1 + ((x + 2 * y) % 3);

  it('counts a drift of one to three levels, which a 5×5 box alone would take for a move', () => {
    // Texture rises a few levels per pixel, so near any pixel a drift is a move up the slope;
    // over 65×65 it rises and falls, and the drift remains.
    const level = smooth(60);
    expect(
      shiftedShare(
        texture(level),
        texture((x, y) => level(x, y) + drift(x, y)),
      ),
    ).toBe(0);
  });

  it('counts the drift where box totals pass 16 bits', () => {
    // A 65×65 box of levels near 200 totals over 800,000.
    const level = smooth(200);
    expect(
      shiftedShare(
        texture(level),
        texture((x, y) => level(x, y) + drift(x, y)),
      ),
    ).toBe(0);
  });

  it('accepts the same texture moved by part of a pixel, bright or dark', () => {
    for (const base of [60, 200]) {
      const level = smooth(base);
      const moved = texture((x, y) => level(x + 0.3, y + 0.2));
      expect(shiftedShare(texture(level), moved)).toBeGreaterThan(0.99);
    }
  });
});

describe('isShifted, on any move of under a pixel', () => {
  /** A deterministic generator of numbers from 0 to 1. */
  function random(seed: number): () => number {
    let state = seed;
    return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 2 ** 32;
  }

  /** Bilinear moves of random content `judge` refuses, out of `moves`, each at a random pixel. */
  function refusedMoves(judge: typeof isShifted, moves: number): number {
    const next = random(7);
    const side = 11;
    let refused = 0;
    for (let n = 0; n < moves; n++) {
      const levels = Array.from({ length: side * side * 3 }, () => Math.floor(next() * 256));
      // Beyond the image its edge continues, so a move brings in nothing unknown.
      const at = (x: number, y: number, c: number) =>
        levels[
          (Math.min(side - 1, Math.max(0, y)) * side + Math.min(side - 1, Math.max(0, x))) * 3 + c
        ]!;
      const [a, b] = [next() * 2 - 1, next() * 2 - 1];
      const before = solid(side, side, WHITE);
      const after = solid(side, side, WHITE);
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const [sx, sy] = [x - a, y - b];
          const [x0, y0] = [Math.floor(sx), Math.floor(sy)];
          const [fx, fy] = [sx - x0, sy - y0];
          const moved = [0, 1, 2].map((c) =>
            Math.round(
              (1 - fx) * (1 - fy) * at(x0, y0, c) +
                fx * (1 - fy) * at(x0 + 1, y0, c) +
                (1 - fx) * fy * at(x0, y0 + 1, c) +
                fx * fy * at(x0 + 1, y0 + 1, c),
            ),
          );
          setPixel(before, x, y, [at(x, y, 0), at(x, y, 1), at(x, y, 2), 255]);
          setPixel(after, x, y, [moved[0]!, moved[1]!, moved[2]!, 255]);
        }
      }
      const [x, y] = [Math.floor(next() * side), Math.floor(next() * side)];
      if (!judge(new Raster(before), new Raster(after), x, y)) refused++;
    }
    return refused;
  }

  it('conserves every bilinear move of random content, in any direction, at any pixel', () => {
    expect(refusedMoves(conserved, 2_000)).toBe(0);
  });

  it('refuses most of them at the pixel, where no neighbour kept its colour', () => {
    // Random levels are the highest contrast there is, and after the move no neighbour keeps its
    // colour, so the pixel test is not widened: a pixel's colour can then lie well outside its
    // neighbours', as a colour that went away does. Rendered content keeps flat colour beside an
    // edge; noise does not.
    const refused = refusedMoves(isShifted, 2_000);
    expect(refused).toBeGreaterThan(1_000);
    expect(refused).toBeLessThan(2_000);
  });
});

describe('isShifted, beside an edge', () => {
  /** A `width`×`height` grey image whose pixel (x, y) is `level(x, y)`. */
  function greys(width: number, height: number, level: (x: number, y: number) => number): Raster {
    const result = solid(width, height, WHITE);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) setPixel(result, x, y, grey(level(x, y)));
    }
    return new Raster(result);
  }

  /** An edge from dark to light, with the columns beside its middle given. */
  const edge = (left: number, mixed: number, right: number) =>
    greys(9, 9, (x) => [40, 40, 40, left, mixed, right, 220, 220, 220][x]!);

  it('accepts an edge pixel mixed differently, the colours beside it unchanged', () => {
    expect(isShifted(edge(40, 160, 220), edge(40, 120, 220), 4, 4)).toBe(true);
  });

  it('rejects the columns beside an edge when they changed colour too', () => {
    // Eight levels lighter either side of the mixture: no rasteriser leaves that, and the light
    // side now lies beyond every colour near it. The pixel test is widened only beside a colour
    // that was kept, and here none beside it was.
    const [before, after] = [edge(40, 160, 220), edge(48, 120, 228)];
    for (let y = 0; y < 9; y++) expect(isShifted(before, after, 5, y)).toBe(false);
  });

  it('passes a faint change over textured ground beside an edge that did not move: a limit', () => {
    // Three levels darker over ground four columns wide, every pixel within reach of the edge. A
    // move of the edge by a small part of a pixel carries as much colour across each box's border
    // as the change took away, and the colour beside the edge is too faint to tell. 0.1.0 and
    // 0.2.0's earlier detectors pass it too.
    const ground = (offset: number) =>
      greys(8, 11, (x, y) => (x >= 4 ? 200 : 100 + ((x * 3 + y * 5) % 7) + offset));
    const [before, after] = [ground(0), ground(-3)];
    for (let x = 0; x < 4; x++) expect(isShifted(before, after, x, 5)).toBe(true);
  });
});
