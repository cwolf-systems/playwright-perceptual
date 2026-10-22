import { blue, green, red } from '../color/rgb.js';
import type { Pixels } from './types.js';

const CHANNELS = 3;

/**
 * Each channel's total over any rectangle of an image, in constant time: a summed-area table, the
 * total of everything above and left of each corner. It is filled in a row at a time, only as far
 * down as has been asked for, so a change near the top of a large image costs only the rows above
 * it.
 *
 * Totals are kept modulo 2³², which a large bright image overflows; a rectangle's total, the
 * difference of four of them, comes out exact as long as it fits in 32 bits.
 */
export class ChannelSums {
  readonly width: number;
  readonly height: number;
  private readonly stride: number;
  private readonly corners: Int32Array;
  /** Rows of the image added so far. */
  private filled = 0;

  constructor(private readonly pixels: Pixels) {
    this.width = pixels.width;
    this.height = pixels.height;
    this.stride = (pixels.width + 1) * CHANNELS;
    this.corners = new Int32Array(this.stride * (pixels.height + 1));
  }

  /**
   * Channel `channel` (0 red, 1 green, 2 blue) summed over columns x0 to x1 and rows y0 to y1,
   * inclusive, which must lie in the image.
   */
  total(channel: number, x0: number, y0: number, x1: number, y1: number): number {
    if (y1 >= this.filled) this.fill(y1 + 1);
    const c = this.corners;
    const above = y0 * this.stride + channel;
    const below = (y1 + 1) * this.stride + channel;
    const left = x0 * CHANNELS;
    const right = (x1 + 1) * CHANNELS;
    return (c[below + right]! - c[below + left]! - c[above + right]! + c[above + left]!) | 0;
  }

  /** Adds rows until the first `rows` of the image are in the table. */
  private fill(rows: number): void {
    const { pixels, corners: c, stride } = this;
    const { width } = pixels;
    for (let y = this.filled; y < rows; y++) {
      const above = y * stride;
      const row = above + stride;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let x = 0; x < width; x++) {
        const rgb = pixels.rgbAt(x, y);
        r += red(rgb);
        g += green(rgb);
        b += blue(rgb);
        const i = (x + 1) * CHANNELS;
        c[row + i] = (c[above + i]! + r) | 0;
        c[row + i + 1] = (c[above + i + 1]! + g) | 0;
        c[row + i + 2] = (c[above + i + 2]! + b) | 0;
      }
    }
    this.filled = rows;
  }
}

const tables = new WeakMap<Pixels, ChannelSums>();

/**
 * The summed-area table of `pixels`, kept for as long as the object is. The pixels must not change
 * while it is in use; the comparator gives each comparison its own.
 */
export function sumsOf(pixels: Pixels): ChannelSums {
  let table = tables.get(pixels);
  if (table === undefined) {
    table = new ChannelSums(pixels);
    tables.set(pixels, table);
  }
  return table;
}
