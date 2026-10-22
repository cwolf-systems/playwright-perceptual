import { blue, green, red, ROUNDING_LEVELS } from '../color/rgb.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel is resampled between neighbours, so each image's colour at a
// pixel lies within the range of colours around the same place in the other image. A real change
// brings in colours that weren't there.
//
// Moving content also keeps its colour: over a window, the total of each channel changes only by
// what crosses the window's border. A uniform change, such as an overlay made a little more
// transparent over textured ground, stays within the range of colours nearby but changes that
// total everywhere at once, so it is not a shift.

/** Half the side of the neighbourhood searched: 1 for 3×3. */
const RADIUS = 1;

/** Channel levels allowed outside the neighbourhood's range, for rounding in the resampling. */
const SLACK = 3;

/** Half the side of the window whose colour must be conserved: 2 for 5×5. */
const WINDOW_RADIUS = 2;

const WINDOW_AREA = (2 * WINDOW_RADIUS + 1) ** 2;

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
 * The most of `channel` a move of under a pixel can carry into or out of the window from x0 to x1
 * and y0 to y1: along each row and each column, moving one way brings in the pixel before the
 * window and takes out the last one inside; moving the other way, the pixel after and the first.
 */
function throughput(
  channel: Channel,
  pixels: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
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
  x0: number,
  y0: number,
): boolean {
  // Each pixel of the window may have rounded the other way.
  const rounding = ROUNDING_LEVELS * WINDOW_AREA;
  if (Math.abs(change) <= rounding) return false;
  const x1 = x0 + 2 * WINDOW_RADIUS;
  const y1 = y0 + 2 * WINDOW_RADIUS;
  const carried = Math.max(
    throughput(channel, image, x0, y0, x1, y1),
    throughput(channel, other, x0, y0, x1, y1),
  );
  return Math.abs(change) > carried + rounding;
}

/**
 * Whether the colour in the window around (x, y) is conserved between the images, as a move of
 * under a pixel conserves it. Near the image's border what lies beyond is unknown, so the window
 * is not judged there.
 */
function conserved(image: Pixels, other: Pixels, x: number, y: number): boolean {
  const x0 = x - WINDOW_RADIUS;
  const y0 = y - WINDOW_RADIUS;
  const x1 = x + WINDOW_RADIUS;
  const y1 = y + WINDOW_RADIUS;
  if (x0 < 1 || y0 < 1 || x1 > image.width - 2 || y1 > image.height - 2) return true;

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
    unexplained(r, red, image, other, x0, y0) ||
    unexplained(g, green, image, other, x0, y0) ||
    unexplained(b, blue, image, other, x0, y0)
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
