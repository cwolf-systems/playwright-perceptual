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
// - Its surroundings: over the 7×7 window around the pixel, the mean colour of one image matches
//   that of the other resampled bilinearly at one offset, in all three channels at once, within
//   rounding. Bilinear resampling predicts single pixels along a sharp edge only roughly, but it
//   moves the right amount of colour across the window, so the window's mean is reproduced.
//
// A real change adds or removes colour. A tint, a fainter overlay or a drift of two levels changes
// the window's mean, and no single offset makes up for that in all three channels, unless the
// window is a gradient that the offset slides along. A colour that was not nearby fails the first
// part. Beyond the border, resampling repeats the border's pixels, and a window at the border
// covers only what lies inside the image, so a panel a pixel high is judged like any other.

/** Half the side of the window: 3 for 7×7. */
const RADIUS = 3;

/**
 * Channel levels a pixel may lie outside its neighbourhood's range, besides half that range: the
 * slack 0.1.0 allowed for rounding in the resampling.
 */
const SLACK = 3;

/**
 * Levels per channel by which the window's mean may differ from the resampled one. Each rendering
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

/** Columns summed for a block: its own and RADIUS each side. */
const COLUMNS = BLOCK + 2 * RADIUS;

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
 * The sum of each channel over the 7×7 window around every pixel of a raster, clipped to the
 * image. A heavily changed image asks for the windows around most of its pixels, and summing each
 * afresh would read every pixel 49 times. They are computed a block of a row at a time, as
 * comparison reaches them.
 */
class WindowTotals {
  private readonly totals: Uint16Array;
  private readonly blocks: number;
  private readonly done: Uint8Array;
  /** Each block's column sums, and the row they were summed around. */
  private readonly columns: Uint16Array;
  private readonly columnRow: Int32Array;

  constructor(private readonly raster: Raster) {
    this.blocks = Math.ceil(raster.width / BLOCK);
    this.totals = new Uint16Array(raster.pixels * CHANNELS);
    this.done = new Uint8Array(raster.height * this.blocks);
    this.columns = new Uint16Array(this.blocks * COLUMNS * CHANNELS);
    this.columnRow = new Int32Array(this.blocks).fill(-2);
  }

  /** The totals, row by row and channel by channel, with those around (x, y) computed. */
  around(x: number, y: number): Uint16Array {
    for (let ny = y - 1; ny <= y + 1; ny++) {
      for (let block = Math.floor((x - 1) / BLOCK); block <= Math.floor((x + 1) / BLOCK); block++) {
        if (!this.done[ny * this.blocks + block]) this.fill(block, ny);
      }
    }
    return this.totals;
  }

  private fill(block: number, y: number): void {
    const width = this.raster.width;
    const x0 = block * BLOCK;
    const x1 = Math.min(width, x0 + BLOCK) - 1;
    // Column sums over the window's rows, from RADIUS left of the block to RADIUS right of it.
    // Comparison goes down the image, so the next row's sums usually differ from these only by
    // the row that enters the window and the row that leaves it.
    const left = Math.max(0, x0 - RADIUS);
    const right = Math.min(width - 1, x1 + RADIUS);
    const column = this.columns.subarray(block * COLUMNS * CHANNELS);
    // Only windows inside the image are asked for, so every row added lies in it.
    const addRow = (row: number, sign: number) => {
      for (let x = left; x <= right; x++) {
        const v = this.raster.rgb(row * width + x);
        const at = (x - left) * CHANNELS;
        column[at]! += sign * red(v);
        column[at + 1]! += sign * green(v);
        column[at + 2]! += sign * blue(v);
      }
    };
    if (this.columnRow[block] === y - 1) {
      addRow(y + RADIUS, 1);
      addRow(y - RADIUS - 1, -1);
    } else {
      column.fill(0, 0, COLUMNS * CHANNELS);
      for (let row = y - RADIUS; row <= y + RADIUS; row++) addRow(row, 1);
    }
    this.columnRow[block] = y;

    for (let c = 0; c < CHANNELS; c++) {
      // A running sum over the columns in the window.
      let sum = 0;
      for (let x = left; x < x0 + RADIUS && x <= right; x++)
        sum += column[(x - left) * CHANNELS + c]!;
      for (let x = x0; x <= x1; x++) {
        if (x + RADIUS <= right) sum += column[(x + RADIUS - left) * CHANNELS + c]!;
        if (x - RADIUS - 1 >= left) sum -= column[(x - RADIUS - 1 - left) * CHANNELS + c]!;
        this.totals[(y * width + x) * CHANNELS + c] = sum;
      }
    }
    this.done[y * this.blocks + block] = 1;
  }
}

const windowTotals = new WeakMap<Raster, WindowTotals>();

function totalsOf(raster: Raster): WindowTotals {
  let totals = windowTotals.get(raster);
  if (!totals) {
    totals = new WindowTotals(raster);
    windowTotals.set(raster, totals);
  }
  return totals;
}

/**
 * One image's sums of each channel over the window, and over the window moved by a pixel each
 * way: `at(i, j, c)` sums channel c over the window moved by (i, j). Reused for every pixel, to
 * spare an allocation each.
 */
class WindowSums {
  private readonly sums = new Float64Array(SHIFTS * SHIFTS * CHANNELS);
  /** Column sums for `measure`, by column, vertical move and channel. */
  private readonly columns = new Float64Array((2 * RADIUS + 3) * SHIFTS * CHANNELS);

