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

/** Pixels read around a tile: the window's half side, and one more for the gradient. */
const MARGIN = WINDOW_RADIUS + 1;

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

/** A rectangle of pixels from (x0, y0) to (x1, y1), inclusive. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The window around (x, y), clipped to the image. */
export function windowAround(pixels: Pixels, x: number, y: number): Box {
  return {
    x0: Math.max(0, x - WINDOW_RADIUS),
    y0: Math.max(0, y - WINDOW_RADIUS),
    x1: Math.min(pixels.width - 1, x + WINDOW_RADIUS),
    y1: Math.min(pixels.height - 1, y + WINDOW_RADIUS),
  };
}

/** `box` grown by `by` pixels on each side, clipped to the image. */
const grown = (pixels: Pixels, box: Box, by: number): Box => ({
  x0: Math.max(0, box.x0 - by),
  y0: Math.max(0, box.y0 - by),
  x1: Math.min(pixels.width - 1, box.x1 + by),
  y1: Math.min(pixels.height - 1, box.y1 + by),
});

/** Channel planes of a pair of images over a box, three bytes per pixel. */
export class Planes {
  readonly image: Uint8Array;
  readonly other: Uint8Array;
  /** Entries from one row of a plane to the next. */
  readonly rowStride: number;
  private readonly width: number;

  constructor(
    image: Pixels,
    other: Pixels,
    readonly box: Box,
  ) {
    this.width = box.x1 - box.x0 + 1;
    this.rowStride = this.width * CHANNELS;
    this.image = this.read(image);
    this.other = this.read(other);
  }

  private read(pixels: Pixels): Uint8Array {
    const { x0, y0, x1, y1 } = this.box;
    const plane = new Uint8Array(this.rowStride * (y1 - y0 + 1));
    let i = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++, i += CHANNELS) {
        const rgb = pixels.rgbAt(x, y);
        plane[i] = red(rgb);
        plane[i + 1] = green(rgb);
        plane[i + 2] = blue(rgb);
      }
    }
    return plane;
  }

  /** Where (x, y) starts in a plane, with x and y clamped to the box. */
  at(x: number, y: number): number {
    const { x0, y0, x1, y1 } = this.box;
    const cx = x < x0 ? x0 : x > x1 ? x1 : x;
    const cy = y < y0 ? y0 : y > y1 ? y1 : y;
    return ((cy - y0) * this.width + (cx - x0)) * CHANNELS;
  }
}

/** A tile of a pair of images: their channels and summed-area tables of what detectors sum. */
export class Tile {
  readonly planes: Planes;
  /** The tile's own pixels. */
  readonly cell: Box;
  /** Where the tables start, and their row length: one more than the summed box is wide. */
  private readonly box: Box;
  private readonly stride: number;
  private readonly tables: Float64Array;

  constructor(image: Pixels, other: Pixels, tile: Box) {
    this.cell = tile;
    // Planes reach a pixel beyond the summed box for the gradient. At the image's border they
    // stop, and clamping to them is clamping to the image.
    this.box = grown(image, tile, WINDOW_RADIUS);
    this.planes = new Planes(image, other, grown(image, tile, MARGIN));
    const { x0, y0, x1, y1 } = this.box;
    this.stride = x1 - x0 + 2;
    this.tables = new Float64Array(this.stride * (y1 - y0 + 2) * QUANTITIES);

    const { image: before, other: after } = this.planes;
    const values = new Float64Array(QUANTITIES);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const here = this.planes.at(x, y);
        // Central differences, one-sided at the image's border, and none across a side of one
        // pixel.
        const left = this.planes.at(x - 1, y);
        const right = this.planes.at(x + 1, y);
        const up = this.planes.at(x, y - 1);
        const down = this.planes.at(x, y + 1);
        const across = Math.min(x + 1, image.width - 1) - Math.max(x - 1, 0) || Infinity;
        const along = Math.min(y + 1, image.height - 1) - Math.max(y - 1, 0) || Infinity;
        let kept = 1;
        let gxx = 0;
        let gxy = 0;
        let gyy = 0;
        let gxd = 0;
        let gyd = 0;
        let dd = 0;
        for (let c = 0; c < CHANNELS; c++) {
          const d = after[here + c]! - before[here + c]!;
          if (Math.abs(d) > ROUNDING_LEVELS) kept = 0;
          const gx = (before[right + c]! - before[left + c]!) / across;
          const gy = (before[down + c]! - before[up + c]!) / along;
          values[Sum.red + c] = d;
          gxx += gx * gx;
          gxy += gx * gy;
          gyy += gy * gy;
          gxd += gx * d;
          gyd += gy * d;
          dd += d * d;
        }
        values[Sum.kept] = kept;
        values[Sum.gxx] = gxx;
        values[Sum.gxy] = gxy;
        values[Sum.gyy] = gyy;
        values[Sum.gxd] = gxd;
        values[Sum.gyd] = gyd;
        values[Sum.dd] = dd;
        // Each entry sums everything above and to the left of it, itself included.
        const entry = this.entry(x, y);
        const above = this.entry(x, y - 1);
        const previous = this.entry(x - 1, y);
        const corner = this.entry(x - 1, y - 1);
        const t = this.tables;
        for (let q = 0; q < QUANTITIES; q++) {
          t[entry + q] = values[q]! + t[above + q]! + t[previous + q]! - t[corner + q]!;
        }
      }
    }
  }

  /** Where the table entry for (x, y) starts; one row and column before the box are zero. */
  private entry(x: number, y: number): number {
    return ((y - this.box.y0 + 1) * this.stride + (x - this.box.x0 + 1)) * QUANTITIES;
  }

  /** The sum of a quantity over a box, which must lie within the tile's window reach. */
  sum(quantity: Quantity, { x0, y0, x1, y1 }: Box): number {
    const t = this.tables;
    return (
      t[this.entry(x1, y1) + quantity]! -
      t[this.entry(x0 - 1, y1) + quantity]! -
      t[this.entry(x1, y0 - 1) + quantity]! +
      t[this.entry(x0 - 1, y0 - 1) + quantity]!
    );
  }
}

/** The row of tiles last asked about for a pair of images, kept with the first image. */
interface Row {
  readonly other: Pixels;
  readonly row: number;
  readonly tiles: Map<number, Tile>;
}

const rows = new WeakMap<Pixels, Row>();

/** The tile of `image` against `other` that holds (x, y), if it is built. */
function builtTile(image: Pixels, other: Pixels, row: number, column: number): Tile | undefined {
  const current = rows.get(image);
  return current?.other === other && current.row === row ? current.tiles.get(column) : undefined;
}

/**
 * The tile that holds (x, y) for `image` against `other`, or for `other` against `image` if that
 * one is built and `eitherWay` allows it, which `swapped` then says.
 */
export function tileAt(
  image: Pixels,
  other: Pixels,
  x: number,
  y: number,
  eitherWay = false,
): { tile: Tile; swapped: boolean } {
  const row = Math.floor(y / SIDE);
  const column = Math.floor(x / SIDE);
  const reversed = eitherWay ? builtTile(other, image, row, column) : undefined;
  if (reversed) return { tile: reversed, swapped: true };
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
  return { tile, swapped: false };
}
