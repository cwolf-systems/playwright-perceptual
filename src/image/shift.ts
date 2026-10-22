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

const CHANNELS = [red, green, blue] as const;

type Channel = (typeof CHANNELS)[number];

function inRange(channel: Channel, value: number, pixels: Pixels, x: number, y: number): boolean {
  let lo = MAX_CHANNEL;
  let hi = 0;
  for (let ny = Math.max(0, y - RADIUS); ny <= Math.min(pixels.height - 1, y + RADIUS); ny++) {
    for (let nx = Math.max(0, x - RADIUS); nx <= Math.min(pixels.width - 1, x + RADIUS); nx++) {
      const v = channel(pixels.rgbAt(nx, ny));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return value >= lo - SLACK && value <= hi + SLACK;
}

/** Whether `rgb` lies within the colours of `pixels` around (x, y), channel by channel. */
function inNeighbourhood(rgb: number, pixels: Pixels, x: number, y: number): boolean {
  for (const channel of CHANNELS) {
    if (!inRange(channel, channel(rgb), pixels, x, y)) return false;
  }
  return true;
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

/** A channel's value at (x, y), or `undefined` beyond the image. */
const valueAt = (channel: Channel, pixels: Pixels, x: number, y: number): number | undefined =>
  contains(pixels, x, y) ? channel(pixels.rgbAt(x, y)) : undefined;

/**
 * The most a move can change a channel by replacing `out`, inside the window, with `into`. A value
 * beyond the image is unknown and may be anything from 0 to 255.
 */
const step = (into: number | undefined, out: number): number =>
  into === undefined ? Math.max(out, MAX_CHANNEL - out) : Math.abs(into - out);

/**
 * The most of `channel` a move of under a pixel can carry into or out of the window from x0 to x1
 * and y0 to y1: along each row and each column, moving one way brings in the pixel before the
 * window and takes out the last one inside; moving the other way, the pixel after and the first.
 *
 * A move of (tx, ty), resampled bilinearly, changes the window's total by tx·A + ty·B + tx·ty·C,
 * where A sums the rows, B the columns, and C reaches the pixels diagonally beyond the window's
 * corners, which are not read. Bounding C from one image alone would take the row sum moved a row
 * up or down. The bound is taken from both images, though, and the moved image shows what C
 * carried in on its own border: 400,000 random bilinear moves found none that this rejects, while
 * adding C cost about a thousand counted pixels (6.5%) of the benchmark's faint overlay change.
 */
function throughput(
  channel: Channel,
  pixels: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  if (x0 < 1 || y0 < 1 || x1 > pixels.width - 2 || y1 > pixels.height - 2) {
    return throughputBeyond(channel, pixels, x0, y0, x1, y1);
  }
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    const before = channel(pixels.rgbAt(x0 - 1, y));
    const first = channel(pixels.rgbAt(x0, y));
    const last = channel(pixels.rgbAt(x1, y));
    const after = channel(pixels.rgbAt(x1 + 1, y));
    total += Math.max(Math.abs(before - last), Math.abs(after - first));
  }
  for (let x = x0; x <= x1; x++) {
    const before = channel(pixels.rgbAt(x, y0 - 1));
    const first = channel(pixels.rgbAt(x, y0));
    const last = channel(pixels.rgbAt(x, y1));
    const after = channel(pixels.rgbAt(x, y1 + 1));
    total += Math.max(Math.abs(before - last), Math.abs(after - first));
  }
  return total;
}

/** `throughput` for a window whose margin reaches beyond the image, on a side under 3 pixels. */
function throughputBeyond(
  channel: Channel,
  pixels: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const at = (x: number, y: number) => valueAt(channel, pixels, x, y);
  const inside = (x: number, y: number) => channel(pixels.rgbAt(x, y));
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    total += Math.max(step(at(x0 - 1, y), inside(x1, y)), step(at(x1 + 1, y), inside(x0, y)));
  }
  for (let x = x0; x <= x1; x++) {
    total += Math.max(step(at(x, y0 - 1), inside(x, y1)), step(at(x, y1 + 1), inside(x, y0)));
  }
  return total;
}

/** The window over which a pixel's colour must be conserved, as [x0, y0, x1, y1]. */
type Window = readonly [number, number, number, number];

/**
 * Whether a channel's total over the window changed by more than rounding and a move of under a
 * pixel in either image can explain. Most noise changes it by less than rounding alone allows, so
 * only then is the border measured.
 */
function unexplained(
  change: number,
  channel: Channel,
  image: Pixels,
  other: Pixels,
  [x0, y0, x1, y1]: Window,
): boolean {
  // Each pixel of the window may have rounded the other way.
  const rounding = ROUNDING_LEVELS * (x1 - x0 + 1) * (y1 - y0 + 1);
  if (Math.abs(change) <= rounding) return false;
  const carried = Math.max(
    throughput(channel, image, x0, y0, x1, y1),
    throughput(channel, other, x0, y0, x1, y1),
  );
  return Math.abs(change) > carried + rounding;
}

/**
 * Whether the colour in the window around (x, y) is conserved between the images, as a move of
 * under a pixel conserves it.
 */
function conserved(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const [x0, x1] = span(x, image.width);
  const [y0, y1] = span(y, image.height);
  const window: Window = [x0, y0, x1, y1];

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
  return !(
    unexplained(r, red, image, other, window) ||
    unexplained(g, green, image, other, window) ||
    unexplained(b, blue, image, other, window)
  );
}

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  return (
    inNeighbourhood(image.rgbAt(x, y), other, x, y) &&
    inNeighbourhood(other.rgbAt(x, y), image, x, y) &&
    conserved(image, other, x, y)
  );
}
