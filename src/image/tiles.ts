import { blue, green, red, ROUNDING_LEVELS } from '../color/rgb.js';
import type { Pixels } from './types.js';

// The noise detectors ask, for each changed pixel, about the 5×5 window around it: how much each
// channel's mean changed, how much of the change a sub-pixel move explains, which pixels kept
// their colour. Summing over every window anew costs a hundred reads or more per pixel. Instead a
// pair of images is read once per tile into channel planes, and every quantity a detector sums is
// kept as a summed-area table (Crow, 1984), so any window's sum takes four lookups.
//
// Tiles are built only where a detector asks, so an image with a few changed pixels pays for a
// few tiles. The comparator visits pixels row by row, so only the current row of tiles is kept.

/** Side of a tile, in pixels. */
const SIDE = 32;

/** Half the side of the windows summed over: 2 for 5×5. */
export const WINDOW_RADIUS = 2;

export const CHANNELS = 3;

/** The quantities a tile sums over windows. */
export const Sum = {
  /** Pixels that kept their colour, give or take rounding. */
  kept: 0,
  /** Each channel's change, `other` less `image`. */
  red: 1,
  green: 2,
  blue: 3,
  /** Products of the gradient g of `image` and the change d, over the three channels. */
  gxx: 4,
  gxy: 5,
  gyy: 6,
  gxd: 7,
  gyd: 8,
  dd: 9,
} as const;

type Quantity = (typeof Sum)[keyof typeof Sum];

const QUANTITIES = 10;

/** The quantities before `gxx`, of colour rather than of motion. */
const COLOUR = Sum.gxx;

/** A rectangle of pixels from (x0, y0) to (x1, y1), inclusive. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The window around (x, y), 5×5 unless `radius` says otherwise, clipped to the image. */
export const windowAround = (pixels: Pixels, x: number, y: number, radius = WINDOW_RADIUS): Box =>
  grown(pixels, { x0: x, y0: y, x1: x, y1: y }, radius);

/** `box` grown by `by` pixels on each side, clipped to the image. */
function grown(pixels: Pixels, box: Box, by: number): Box {
  return {
    x0: Math.max(0, box.x0 - by),
    y0: Math.max(0, box.y0 - by),
    x1: Math.min(pixels.width - 1, box.x1 + by),
    y1: Math.min(pixels.height - 1, box.y1 + by),
  };
}

/** A tile of a pair of images: their channels and summed-area tables of what detectors sum. */
export class Tile {
  /** The channels of `image` and `other` around the tile, three bytes per pixel. */
  readonly before: Uint8Array;
  readonly after: Uint8Array;
  /** The tile's own pixels. */
  readonly cell: Box;
  /** The pixels read: the summed box and one more for the gradient, clipped to the image. */
  private readonly read: Box;
  /** The box summed: the tile and as far as a window around its pixels reaches. */
  private readonly summed: Box;
  /** Tables of what kept its colour and of each channel's change. */
  private readonly colour: Float64Array;
  /**
   * Tables for registration, built when first asked for: a whole-frame change of colour often
   * never needs them.
   */
  private motion: Float64Array | null = null;
  /** The image's size, for the gradient at its border. */
  private readonly width: number;
  private readonly height: number;

  constructor(image: Pixels, other: Pixels, cell: Box) {
    this.cell = cell;
    this.width = image.width;
    this.height = image.height;
    this.summed = grown(image, cell, WINDOW_RADIUS);
    this.read = grown(image, cell, WINDOW_RADIUS + 1);
    this.before = this.channels(image);
    this.after = this.channels(other);
    const { before, after } = this;
    this.colour = this.table(COLOUR, (values, here) => {
      values[Sum.kept] = 1;
      for (let c = 0; c < CHANNELS; c++) {
        const d = after[here + c]! - before[here + c]!;
        if (Math.abs(d) > ROUNDING_LEVELS) values[Sum.kept] = 0;
        values[Sum.red + c] = d;
      }
    });
  }

  private motionTables(): Float64Array {
    const { before, after, width, height } = this;
    const row = (this.read.x1 - this.read.x0 + 1) * CHANNELS;
    return this.table(QUANTITIES - COLOUR, (values, here, x, y) => {
      // Central differences, one-sided at the image's border, and none across a side of one
      // pixel. The channels are read a pixel beyond the summed box, except at the border.
      const left = x > 0 ? here - CHANNELS : here;
      const right = x < width - 1 ? here + CHANNELS : here;
      const up = y > 0 ? here - row : here;
      const down = y < height - 1 ? here + row : here;
      const across = (left === here ? 0 : 1) + (right === here ? 0 : 1) || Infinity;
      const along = (up === here ? 0 : 1) + (down === here ? 0 : 1) || Infinity;
      let gxx = 0;
      let gxy = 0;
      let gyy = 0;
      let gxd = 0;
      let gyd = 0;
      let dd = 0;
      for (let c = 0; c < CHANNELS; c++) {
        const d = after[here + c]! - before[here + c]!;
        const gx = (before[right + c]! - before[left + c]!) / across;
        const gy = (before[down + c]! - before[up + c]!) / along;
        gxx += gx * gx;
        gxy += gx * gy;
        gyy += gy * gy;
        gxd += gx * d;
        gyd += gy * d;
        dd += d * d;
      }
      values[Sum.gxx - COLOUR] = gxx;
      values[Sum.gxy - COLOUR] = gxy;
      values[Sum.gyy - COLOUR] = gyy;
      values[Sum.gxd - COLOUR] = gxd;
      values[Sum.gyd - COLOUR] = gyd;
      values[Sum.dd - COLOUR] = dd;
    });
  }

