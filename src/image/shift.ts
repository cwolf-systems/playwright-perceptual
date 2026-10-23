import { blue, green, red, ROUNDING_LEVELS, withinLevels } from '../color/rgb.js';
import { type ChannelSums, sumsOf } from './sums.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel is resampled between neighbours, so each image's colour at a
// pixel lies within the range of colours around the same place in the other image. A real change
// brings in colours that weren't there.
//
// Moving content also keeps its colour: over a window, the total of each channel changes only by
// what the move carries across the window's border. A move of (a, b), under a pixel each way and
// resampled bilinearly, changes a channel's total by a·H + b·V + a·b·C: H is what the column the
// move brings in adds, less the column it pushes out; V the same for rows; C a correction at the
// corner. One move moves all three channels, so a pixel is shifted only if a single move explains
// every channel's change at once, give or take a level per pixel for rounding. The test is asked
// of each image in turn, as the one that moved: a rasteriser that draws content at an offset makes
// neither image a resampling of the other.
//
// A uniform change of colour, such as an overlay made a little more transparent over textured
// ground, stays within the range of colours nearby. It changes every channel's total, but in the
// proportions of the overlay's colour, not in those of the edges nearby, so no single move
// explains it.
//
// Near the image's border the window is moved inward, so what a move carries in is in the image.
// A side under three pixels leaves no room for that, and the image's edge is taken to continue
// beyond it.

/** Half the side of the neighbourhood searched: 1 for 3×3. */
const RADIUS = 1;

/** Channel levels allowed outside the neighbourhood's range, for rounding in the resampling. */
const SLACK = 3;

/** Half the side of the window whose colour must be conserved: 2 for 5×5. */
const WINDOW_RADIUS = 2;

const WINDOW_SIDE = 2 * WINDOW_RADIUS + 1;

const CHANNELS = [red, green, blue] as const;

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
 * The first (`end` 0) or last (`end` 1) index of the window along a side of `size` pixels,
 * around `centre`. The
 * window is moved inward near the image's border, so that the pixel just beyond it on each side,
 * the colour a move would carry in, is in the image. A move conserves colour over any window, so
 * the test stays sound where the window no longer centres on the pixel. A side under three pixels
 * leaves no room for that: the window spans it.
 */
function span(centre: number, size: number, end: 0 | 1): number {
  if (size < 3) return end * (size - 1);
  const first = Math.max(1, Math.min(centre - WINDOW_RADIUS, size - 1 - WINDOW_SIDE));
  return end === 0 ? first : Math.min(size - 2, first + WINDOW_SIDE - 1);
}

/**
 * A move of (a, b) pixels, each from 0 to 1, in one of four diagonal directions, resampled
 * bilinearly, changes a channel's total over the window by a·H + b·V + a·b·C. H is what the move
 * carries in across the window's side: the column it brings in less the column it pushes out. V is
 * the same for rows. C corrects for the corner: the pixel diagonally beyond the window, less the
 * pixels beside it on the column and the row brought in, plus the corner pixel pushed out.
 *
 * Kept per direction and channel, at 3·direction + channel. Directions: right and down, right and
 * up, left and down, left and up.
 */
const H = new Float64Array(12);
const V = new Float64Array(12);
const C = new Float64Array(12);
const corners = new Int32Array(16);

/** Steps across a move's horizontal part when looking for one that explains a change. */
const STEPS = 16;

/**
 * Whether a move (a, b) in direction `d`, both from 0 to 1, brings a·H + b·V + a·b·C within
 * `rounding` of `change` in every channel. a is tried in steps, and for each the values of b that
 * every channel allows are found exactly. Between steps a channel's total moves by at most half a
 * step times |H| + |C|, which each channel's allowance takes in, so no move that explains the
 * change is missed.
 */
function reachable(d: number, change: Float64Array, rounding: number): boolean {
  for (let step = 0; step < STEPS; step++) {
    const a = (step + 0.5) / STEPS;
    let low = 0;
    let high = 1;
    for (let c = 0; c < 3 && low <= high; c++) {
      const i = 3 * d + c;
      const allowed = rounding + (Math.abs(H[i]!) + Math.abs(C[i]!)) / (2 * STEPS);
      // b·slope must lie within `allowed` of what the horizontal part leaves.
      const slope = V[i]! + a * C[i]!;
      const rest = change[c]! - a * H[i]!;
      if (slope === 0) {
        if (Math.abs(rest) > allowed) high = -1;
      } else {
        const one = (rest - allowed) / slope;
        const other = (rest + allowed) / slope;
        low = Math.max(low, Math.min(one, other));
        high = Math.min(high, Math.max(one, other));
      }
    }
    if (low <= high) return true;
  }
  return false;
}