  at(i: number, j: number, c: number): number {
    return this.sums[((j + 1) * SHIFTS + (i + 1)) * CHANNELS + c]!;
  }

  /** Takes the sums around (x, y) from a raster's window totals; for windows inside the image. */
  take(raster: Raster, x: number, y: number): void {
    const totals = totalsOf(raster).around(x, y);
    let n = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const at = ((y + j) * raster.width + x + i) * CHANNELS;
        this.sums[n++] = totals[at]!;
        this.sums[n++] = totals[at + 1]!;
        this.sums[n++] = totals[at + 2]!;
      }
    }
  }

  /**
   * Sums `pixels` over columns x0 to x1 and rows y0 to y1, and over the same moved by a pixel
   * each way, repeating the border's pixels beyond it. Each pixel is read once, into column sums
   * for the rows as they are and moved up and down, which then make the nine sums.
   */
  measure(pixels: Pixels, x0: number, y0: number, x1: number, y1: number): void {
    const { width, height } = pixels;
    const columns = this.columns;
    columns.fill(0);
    for (let k = 0; k < x1 - x0 + 3; k++) {
      const x = Math.min(Math.max(x0 - 1 + k, 0), width - 1);
      for (let y = y0 - 1; y <= y1 + 1; y++) {
        const v = pixels.rgbAt(x, Math.min(Math.max(y, 0), height - 1));
        // Row y belongs to the window moved by j if y - j is one of the window's rows.
        for (let j = -1; j <= 1; j++) {
          if (y - j < y0 || y - j > y1) continue;
          const at = (k * SHIFTS + j + 1) * CHANNELS;
          columns[at]! += red(v);
          columns[at + 1]! += green(v);
          columns[at + 2]! += blue(v);
        }
      }
    }
    this.sums.fill(0);
    for (let j = 0; j < SHIFTS; j++) {
      for (let i = 0; i < SHIFTS; i++) {
        // Moved by i - 1 along x: columns i to i + x1 - x0.
        const at = (j * SHIFTS + i) * CHANNELS;
        for (let k = i; k <= i + x1 - x0; k++) {
          const from = (k * SHIFTS + j) * CHANNELS;
          this.sums[at]! += columns[from]!;
          this.sums[at + 1]! += columns[from + 1]!;
          this.sums[at + 2]! += columns[from + 2]!;
        }
      }
    }
  }
}

const imageSums = new WindowSums();
const otherSums = new WindowSums();

/**
 * Whether resampling the image summed in `source` at some offset of up to a pixel each way gives
 * every channel of the window a total within `tolerance` of the window's total in `target`.
 *
 * In each quadrant, an offset of u towards x + i and v towards y + j, each from 0 to 1, resamples
 * the window's total bilinearly from the sums over the window moved by (0, 0), (i, 0), (0, j) and
 * (i, j). For a given u the total is linear in v, so each channel allows an interval of v, solved
 * exactly; an offset exists where, for some u tried, the three intervals overlap.
 */
function resamples(source: WindowSums, target: WindowSums, tolerance: number): boolean {
  // Resampling weighs the nine sums by weights that add up to one, so its total lies within their
  // range: most real changes end here.
  for (let c = 0; c < CHANNELS; c++) {
    const goal = target.at(0, 0, c);
    let below = false;
    let above = false;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        below ||= source.at(i, j, c) <= goal + tolerance;
        above ||= source.at(i, j, c) >= goal - tolerance;
      }
    }
    if (!below || !above) return false;
  }

  for (const j of [-1, 1]) {
    for (const i of [-1, 1]) {
      for (let step = 0; step <= STEPS; step++) {
        const u = step / STEPS;
        let low = 0;
        let high = 1;
        for (let c = 0; c < CHANNELS && low <= high; c++) {
          const goal = target.at(0, 0, c);
          // The resampled total less the goal, as a + b·v.
          const a = (1 - u) * source.at(0, 0, c) + u * source.at(i, 0, c) - goal;
          const b = (1 - u) * source.at(0, j, c) + u * source.at(i, j, c) - goal - a;
          if (b === 0) {
            if (Math.abs(a) > tolerance) high = -1;
          } else {
            const v0 = (-tolerance - a) / b;
            const v1 = (tolerance - a) / b;
            low = Math.max(low, Math.min(v0, v1));
            high = Math.min(high, Math.max(v0, v1));
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
  const x0 = Math.max(0, x - RADIUS);
  const y0 = Math.max(0, y - RADIUS);
  const x1 = Math.min(image.width - 1, x + RADIUS);
  const y1 = Math.min(image.height - 1, y + RADIUS);
  // Away from the border, the window moved by a pixel stays inside the image, and its sums are
  // the window totals around the neighbouring pixels.
  if (
    image instanceof Raster &&
    other instanceof Raster &&
    x0 > 0 &&
    y0 > 0 &&
    x1 < image.width - 1 &&
    y1 < image.height - 1
  ) {
    imageSums.take(image, x, y);
    otherSums.take(other, x, y);
  } else {
    imageSums.measure(image, x0, y0, x1, y1);
    otherSums.measure(other, x0, y0, x1, y1);
  }
  const tolerance = TOLERANCE * (x1 - x0 + 1) * (y1 - y0 + 1);
  // Either rendering may be the sharper, so the offset is sought both ways.
  return resamples(imageSums, otherSums, tolerance) || resamples(otherSums, imageSums, tolerance);
}
