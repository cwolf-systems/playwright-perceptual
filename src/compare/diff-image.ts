import { luma } from '../color/rgb.js';
import type { RgbaImage } from '../image/types.js';

const CHANNELS = 4;
const OPAQUE = 255;
const WHITE = 255;

const CHANGED = [255, 0, 0] as const;
const ANTIALIASED = [255, 255, 0] as const;
const SHIFTED = [0, 160, 255] as const;

/** Unchanged pixels keep this much of their contrast against white, so changes stand out. */
const FADE = 0.1;

/** Paints a diff image: changes red, anti-aliasing yellow, shifts blue, everything else faded grey. */
export class DiffImage {
  readonly image: RgbaImage;

  constructor(width: number, height: number) {
    this.image = { data: new Uint8Array(width * height * CHANNELS), width, height };
  }

  unchanged(index: number, rgb: number): void {
    const v = Math.round(WHITE + (luma(rgb) - WHITE) * FADE);
    this.paint(index, [v, v, v]);
  }

  changed(index: number): void {
    this.paint(index, CHANGED);
  }

  antialiased(index: number): void {
    this.paint(index, ANTIALIASED);
  }

  shifted(index: number): void {
    this.paint(index, SHIFTED);
  }

  private paint(index: number, [r, g, b]: readonly [number, number, number]): void {
    this.image.data.set([r, g, b, OPAQUE], index * CHANNELS);
  }
}
