import { blue, green, red } from '../color/rgb.js';
import type { Pixels } from './types.js';

// Content moved by less than a pixel is resampled between neighbours, so each image's colour at a
// pixel lies within the range of colours around the same place in the other image. A real change
// brings in colours that weren't there.

/** Half the side of the neighbourhood searched: 1 for 3×3. */
const RADIUS = 1;

/** Channel levels allowed outside the neighbourhood's range, for rounding in the resampling. */
const SLACK = 3;

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

/** Whether pixel (x, y) differs only because content moved by less than a pixel. */
export function isShifted(image: Pixels, other: Pixels, x: number, y: number): boolean {
  return (
    inNeighbourhood(image.rgbAt(x, y), other, x, y) &&
    inNeighbourhood(other.rgbAt(x, y), image, x, y)
  );
}
