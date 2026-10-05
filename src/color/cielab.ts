import type { Lab } from './types.js';
import { blue, green, red } from './rgb.js';

// sRGB (IEC 61966-2-1) to CIELAB (CIE 15:2004), D65 white.

type Row = readonly [number, number, number];

// sRGB transfer curve.
const SRGB_LINEAR_LIMIT = 0.04045;
const SRGB_LINEAR_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_GAMMA = 2.4;

// Linear sRGB to XYZ, from the sRGB primaries and D65.
const RGB_TO_XYZ: readonly [Row, Row, Row] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

// D65 white, Y = 1.
const WHITE = { x: 0.95047, y: 1, z: 1.08883 } as const;

// CIE 1976 lightness function: a cube root, linear below (6/29)³.
const DELTA = 6 / 29;
const DELTA_CUBED = DELTA ** 3;
const LINEAR_SCALE = 1 / (3 * DELTA ** 2);
const LINEAR_OFFSET = 4 / 29;

// CIELAB scale factors.
const L_SCALE = 116;
const L_OFFSET = 16;
const A_SCALE = 500;
const B_SCALE = 200;

/** Linear light for each 8-bit sRGB value. */
const LINEAR = Float64Array.from({ length: 256 }, (_, value) => {
  const c = value / 255;
  return c <= SRGB_LINEAR_LIMIT
    ? c / SRGB_LINEAR_SLOPE
    : ((c + SRGB_OFFSET) / (1 + SRGB_OFFSET)) ** SRGB_GAMMA;
});

const lightness = (t: number): number =>
  t > DELTA_CUBED ? Math.cbrt(t) : t * LINEAR_SCALE + LINEAR_OFFSET;

const dot = (row: Row, r: number, g: number, b: number): number =>
  row[0] * r + row[1] * g + row[2] * b;

/** CIELAB coordinates of a packed 0xRRGGBB colour. */
export function rgbToLab(rgb: number): Lab {
  const r = LINEAR[red(rgb)]!;
  const g = LINEAR[green(rgb)]!;
  const b = LINEAR[blue(rgb)]!;
  const [xRow, yRow, zRow] = RGB_TO_XYZ;
  const fx = lightness(dot(xRow, r, g, b) / WHITE.x);
  const fy = lightness(dot(yRow, r, g, b) / WHITE.y);
  const fz = lightness(dot(zRow, r, g, b) / WHITE.z);
  return { l: L_SCALE * fy - L_OFFSET, a: A_SCALE * (fx - fy), b: B_SCALE * (fy - fz) };
}