/**
 * Whether a move of under a pixel in `moved`, whose sums are `sums`, explains `change` within
 * rounding. Channel by channel, a direction is dropped once the channel cannot reach its change
 * even alone: a·H + b·V + a·b·C lies between its values at the unit square's corners. Most real
 * changes are refused there, before the other channels are measured.
 */
function explains(
  moved: Pixels,
  sums: ChannelSums,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  change: Float64Array,
  rounding: number,
): boolean {
  // The column or row a move brings in; beyond a side under three pixels, the image's edge is
  // taken to continue.
  const before = Math.max(0, x0 - 1);
  const after = Math.min(moved.width - 1, x1 + 1);
  const above = Math.max(0, y0 - 1);
  const below = Math.min(moved.height - 1, y1 + 1);
  // The four pixels of each direction's corner term, read once for all three channels: the one
  // diagonally beyond the window, the ones beside it on the row and column pushed out, and the
  // corner pushed out.
  for (let d = 0; d < 4; d++) {
    const inX = d < 2 ? before : after;
    const outX = d < 2 ? x1 : x0;
    const inY = d % 2 === 0 ? above : below;
    const outY = d % 2 === 0 ? y1 : y0;
    corners[4 * d] = moved.rgbAt(inX, inY);
    corners[4 * d + 1] = moved.rgbAt(outX, inY);
    corners[4 * d + 2] = moved.rgbAt(inX, outY);
    corners[4 * d + 3] = moved.rgbAt(outX, outY);
  }
  let open = 0b1111;
  for (let c = 0; c < 3; c++) {
    const channel = CHANNELS[c]!;
    // Rightwards a move brings in the column before the window and pushes out its last;
    // leftwards, the column after and its first. Rows the same, down and up.
    const rightwards = sums.total(c, before, y0, before, y1) - sums.total(c, x1, y0, x1, y1);
    const leftwards = sums.total(c, after, y0, after, y1) - sums.total(c, x0, y0, x0, y1);
    const downwards = sums.total(c, x0, above, x1, above) - sums.total(c, x0, y1, x1, y1);
    const upwards = sums.total(c, x0, below, x1, below) - sums.total(c, x0, y0, x1, y0);
    for (let d = 0; d < 4; d++) {
      if ((open & (1 << d)) === 0) continue;
      const i = 3 * d + c;
      const h = (H[i] = d < 2 ? rightwards : leftwards);
      const v = (V[i] = d % 2 === 0 ? downwards : upwards);
      const k = (C[i] =
        channel(corners[4 * d]!) -
        channel(corners[4 * d + 1]!) -
        channel(corners[4 * d + 2]!) +
        channel(corners[4 * d + 3]!));
      // Between its values at the unit square's corners: 0, h, v and h + v + k.
      const lowest = Math.min(0, h, v, h + v + k);
      const highest = Math.max(0, h, v, h + v + k);
      if (change[c]! + rounding < lowest || change[c]! - rounding > highest) open &= ~(1 << d);
    }
    if (open === 0) return false;
  }
  for (let d = 0; d < 4; d++) {
    if ((open & (1 << d)) !== 0 && reachable(d, change, rounding)) return true;
  }
  return false;
}

/** Each channel's change over the window, and the same reversed. */
const change = new Float64Array(3);
const back = new Float64Array(3);

/**
 * Whether the colour in the window around (x, y) changed only as a move of under a pixel, in one
 * image or the other, changes it. Exported for the tests. Most noise changes no channel's total by more than rounding
 * alone allows, so only then is a move looked for.
 */
export function conserved(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const x0 = span(x, image.width, 0);
  const x1 = span(x, image.width, 1);
  const y0 = span(y, image.height, 0);
  const y1 = span(y, image.height, 1);
  const before = sumsOf(image);
  const after = sumsOf(other);
  // Each pixel of the window may have rounded the other way.
  const rounding = ROUNDING_LEVELS * (x1 - x0 + 1) * (y1 - y0 + 1);
  let small = true;
  for (let c = 0; c < 3; c++) {
    change[c] = after.total(c, x0, y0, x1, y1) - before.total(c, x0, y0, x1, y1);
    back[c] = -change[c]!;
    if (Math.abs(change[c]!) > rounding) small = false;
  }
  if (small) return true;
  // `other` is `image` moved, or `image` is `other` moved back.
  return (
    explains(image, before, x0, y0, x1, y1, change, rounding) ||
    explains(other, after, x0, y0, x1, y1, back, rounding)
  );
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const before = image.rgbAt(x, y);
  const after = other.rgbAt(x, y);
  // Each colour is in its own neighbourhood, so two within the slack are each within the other's.
  const near =
    withinLevels(before, after, SLACK) ||
    (inNeighbourhood(before, other, x, y) && inNeighbourhood(after, image, x, y));
  return near && conserved(image, other, x, y);
}
