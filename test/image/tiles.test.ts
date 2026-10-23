import { describe, expect, it } from 'vitest';
import { blue, green, red } from '../../src/color/rgb.js';
import { Raster } from '../../src/image/raster.js';
import { Sum, tileAt, windowAround, type Box } from '../../src/image/tiles.js';
import type { Pixels } from '../../src/image/types.js';
import { setPixel, solid } from '../helpers.js';

/** A deterministic image of every colour pattern the sums must handle. */
function pattern(width: number, height: number, seed: number): Raster {
  const image = solid(width, height, [0, 0, 0, 255]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (x * 37 + y * 91 + seed * 53) % 256;
      // Some pixels kept within a level, some not.
      const r = (x + y) % 3 === 0 ? 100 : v;
      setPixel(image, x, y, [r, (v * 7) % 256, (v * 13 + seed) % 256, 255]);
    }
  }
  return new Raster(image);
}

const CHANNELS = [red, green, blue];

/** What a tile sums, computed directly over a box. */
function bruteForce(image: Pixels, other: Pixels, box: Box): number[] {
  const at = (x: number, y: number) =>
    image.rgbAt(
      Math.min(image.width - 1, Math.max(0, x)),
      Math.min(image.height - 1, Math.max(0, y)),
    );
  const sums = new Array<number>(10).fill(0);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const across = Math.min(x + 1, image.width - 1) - Math.max(x - 1, 0) || Infinity;
      const along = Math.min(y + 1, image.height - 1) - Math.max(y - 1, 0) || Infinity;
      let kept = 1;
      CHANNELS.forEach((channel, c) => {
        const d = channel(other.rgbAt(x, y)) - channel(image.rgbAt(x, y));
        if (Math.abs(d) > 1) kept = 0;
        const gx = (channel(at(x + 1, y)) - channel(at(x - 1, y))) / across;
        const gy = (channel(at(x, y + 1)) - channel(at(x, y - 1))) / along;
        sums[Sum.red + c]! += d;
        sums[Sum.gxx]! += gx * gx;
        sums[Sum.gxy]! += gx * gy;
        sums[Sum.gyy]! += gy * gy;
        sums[Sum.gxd]! += gx * d;
        sums[Sum.gyd]! += gy * d;
        sums[Sum.dd]! += d * d;
      });
      sums[Sum.kept]! += kept;
    }
  }
  return sums;
}

describe('tiles', () => {
  it('sum each window as summing it pixel by pixel would, at the border too', () => {
    const image = pattern(70, 45, 1);
    const other = pattern(70, 45, 2);
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [31, 31],
      [32, 33],
      [40, 20],
      [69, 44],
      [68, 0],
      [0, 44],
    ] as const) {
      const window = windowAround(image, x, y);
      const tile = tileAt(image, other, x, y);
      const expected = bruteForce(image, other, window);
      Object.values(Sum).forEach((quantity) => {
        expect(tile.sum(quantity, window)).toBeCloseTo(expected[quantity]!, 6);
      });
    }
  });

  it('take no gradient across a side one pixel long', () => {
    const image = pattern(1, 9, 1);
    const other = pattern(1, 9, 2);
    const window = windowAround(image, 0, 4);
    const tile = tileAt(image, other, 0, 4);
    expect(tile.sum(Sum.gxx, window)).toBe(0);
    expect(tile.sum(Sum.gyy, window)).toBeCloseTo(bruteForce(image, other, window)[Sum.gyy]!, 6);
  });

  it('are built once per pair and row, and lent the other way round when asked', () => {
    const image = pattern(64, 64, 1);
    const other = pattern(64, 64, 2);
    const first = tileAt(image, other, 5, 5);
    expect(tileAt(image, other, 20, 10)).toBe(first);
    expect(tileAt(other, image, 5, 5, true)).toBe(first);
    // Without leave to swap, the other way round is a pair of its own.
    expect(tileAt(other, image, 5, 5)).not.toBe(first);
    // Another row, or another image to compare with, starts afresh.
    expect(tileAt(image, other, 5, 40)).not.toBe(first);
    expect(tileAt(image, other, 5, 5)).not.toBe(first);
    expect(tileAt(image, pattern(64, 64, 3), 5, 5)).not.toBe(first);
  });
});
