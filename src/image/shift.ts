import { blue, green, red, ROUNDING_LEVELS } from '../color/rgb.js';
import { contains } from './raster.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel is resampled between neighbours, so each image's colour at a
// pixel lies within the range of colours around the same place in the other image. A real change
// brings in colours that weren't there.
//
// Moving content also keeps its colour: over a window, the total of each channel changes only by
// what crosses the window's border. A uniform change, such as an overlay made a little more
// transparent over textured ground, stays within the range of colours nearby but changes that
// total everywhere at once, so it is not a shift.
//
// Near the image's border the window is moved inward rather than skipped, so the colour a move
// would carry in from beyond it is known. Only a side under three pixels long leaves it unknown;
// there any value is allowed, which in practice lets a move explain almost any change.

/** Half the side of the neighbourhood searched: 1 for 3×3. */
const RADIUS = 1;

/** Channel levels allowed outside the neighbourhood's range, for rounding in the resampling. */
const SLACK = 3;

/** Half the side of the window whose colour must be conserved: 2 for 5×5. */
const WINDOW_RADIUS = 2;

const WINDOW_SIDE = 2 * WINDOW_RADIUS + 1;

const MAX_CHANNEL = 255;

/** Whether each channel of `rgb` lies within the colours of `pixels` around (x, y). */
function inNeighbourhood(rgb: number, pixels: Pixels, x: number, y: number): boolean {
  // One pass over the neighbourhood for all three channels.
  let loR = MAX_CHANNEL;
  let loG = MAX_CHANNEL;
  let loB = MAX_CHANNEL;
  let hiR = 0;
  let hiG = 0;
  let hiB = 0;
  for (let ny = Math.max(0, y - RADIUS); ny <= Math.min(pixels.height - 1, y + RADIUS); ny++) {
    for (let nx = Math.max(0, x - RADIUS); nx <= Math.min(pixels.width - 1, x + RADIUS); nx++) {
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
  const within = (value: number, lo: number, hi: number) =>
    value >= lo - SLACK && value <= hi + SLACK;
  return within(red(rgb), loR, hiR) && within(green(rgb), loG, hiG) && within(blue(rgb), loB, hiB);
}

/**
 * The first and last index of the window along a side of `size` pixels, around `centre`. The
 * window is moved inward near the image's border, so that the pixel just beyond it on each side,
 * the colour a move would carry in, is in the image. A move conserves colour over any window, so
 * the test stays sound where the window no longer centres on the pixel. A side under three pixels
 * leaves no room for that: the window spans it, and what lies beyond is unknown.
 */
function span(centre: number, size: number): readonly [number, number] {
  if (size < 3) return [0, size - 1];
  const first = Math.max(1, Math.min(centre - WINDOW_RADIUS, size - 1 - WINDOW_SIDE));
  return [first, Math.min(size - 2, first + WINDOW_SIDE - 1)];
}

/** Red, green and blue totals over a window. */
type Totals = [number, number, number];

/** Where a colour would come from beyond the image's border, which is unknown. */
const BEYOND = -1;

const rgbOrBeyond = (pixels: Pixels, x: number, y: number): number =>
  contains(pixels, x, y) ? pixels.rgbAt(x, y) : BEYOND;

type Channel = typeof red;

/**
 * The most a move can change a channel by replacing `out`, inside the window, with `into`. A
 * colour from beyond the image is unknown and may be anything from 0 to 255.
 */
function crossing(into: number, out: number, channel: Channel): number {
  const level = channel(out);
  return into === BEYOND ? Math.max(level, MAX_CHANNEL - level) : Math.abs(channel(into) - level);
}

/**
 * Adds what a move can carry across the window along one row or column: moving one way brings in
 * `before` and takes out `last`; moving the other way brings in `after` and takes out `first`.
 */
function addLine(totals: Totals, before: number, first: number, last: number, after: number): void {
  totals[0] += Math.max(crossing(before, last, red), crossing(after, first, red));
  totals[1] += Math.max(crossing(before, last, green), crossing(after, first, green));
  totals[2] += Math.max(crossing(before, last, blue), crossing(after, first, blue));
}

/** The window over which a pixel's colour must be conserved, as [x0, y0, x1, y1]. */
type Window = readonly [number, number, number, number];

const reaches = (totals: Totals, need: Totals): boolean =>
  totals[0] >= need[0] && totals[1] >= need[1] && totals[2] >= need[2];

/**
 * Whether a move of under a pixel in `pixels` can carry `need` of each channel into or out of the
 * window from x0 to x1 and y0 to y1. What it can carry is summed into `carried` along each row and
 * each column, and the sum stops once it covers the need, since more would not change the answer.
 *
 * A move of (tx, ty), resampled bilinearly, changes the window's total by tx·A + ty·B + tx·ty·C,
 * where A sums the rows, B the columns, and C reaches the pixels diagonally beyond the window's
 * corners, which are not read. Bounding C from one image alone would take the row sum moved a row
 * up or down. The bound is taken from both images, though, and the moved image shows what C
 * carried in on its own border: 400,000 random bilinear moves found none that this rejects, while
 * adding C cost about a thousand counted pixels (6.5%) of the benchmark's faint overlay change.
 */
function carries(pixels: Pixels, [x0, y0, x1, y1]: Window, need: Totals, carried: Totals): boolean {
  carried.fill(0);
  const at = (x: number, y: number) => rgbOrBeyond(pixels, x, y);
  for (let y = y0; y <= y1; y++) {
    addLine(carried, at(x0 - 1, y), at(x0, y), at(x1, y), at(x1 + 1, y));
    if (reaches(carried, need)) return true;
  }
  for (let x = x0; x <= x1; x++) {
    addLine(carried, at(x, y0 - 1), at(x, y0), at(x, y1), at(x, y1 + 1));
    if (reaches(carried, need)) return true;
  }
  return false;
}

// Reused for every pixel, to spare an allocation each.
const needed: Totals = [0, 0, 0];
const carried: Totals = [0, 0, 0];

/**
 * Whether the colour in the window around (x, y) is conserved between the images, as a move of
 * under a pixel conserves it: each channel's total may change by no more than rounding and what a
 * move in either image can carry across the window's border. Most noise changes it by less than
 * rounding alone allows, so only then is the border measured, and the other image's only for the
 * channels the first image's border can't explain.
 */
function conserved(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const [x0, x1] = span(x, image.width);
  const [y0, y1] = span(y, image.height);

  let r = 0;
  let g = 0;
  let b = 0;
  for (let ny = y0; ny <= y1; ny++) {
    for (let nx = x0; nx <= x1; nx++) {
      const before = image.rgbAt(nx, ny);
      const after = other.rgbAt(nx, ny);
      r += red(after) - red(before);
      g += green(after) - green(before);
      b += blue(after) - blue(before);
    }
  }
  // Each pixel of the window may have rounded the other way. What's left is what a move would
  // have to carry across the border.
  const rounding = ROUNDING_LEVELS * (x1 - x0 + 1) * (y1 - y0 + 1);
  needed[0] = Math.abs(r) - rounding;
  needed[1] = Math.abs(g) - rounding;
  needed[2] = Math.abs(b) - rounding;
  if (needed[0] <= 0 && needed[1] <= 0 && needed[2] <= 0) return true;

  const window: Window = [x0, y0, x1, y1];
  if (carries(image, window, needed, carried)) return true;
  // The sum ran to the end, so it is exact: channels it explains need nothing more.
  for (let c = 0; c < 3; c++) if (carried[c]! >= needed[c]!) needed[c] = 0;
  return carries(other, window, needed, carried);
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  return (
    inNeighbourhood(image.rgbAt(x, y), other, x, y) &&
    inNeighbourhood(other.rgbAt(x, y), image, x, y) &&
    conserved(image, other, x, y)
  );
}
