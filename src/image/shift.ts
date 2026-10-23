import { blue, green, red } from '../color/rgb.js';
import { Raster } from './raster.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel is the same image resampled at an offset. A changed pixel
// counts as such a move if resampling one image at some offset of up to a pixel each way
// reproduces the other around it, judged in two parts:
//
// - The pixel itself: each image's colour lies within the range of colours in the 3×3
//   neighbourhood of the same place in the other, since resampling only mixes neighbours. A
//   rasteriser covers a sharp edge more sharply than bilinear resampling mixes it, by up to half
//   the neighbourhood's range, and each rendering rounds; so much is allowed beyond the range.
// - Its surroundings: one offset makes the mean colour of a window in one image match that of the
//   other resampled bilinearly, in all three channels at once and within rounding, for two windows:
//   7×7 around the pixel, and 65×65 holding it. Bilinear resampling predicts single pixels along a
//   sharp edge only roughly, but it moves the right amount of colour across a window's border, so
//   a window's mean is reproduced.
//
// A real change adds or removes colour. A tint, a fainter overlay or a drift of a couple of levels
// changes a window's mean, and no offset makes up for it in all three channels at once unless the
// window is a gradient that the offset slides along. Over a small window much of a textured image
// is such a gradient. Over the large one it rarely is, since texture rises and falls: there a move
// carries as much colour in as out, and the drift remains. A colour that was not nearby fails the
// first part.
//
// Beyond the image's border, resampling repeats the border's pixels. The small window covers only
// what lies inside the image, so a panel a pixel high is judged like any other. The large window
// is moved inward at the border, so it and its moves by a pixel lie inside the image; an image
// too small to hold it is judged by the small window alone.

/** Half the side of the small window: 3 for 7×7. */
const NEAR = 3;

/** Half the side of the large window: 32 for 65×65. */
const FAR = 32;

/**
 * Channel levels a pixel may lie outside its neighbourhood's range, besides half that range: the
 * slack 0.1.0 allowed for rounding in the resampling.
 */
const SLACK = 3;

/**
 * Levels per channel by which a window's mean may differ from the resampled one. Each rendering
 * rounds to the nearest of 256 levels, which accounts for one; renderings of the same scene through
 * the GPU and in software need a little more.
 */
const TOLERANCE = 1.15;

/** Offsets tried along x in each quadrant, in fractions of a pixel; y is solved exactly. */
const STEPS = 16;

/** Windows moved by -1, 0 and +1 along each axis. */
const SHIFTS = 3;
const CHANNELS = 3;

/** Columns of window totals computed at a time. */
const BLOCK = 32;

/** Rows of window totals kept: the three a pixel's sums read, and one more. */
const ROWS = 4;

/** Whether each channel of `rgb` lies within the colours of `pixels` around (x, y), widened. */
function inNeighbourhood(rgb: number, pixels: Pixels, x: number, y: number): boolean {
  // One pass over the neighbourhood for all three channels.
  let loR = 255;
  let loG = 255;
  let loB = 255;
  let hiR = 0;
  let hiG = 0;
  let hiB = 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(pixels.height - 1, y + 1); ny++) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(pixels.width - 1, x + 1); nx++) {
      const v = pixels.rgbAt(nx, ny);
      const r = red(v);
      const g = green(v);
      const b = blue(v);
      if (r < loR) loR = r;
      if (r > hiR) hiR = r;
      if (g < loG) loG = g;
      if (g > hiG) hiG = g;
      if (b < loB) loB = b;
      if (b > hiB) hiB = b;
    }
  }
  const within = (value: number, lo: number, hi: number) => {
    const allowed = SLACK + (hi - lo) / 2;
    return value >= lo - allowed && value <= hi + allowed;
  };
  return within(red(rgb), loR, hiR) && within(green(rgb), loG, hiG) && within(blue(rgb), loB, hiB);
}

/**
 * The sum of each channel over the window around each pixel of a raster, for windows inside the
 * image. A heavily changed image asks for the windows around most of its pixels, and summing each
 * afresh would read every pixel thousands of times. They are computed a block of a row at a time,
 * as comparison reaches them, and only the last few rows are kept.
 */
