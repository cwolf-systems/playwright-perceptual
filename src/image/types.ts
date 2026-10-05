/** 8-bit RGBA pixels, row by row from the top left. */
export interface RgbaImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Read access to an image by pixel. */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** The colour at (x, y) as 0xRRGGBB, blended over white if transparent. */
  rgbAt(x: number, y: number): number;
}

/** Whether changed pixel (x, y) of `image` is rendering noise rather than a real change. */
export type NoiseDetector = (image: Pixels, other: Pixels, x: number, y: number) => boolean;
