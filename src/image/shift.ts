import { blue, green, red, ROUNDING_LEVELS } from '../color/rgb.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel keeps its colour: over a box, each channel's total changes
// only by what the move carries across the box's border. A real change, such as a tint, a fainter
// overlay or a drift of a few levels, changes the total over the whole box.
//
// Moving by (tx, ty), each between 0 and 1 in one of four directions, and resampling bilinearly,
// changes a box's total by tx·Lx + ty·Ly + tx·ty·K, where Lx is the column brought in less the
// column taken out, Ly the same for rows, and K the corners where they cross. That is bilinear in
// tx and ty, so it ranges between its values at the corners of the square: the change in the
// box's total when the box is moved by a whole pixel across, down, both or neither.
//
// So, one rule: box-filter both images, and one image's box total at a pixel must lie within the
// range of the other's box totals there and one pixel over, in one of the four directions, give
// or take rounding. It is tested over a 5×5 box, which a real change survives, either image being
// the one that moved; and over the pixel alone, where it says the pixel's colour lies within the
// colours next to it in the other image, both ways round, so a colour that appears or goes away
// is not a move.

/** The sides of the boxes tested, the most decisive first. */
const BOXES = [5, 1];

const CHANNELS = 3;

/** Rows of an image filtered at once: bands are filtered only where a pixel is judged. */
const BAND = 64;

/** Rows read beyond a band, for the boxes that judge the pixels at its edge. */
const MARGIN = BOXES[0]! + 1;

const SIGNS = [-1, 1];

/**
 * Levels a pixel's colour may lie outside the colours next to it: rounding in the resampling. One
 * level per pixel, as over the box, fails real renders of the same scene; three does not.
 */
const PIXEL_SLACK = 3;

/** A box's side along a side of `size`: at most `n`, leaving room to move it by a pixel. */
const side = (n: number, size: number): number => Math.min(n, size - 1);

/**
 * Where a box of `n` pixels starts along a side of `size` to judge the pixel at `p` against a move
 * of a pixel towards `sign`, or -1 if none can. The box sits around the pixel, moved inward near
 * the border so that the box moved is in the image too: colour is conserved over any box, so the
 * test stays sound off centre. A box of one pixel judges that pixel's own colour, so it cannot
 * move: on the outermost pixels, a move from beyond the border explains nothing.
 */
function place(p: number, n: number, size: number, sign: number): number {
  const start = Math.max(sign < 0 ? 1 : 0, Math.min(p - (n >> 1), size - n - (sign > 0 ? 1 : 0)));
  return n === 1 && start !== p ? -1 : start;
}

/** Each channel's totals over boxes of one size, for a band of an image's rows. */
interface Boxes {
  readonly nx: number;
  readonly ny: number;
  /** Boxes in a row. */
  readonly columns: number;
  readonly totals: Uint16Array;
}

/** A band of an image's rows, box-filtered at each size of box. */
class Band {
  readonly top: number;
  readonly boxes: readonly Boxes[];

  constructor(
    readonly pixels: Pixels,
    readonly index: number,
  ) {
    const { width, height } = pixels;
    this.top = Math.max(0, index * BAND - MARGIN);
    const rows = Math.min(height, (index + 1) * BAND + MARGIN) - this.top;
    const stride = width * CHANNELS;
    const levels = new Uint16Array(rows * stride);
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < width; x++, i += CHANNELS) {
        const rgb = pixels.rgbAt(x, this.top + y);
        levels[i] = red(rgb);
        levels[i + 1] = green(rgb);
        levels[i + 2] = blue(rgb);
      }
    }
    // Separable running sums: totals down each column over the box's rows, then across.
    this.boxes = BOXES.map((n) => {
      const nx = side(n, width);
      const ny = side(n, height);
      const columns = width - nx + 1;
      if (nx === 1 && ny === 1) return { nx, ny, columns, totals: levels };
      const totals = new Uint16Array(rows * columns * CHANNELS);
      const down = new Uint16Array(stride);
      const across = new Int32Array(stride);
      for (let y = 0; y < rows; y++) {
        const row = (y - ny + 1) * columns * CHANNELS;
        for (let i = 0; i < stride; i++) {
          down[i]! += levels[y * stride + i]! - (y < ny ? 0 : levels[(y - ny) * stride + i]!);
          across[i] = down[i]! + (i < CHANNELS ? 0 : across[i - CHANNELS]!);
          // The box ending at this pixel starts nx pixels back; its total, once it is all read.
          const before = i - nx * CHANNELS;
          if (row >= 0 && before >= -CHANNELS) {
            totals[row + before + CHANNELS] = across[i]! - (before < 0 ? 0 : across[before]!);
          }
        }
      }
      return { nx, ny, columns, totals };
    });
  }

  /** Channel `c`'s total over the `b`th size of box whose top left pixel is (x, y). */
  at(b: number, c: number, x: number, y: number): number {
    const { columns, totals } = this.boxes[b]!;
    return totals[((y - this.top) * columns + x) * CHANNELS + c]!;
  }
}

// The last band filtered for each image. Pixels are judged row by row, so a band is filtered once.
const bands = new WeakMap<Pixels, Band>();

function band(pixels: Pixels, y: number): Band {
  const index = Math.floor(y / BAND);
  const cached = bands.get(pixels);
  if (cached?.index === index) return cached;
  const filtered = new Band(pixels, index);
  bands.set(pixels, filtered);
  return filtered;
}

/**
 * Whether, in every channel, `to`'s total over the `b`th size of box around (x, y) lies within
 * what a move of under a pixel in `from` leaves, give or take rounding.
 */
function moved(from: Band, to: Band, b: number, x: number, y: number): boolean {
  const { nx, ny } = from.boxes[b]!;
  const { width, height } = from.pixels;
  const slack = BOXES[b] === 1 ? PIXEL_SLACK : ROUNDING_LEVELS * nx * ny;
  channels: for (let c = 0; c < CHANNELS; c++) {
    for (const sx of SIGNS) {
      const x0 = place(x, nx, width, sx);
      for (const sy of SIGNS) {
        const y0 = place(y, ny, height, sy);
        if (x0 < 0 || y0 < 0) continue;
        const here = from.at(b, c, x0, y0);
        const across = from.at(b, c, x0 + sx, y0);
        const down = from.at(b, c, x0, y0 + sy);
        const both = from.at(b, c, x0 + sx, y0 + sy);
        const total = to.at(b, c, x0, y0);
        const lo = Math.min(here, across, down, both) - slack;
        const hi = Math.max(here, across, down, both) + slack;
        if (total >= lo && total <= hi) continue channels;
      }
    }
    return false;
  }
  return true;
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  // A side of one pixel: what a move along it would bring in is unknown.
  if (image.width < 2 || image.height < 2) return true;
  const before = band(image, y);
  const after = band(other, y);
  return BOXES.every((n, b) =>
    n === 1
      ? moved(before, after, b, x, y) && moved(after, before, b, x, y)
      : moved(before, after, b, x, y) || moved(after, before, b, x, y),
  );
}
