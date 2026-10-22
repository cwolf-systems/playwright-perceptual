import { describe, expect, it } from 'vitest';
import { blue, green, red } from '../../src/color/rgb.js';
import { ChannelSums, sumsOf } from '../../src/image/sums.js';
import { Raster } from '../../src/image/raster.js';
import { setPixel, solid } from '../helpers.js';

/** A 9×7 image whose channels vary independently with position. */
function varied(): Raster {
  const image = solid(9, 7, [0, 0, 0, 255]);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 9; x++) setPixel(image, x, y, [(37 * x) % 256, (53 * y) % 256, x * y, 255]);
  }
  return new Raster(image);
}

const CHANNELS = [red, green, blue];

/** The same total, pixel by pixel. */
function counted(raster: Raster, channel: number, x0: number, y0: number, x1: number, y1: number) {
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) total += CHANNELS[channel]!(raster.rgbAt(x, y));
  }
  return total;
}

describe('ChannelSums', () => {
  it('totals each channel over any rectangle, as counting pixel by pixel does', () => {
    const raster = varied();
    const sums = new ChannelSums(raster);
    for (const [x0, y0, x1, y1] of [
      [0, 0, 8, 6],
      [3, 2, 3, 2],
      [1, 4, 7, 6],
      [0, 0, 0, 6],
      [8, 0, 8, 0],
    ] as const) {
      for (let channel = 0; channel < 3; channel++) {
        expect(sums.total(channel, x0, y0, x1, y1)).toBe(counted(raster, channel, x0, y0, x1, y1));
      }
    }
  });

  it('fills rows only as far down as asked, and later rows when asked', () => {
    const raster = varied();
    const sums = new ChannelSums(raster);
    expect(sums.total(0, 0, 0, 8, 1)).toBe(counted(raster, 0, 0, 0, 8, 1));
    expect(sums.total(2, 2, 5, 6, 6)).toBe(counted(raster, 2, 2, 5, 6, 6));
    expect(sums.total(1, 0, 0, 8, 0)).toBe(counted(raster, 1, 0, 0, 8, 0));
  });

  it('keeps one table per image', () => {
    const raster = varied();
    expect(sumsOf(raster)).toBe(sumsOf(raster));
    expect(sumsOf(raster)).not.toBe(sumsOf(varied()));
  });
});
