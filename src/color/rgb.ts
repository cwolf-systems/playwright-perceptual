// Colours packed as 0xRRGGBB integers, so a pixel compares and caches as one number.

const MAX_CHANNEL = 255;

// Rec. 601 luma weights.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

export const pack = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

export const red = (rgb: number): number => rgb >> 16;
export const green = (rgb: number): number => (rgb >> 8) & 0xff;
export const blue = (rgb: number): number => rgb & 0xff;

/** Brightness from 0 to 255. */
export const luma = (rgb: number): number =>
  LUMA_R * red(rgb) + LUMA_G * green(rgb) + LUMA_B * blue(rgb);

/** An 8-bit channel blended over white, as a transparent screenshot is seen. */
export const overWhite = (channel: number, alpha: number): number =>
  Math.round(MAX_CHANNEL + ((channel - MAX_CHANNEL) * alpha) / MAX_CHANNEL);