class WindowTotals {
  private readonly span: number;
  private readonly blocks: number;
  /** Totals for ROWS rows, row r in slot r % ROWS, by column and channel. */
  private readonly totals: Uint32Array;
  /** The row each slot holds, and which of its blocks are computed. */
  private readonly slotRow = new Int32Array(ROWS).fill(-1);
  private readonly done: Uint8Array;
  /**
   * Each block's column sums over the window's rows, and the row they were summed around: -1 for
   * none yet.
   */
  private readonly columns: Uint32Array;
  private readonly columnRow: Int32Array;

  constructor(
    private readonly raster: Raster,
    private readonly radius: number,
  ) {
    this.span = BLOCK + 2 * radius;
    this.blocks = Math.ceil(raster.width / BLOCK);
    this.totals = new Uint32Array(ROWS * raster.width * CHANNELS);
    this.done = new Uint8Array(ROWS * this.blocks);
    this.columns = new Uint32Array(this.blocks * this.span * CHANNELS);
    this.columnRow = new Int32Array(this.blocks).fill(-1);
  }

  /** Computes the totals for rows y - 1 to y + 1 and columns x - 1 to x + 1. */
  private prepare(x: number, y: number): void {
    for (let row = y - 1; row <= y + 1; row++) {
      const slot = row % ROWS;
      if (this.slotRow[slot] !== row) {
        this.slotRow[slot] = row;
        this.done.fill(0, slot * this.blocks, (slot + 1) * this.blocks);
      }
      for (let block = Math.floor((x - 1) / BLOCK); block <= Math.floor((x + 1) / BLOCK); block++) {
        if (!this.done[slot * this.blocks + block]) this.fill(block, row);
      }
    }
  }

  /**
   * Writes the totals around (x, y) and its eight neighbours into `into` from `offset`, by move
   * and channel. The window around each must lie inside the image.
   */
  read(x: number, y: number, into: Float64Array, offset: number): void {
    this.prepare(x, y);
    let n = offset;
    for (let j = -1; j <= 1; j++) {
      const row = ((y + j) % ROWS) * this.raster.width;
      for (let i = -1; i <= 1; i++) {
        const at = (row + x + i) * CHANNELS;
        into[n++] = this.totals[at]!;
        into[n++] = this.totals[at + 1]!;
        into[n++] = this.totals[at + 2]!;
      }
    }
  }

  private fill(block: number, y: number): void {
    const width = this.raster.width;
    const radius = this.radius;
    const x0 = block * BLOCK;
    const x1 = Math.min(width, x0 + BLOCK) - 1;
    // Column sums over the window's rows, from the radius left of the block to the radius right
    // of it, as far as the image goes. Comparison goes down the image, so the next row's sums
    // usually differ from these only by the rows that enter the window and the rows that leave.
    const left = Math.max(0, x0 - radius);
    const right = Math.min(width - 1, x1 + radius);
    const column = this.columns.subarray(block * this.span * CHANNELS);
    const addRow = (row: number, sign: number) => {
      for (let x = left; x <= right; x++) {
        const v = this.raster.rgb(row * width + x);
        const at = (x - left) * CHANNELS;
        column[at]! += sign * red(v);
        column[at + 1]! += sign * green(v);
        column[at + 2]! += sign * blue(v);
      }
    };
    const last = this.columnRow[block]!;
    if (last >= 0 && last < y && y - last <= 2 * radius) {
      for (let row = last + radius + 1; row <= y + radius; row++) addRow(row, 1);
      for (let row = last - radius; row < y - radius; row++) addRow(row, -1);
    } else {
      column.fill(0, 0, this.span * CHANNELS);
      for (let row = y - radius; row <= y + radius; row++) addRow(row, 1);
    }
    this.columnRow[block] = y;

    const slot = y % ROWS;
    for (let c = 0; c < CHANNELS; c++) {
      // A running sum over the columns in the window. Columns whose window leaves the image are
      // summed too, clipped, but never read.
      let sum = 0;
      for (let x = left; x < x0 + radius && x <= right; x++)
        sum += column[(x - left) * CHANNELS + c]!;
      for (let x = x0; x <= x1; x++) {
        if (x + radius <= right) sum += column[(x + radius - left) * CHANNELS + c]!;
        if (x - radius - 1 >= left) sum -= column[(x - radius - 1 - left) * CHANNELS + c]!;
        this.totals[(slot * width + x) * CHANNELS + c] = sum;
      }
    }
    this.done[slot * this.blocks + block] = 1;
  }
}

