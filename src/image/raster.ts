import { overWhite, pack } from '../color/rgb.js';
import type { Pixels, RgbaImage } from './types.js';

const CHANNELS = 4;
const OPAQUE = 255;

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

  /**
   * Colours as 0xRRGGBB, worked out a row at a time on first use. The noise detectors read each
   * pixel near a changed one many times; the comparison itself reads a changed pixel once.
   */
  private colours: Int32Array | null = null;
  private decoded: Uint8Array | null = null;

  rgbAt(x: number, y: number): number {
    if (this.colours === null || this.decoded === null) {
      this.colours = new Int32Array(this.pixels);
      this.decoded = new Uint8Array(this.height);
    }
    const start = y * this.width;
    if (this.decoded[y] === 0) {
      for (let index = start; index < start + this.width; index++) {
        this.colours[index] = this.rgb(index);
      }
      this.decoded[y] = 1;
    }
    return this.colours[start + x]!;
  }
}
