import { overWhite, pack } from '../color/rgb.js';
import type { Pixels, RgbaImage } from './types.js';

const CHANNELS = 4;
const OPAQUE = 255;

/** Offsets of the eight neighbours of a pixel, as [dx, dy]. */
export const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export const contains = (pixels: Pixels, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < pixels.width && y < pixels.height;

export const onEdge = (pixels: Pixels, x: number, y: number): boolean =>
  x === 0 || y === 0 || x === pixels.width - 1 || y === pixels.height - 1;

/** Pixels of an RGBA image, with a word view for comparing whole pixels at once. */
export class Raster implements Pixels {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  /**
   * The pixels as 32-bit words, so two pixels can be tested for equality in one comparison.
   * Null when the bytes aren't aligned for a word view.
   */
  readonly words: Uint32Array | null;

  constructor(private readonly image: RgbaImage) {
    this.width = image.width;
    this.height = image.height;
    this.pixels = image.width * image.height;
    const { buffer, byteOffset } = image.data;
    this.words =
      byteOffset % CHANNELS === 0 ? new Uint32Array(buffer, byteOffset, this.pixels) : null;
  }

  /** The colour at a pixel index as 0xRRGGBB. */
  rgb(index: number): number {
    const d = this.image.data;
    const i = index * CHANNELS;
    const alpha = d[i + 3]!;
    if (alpha === OPAQUE) return pack(d[i]!, d[i + 1]!, d[i + 2]!);
    return pack(overWhite(d[i]!, alpha), overWhite(d[i + 1]!, alpha), overWhite(d[i + 2]!, alpha));
  }

  rgbAt(x: number, y: number): number {
    return this.rgb(y * this.width + x);
  }
}