  /**
   * Summed-area tables of `count` quantities over the summed box, each pixel's values set by
   * `values` from where it starts in the channels. Each entry sums everything above and to the
   * left of it, itself included; one row and column before the box are zero.
   */
  private table(
    count: number,
    values: (out: Float64Array, here: number, x: number, y: number) => void,
  ): Float64Array {
    const { x0, y0, x1, y1 } = this.summed;
    const row = (x1 - x0 + 2) * count;
    const table = new Float64Array(row * (y1 - y0 + 2));
    const out = new Float64Array(count);
    const read = this.read;
    for (let y = y0; y <= y1; y++) {
      // Where the row starts in the channels: the summed box lies within the pixels read.
      const start = ((y - read.y0) * (read.x1 - read.x0 + 1) - read.x0) * CHANNELS;
      for (let x = x0; x <= x1; x++) {
        values(out, start + x * CHANNELS, x, y);
        const entry = (y - y0 + 1) * row + (x - x0 + 1) * count;
        for (let q = 0; q < count; q++) {
          table[entry + q] =
            out[q]! +
            table[entry - row + q]! +
            table[entry - count + q]! -
            table[entry - row - count + q]!;
        }
      }
    }
    return table;
  }

  /** Where (x, y) starts in the channels, with x and y clamped to the pixels read. */
  at(x: number, y: number): number {
    const { x0, y0, x1, y1 } = this.read;
    const cx = x < x0 ? x0 : x > x1 ? x1 : x;
    const cy = y < y0 ? y0 : y > y1 ? y1 : y;
    return ((cy - y0) * (x1 - x0 + 1) + (cx - x0)) * CHANNELS;
  }

  private channels(pixels: Pixels): Uint8Array {
    const { x0, y0, x1, y1 } = this.read;
    const plane = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1) * CHANNELS);
    for (let y = y0, i = 0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++, i += CHANNELS) {
        const rgb = pixels.rgbAt(x, y);
        plane[i] = red(rgb);
        plane[i + 1] = green(rgb);
        plane[i + 2] = blue(rgb);
      }
    }
    return plane;
  }

  /** The sum of a quantity over a box, which must lie within the tile's window reach. */
  sum(quantity: Quantity, { x0, y0, x1, y1 }: Box): number {
    const motion = quantity >= COLOUR;
    const table = motion ? (this.motion ??= this.motionTables()) : this.colour;
    const count = motion ? QUANTITIES - COLOUR : COLOUR;
    const q = motion ? quantity - COLOUR : quantity;
    const box = this.summed;
    const at = (x: number, y: number) =>
      table[((y - box.y0 + 1) * (box.x1 - box.x0 + 2) + (x - box.x0 + 1)) * count + q]!;
    return at(x1, y1) - at(x0 - 1, y1) - at(x1, y0 - 1) + at(x0 - 1, y0 - 1);
  }
}

/** The row of tiles last asked about for a pair of images, kept with the first image. */
interface Row {
  readonly other: Pixels;
  readonly row: number;
  readonly tiles: Map<number, Tile>;
}

const rows = new WeakMap<Pixels, Row>();

/**
 * The tile that holds (x, y) for `image` against `other`, or, if `eitherWay` and it is built,
 * the one for `other` against `image`: they hold the same pixels the other way round.
 */
export function tileAt(
  image: Pixels,
  other: Pixels,
  x: number,
  y: number,
  eitherWay = false,
): Tile {
  const row = Math.floor(y / SIDE);
  const column = Math.floor(x / SIDE);
  const reversed = rows.get(other);
  if (eitherWay && reversed?.other === image && reversed.row === row) {
    const tile = reversed.tiles.get(column);
    if (tile) return tile;
  }
  let current = rows.get(image);
  if (current?.other !== other || current.row !== row) {
    current = { other, row, tiles: new Map() };
    rows.set(image, current);
  }
  let tile = current.tiles.get(column);
  if (!tile) {
    tile = new Tile(image, other, {
      x0: column * SIDE,
      y0: row * SIDE,
      x1: Math.min(image.width, (column + 1) * SIDE) - 1,
      y1: Math.min(image.height, (row + 1) * SIDE) - 1,
    });
    current.tiles.set(column, tile);
  }
  return tile;
}