const windowTotals = new WeakMap<Raster, WindowTotals[]>();

/** A raster's window totals for the small window or the large one, by its half side. */
function totalsOf(raster: Raster, radius: number): WindowTotals {
  let totals = windowTotals.get(raster);
  if (!totals) {
    totals = [new WindowTotals(raster, NEAR), new WindowTotals(raster, FAR)];
    windowTotals.set(raster, totals);
  }
  return totals[radius === NEAR ? 0 : 1]!;
}

/** Sums for a window: by move (i, j) and channel, at ((j + 1) * 3 + i + 1) * 3 + c. */
const WINDOW = SHIFTS * SHIFTS * CHANNELS;

// Each image's sums over the windows judged, the large one first where the image holds it, and
// each window's tolerance. Reused for every pixel, to spare an allocation each.
const imageSums = new Float64Array(2 * WINDOW);
const otherSums = new Float64Array(2 * WINDOW);
const tolerances = new Float64Array(2);
const columns = new Float64Array((2 * FAR + 3) * SHIFTS * CHANNELS);

/** Where a window's sum over channel c, moved by (i, j), is kept. */
const at = (window: number, i: number, j: number, c: number): number =>
  window * WINDOW + ((j + 1) * SHIFTS + i + 1) * CHANNELS + c;

/**
 * Sums `pixels` over columns x0 to x1 and rows y0 to y1, and over the same moved by a pixel each
 * way, repeating the border's pixels beyond it, into `into` from `offset`. Each pixel is read
 * once, into column sums for the rows as they are and moved up and down, which then make the nine
 * sums.
 */
function measure(
  pixels: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  into: Float64Array,
  offset: number,
): void {
  const { width, height } = pixels;
  columns.fill(0);
  for (let k = 0; k < x1 - x0 + 3; k++) {
    const x = Math.min(Math.max(x0 - 1 + k, 0), width - 1);
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      const v = pixels.rgbAt(x, Math.min(Math.max(y, 0), height - 1));
      // Row y belongs to the window moved by j if y - j is one of the window's rows.
      for (let j = -1; j <= 1; j++) {
        if (y - j < y0 || y - j > y1) continue;
        const column = (k * SHIFTS + j + 1) * CHANNELS;
        columns[column]! += red(v);
        columns[column + 1]! += green(v);
        columns[column + 2]! += blue(v);
      }
    }
  }
  into.fill(0, offset, offset + WINDOW);
  for (let j = 0; j < SHIFTS; j++) {
    for (let i = 0; i < SHIFTS; i++) {
      // Moved by i - 1 along x: columns i to i + x1 - x0.
      const sum = offset + (j * SHIFTS + i) * CHANNELS;
      for (let k = i; k <= i + x1 - x0; k++) {
        const column = (k * SHIFTS + j) * CHANNELS;
        into[sum]! += columns[column]!;
        into[sum + 1]! += columns[column + 1]!;
        into[sum + 2]! += columns[column + 2]!;
      }
    }
  }
}

/**
 * Sums both images over a window, columns x0 to x1 and rows y0 to y1: from window totals where the
 * window and its moves lie inside the image, else pixel by pixel.
 */
function sum(
  window: number,
  image: Pixels,
  other: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const offset = window * WINDOW;
  if (
    image instanceof Raster &&
    other instanceof Raster &&
    x0 > 0 &&
    y0 > 0 &&
    x1 < image.width - 1 &&
    y1 < image.height - 1
  ) {
    const radius = (x1 - x0) / 2;
    totalsOf(image, radius).read((x0 + x1) / 2, (y0 + y1) / 2, imageSums, offset);
    totalsOf(other, radius).read((x0 + x1) / 2, (y0 + y1) / 2, otherSums, offset);
  } else {
    measure(image, x0, y0, x1, y1, imageSums, offset);
    measure(other, x0, y0, x1, y1, otherSums, offset);
  }
  tolerances[window] = TOLERANCE * (x1 - x0 + 1) * (y1 - y0 + 1);
}

