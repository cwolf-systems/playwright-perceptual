import { overWhite, pack } from '../color/rgb.js';
import type { Pixels, RgbaImage } from './types.js';

const CHANNELS = 4;
const OPAQUE = 255;

/** Pixels converted at a time: 2^12. */
const BAND_BITS = 12;
const BAND_MASK = (1 << BAND_BITS) - 1;

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

  /**
   * Colours as 0xRRGGBB, blended over white, converted a band of pixels at a time when first read:
   * the noise detectors read each changed pixel's neighbours many times over.
   */
  private readonly bands: (Int32Array | undefined)[] = [];

  /** The colour at a pixel index as 0xRRGGBB. */
  rgb(index: number): number {
    const band = this.bands[index >> BAND_BITS] ?? this.convert(index >> BAND_BITS);
    return band[index & BAND_MASK]!;
  }

  private convert(band: number): Int32Array {
    const first = band << BAND_BITS;
    const colours = new Int32Array(Math.min(1 << BAND_BITS, this.pixels - first));
    const d = this.image.data;
    for (let n = 0; n < colours.length; n++) {
      const i = (first + n) * CHANNELS;
      const alpha = d[i + 3]!;
      colours[n] =
        alpha === OPAQUE
          ? pack(d[i]!, d[i + 1]!, d[i + 2]!)
          : pack(overWhite(d[i]!, alpha), overWhite(d[i + 1]!, alpha), overWhite(d[i + 2]!, alpha));
    }
    this.bands[band] = colours;
    return colours;
  }

  rgbAt(x: number, y: number): number {
    return this.rgb(y * this.width + x);
  }
}