/**
 * Whether resampling within the quadrant towards (i, j) can reach each window's goal in every
 * channel. It weighs the sums at the quadrant's four corners by weights that add up to one, so it
 * stays within their range.
 */
function reaches(
  source: Float64Array,
  target: Float64Array,
  windows: number,
  i: number,
  j: number,
): boolean {
  for (let w = 0; w < windows; w++) {
    for (let c = 0; c < CHANNELS; c++) {
      const goal = target[at(w, 0, 0, c)]!;
      const a = source[at(w, 0, 0, c)]!;
      const b = source[at(w, i, 0, c)]!;
      const d = source[at(w, 0, j, c)]!;
      const e = source[at(w, i, j, c)]!;
      if (
        Math.min(a, b, d, e) > goal + tolerances[w]! ||
        Math.max(a, b, d, e) < goal - tolerances[w]!
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Whether resampling in some quadrant can reach the large window's goals. */
function reachable(source: Float64Array, target: Float64Array): boolean {
  for (const j of [-1, 1]) {
    for (const i of [-1, 1]) if (reaches(source, target, 1, i, j)) return true;
  }
  return false;
}

/**
 * Whether resampling the image summed in `source` at some offset of up to a pixel each way gives
 * every channel of each window a total within its tolerance of the window's total in `target`.
 *
 * In each quadrant, an offset of u towards x + i and v towards y + j, each from 0 to 1, resamples
 * a window's total bilinearly from the sums over the window moved by (0, 0), (i, 0), (0, j) and
 * (i, j). For a given u the total is linear in v, so each channel of each window allows an
 * interval of v, solved exactly; an offset exists where, for some u tried, the intervals overlap.
 */
function resamples(source: Float64Array, target: Float64Array, windows: number): boolean {
  for (const j of [-1, 1]) {
    for (const i of [-1, 1]) {
      if (!reaches(source, target, windows, i, j)) continue;
      for (let step = 0; step <= STEPS; step++) {
        const u = step / STEPS;
        let low = 0;
        let high = 1;
        for (let w = 0; w < windows && low <= high; w++) {
          const tolerance = tolerances[w]!;
          for (let c = 0; c < CHANNELS && low <= high; c++) {
            const goal = target[at(w, 0, 0, c)]!;
            // The resampled total less the goal, as a + b·v.
            const a = (1 - u) * source[at(w, 0, 0, c)]! + u * source[at(w, i, 0, c)]! - goal;
            const b = (1 - u) * source[at(w, 0, j, c)]! + u * source[at(w, i, j, c)]! - goal - a;
            if (b === 0) {
              if (Math.abs(a) > tolerance) high = -1;
            } else {
              const v0 = (-tolerance - a) / b;
              const v1 = (tolerance - a) / b;
              low = Math.max(low, Math.min(v0, v1));
              high = Math.min(high, Math.max(v0, v1));
            }
          }
        }
        if (low <= high) return true;
      }
    }
  }
  return false;
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  if (
    !inNeighbourhood(image.rgbAt(x, y), other, x, y) ||
    !inNeighbourhood(other.rgbAt(x, y), image, x, y)
  ) {
    return false;
  }
  const { width, height } = image;
  // The large window first: over a drift or a tint across an area, its colour changed by more
  // than any move could carry across its border, and the small window need not be read.
  let windows = 0;
  if (width >= 2 * FAR + 3 && height >= 2 * FAR + 3) {
    // The large window holding the pixel, moved inward until it and its moves by a pixel fit.
    const cx = Math.min(Math.max(x, FAR + 1), width - FAR - 2);
    const cy = Math.min(Math.max(y, FAR + 1), height - FAR - 2);
    sum(0, image, other, cx - FAR, cy - FAR, cx + FAR, cy + FAR);
    if (!reachable(imageSums, otherSums) && !reachable(otherSums, imageSums)) return false;
    windows = 1;
  }
  sum(
    windows,
    image,
    other,
    Math.max(0, x - NEAR),
    Math.max(0, y - NEAR),
    Math.min(width - 1, x + NEAR),
    Math.min(height - 1, y + NEAR),
  );
  windows++;
  // Either rendering may be the sharper, so the offset is sought both ways.
  return resamples(imageSums, otherSums, windows) || resamples(otherSums, imageSums, windows);
}
