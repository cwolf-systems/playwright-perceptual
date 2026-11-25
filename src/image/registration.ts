import { blue, green, red } from '../color/rgb.js';
import type { Pixels } from './types.js';

// The translation that aligns two images of the same scene, to a fraction of a pixel. Phase
// correlation (Kuglin and Hines, 1975) finds it to the pixel: the inverse transform of the
// normalised cross-power spectrum peaks at the translation. The spectrum's inverse is then
// evaluated on finer grids around that peak, by matrix-multiply discrete Fourier transforms
// (Guizar-Sicairos, Thurman and Fienup, 2008), first to a tenth of a pixel, then to a hundredth.

/** Where content at (x, y) in one image lies in the other: at (x + x, y + y). */
export interface Translation {
  readonly x: number;
  readonly y: number;
}

/** The largest side measured, centred in the image: a translation is the same everywhere. */
const MAX_SIDE = 512;

/** Each refinement: grid points per pixel, over a span of 1.5 of the previous grid's steps. */
const REFINEMENTS = [10, 100] as const;

/** The smallest power of two at least `n`. */
const powerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** In-place radix-2 transform of `n` complex values `stride` apart, inverse if `sign` is 1. */
function fft(
  re: Float64Array,
  im: Float64Array,
  offset: number,
  stride: number,
  n: number,
  sign: number,
): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = offset + i * stride;
      const b = offset + j * stride;
      [re[a], re[b]] = [re[b]!, re[a]!];
      [im[a], im[b]] = [im[b]!, im[a]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (sign * 2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size >> 1; k++) {
        const a = offset + (start + k) * stride;
        const b = a + (size >> 1) * stride;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** The two-dimensional transform of a `width` × `height` grid, rows then columns. */
function fft2(
  re: Float64Array,
  im: Float64Array,
  width: number,
  height: number,
  sign: number,
): void {
  for (let y = 0; y < height; y++) fft(re, im, y * width, 1, width, sign);
  for (let x = 0; x < width; x++) fft(re, im, x, width, height, sign);
}

/**
 * The luminance of the centred region, less its mean, tapered to zero at its border by a Hann
 * window so that the transform does not see the jump where the region wraps round, and padded
 * with zeros to powers of two.
 */
function prepare(
  image: Pixels,
  left: number,
  top: number,
  w: number,
  h: number,
  width: number,
): Float64Array {
  const height = powerOfTwo(h);
  const out = new Float64Array(width * height);
  let mean = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rgb = image.rgbAt(left + x, top + y);
      const level = 0.299 * red(rgb) + 0.587 * green(rgb) + 0.114 * blue(rgb);
      out[y * width + x] = level;
      mean += level;
    }
  }
  mean /= w * h;
  for (let y = 0; y < h; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / h);
    for (let x = 0; x < w; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / w);
      out[y * width + x] = (out[y * width + x]! - mean) * wx * wy;
    }
  }
  return out;
}

/** Signed frequency of index `k` of `n`: 0, 1, …, n/2 − 1, −n/2, …, −1. */
const frequency = (k: number, n: number) => (k < n >> 1 ? k : k - n);

/**
 * The real part of the inverse transform of `re`, `im` at the points `xs` × `ys`, which need not
 * be whole: a sum over every frequency, separable into two matrix products.
 */
function evaluate(
  re: Float64Array,
  im: Float64Array,
  width: number,
  height: number,
  xs: number[],
  ys: number[],
): Float64Array {
  // Along rows first: for each row of frequencies and each x, the sum over column frequencies.
  const rowRe = new Float64Array(height * xs.length);
  const rowIm = new Float64Array(height * xs.length);
  for (let j = 0; j < xs.length; j++) {
    for (let kx = 0; kx < width; kx++) {
      const angle = (2 * Math.PI * frequency(kx, width) * xs[j]!) / width;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (let ky = 0; ky < height; ky++) {
        const i = ky * width + kx;
        rowRe[ky * xs.length + j]! += re[i]! * c - im[i]! * s;
        rowIm[ky * xs.length + j]! += re[i]! * s + im[i]! * c;
      }
    }
  }
  const out = new Float64Array(ys.length * xs.length);
  for (let i = 0; i < ys.length; i++) {
    for (let ky = 0; ky < height; ky++) {
      const angle = (2 * Math.PI * frequency(ky, height) * ys[i]!) / height;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (let j = 0; j < xs.length; j++) {
        out[i * xs.length + j]! += rowRe[ky * xs.length + j]! * c - rowIm[ky * xs.length + j]! * s;
      }
    }
  }
  return out;
}

/**
 * The translation that carries `expected` onto `actual`, to a hundredth of a pixel, measured over
 * the centred region of up to MAX_SIDE pixels a side. Images of identical content give 0.
 */
export function register(expected: Pixels, actual: Pixels): Translation {
  const w = Math.min(expected.width, MAX_SIDE);
  const h = Math.min(expected.height, MAX_SIDE);
  const left = (expected.width - w) >> 1;
  const top = (expected.height - h) >> 1;
  const width = powerOfTwo(w);
  const height = powerOfTwo(h);
  const aRe = prepare(expected, left, top, w, h, width);
  const bRe = prepare(actual, left, top, w, h, width);
  const aIm = new Float64Array(aRe.length);
  const bIm = new Float64Array(bRe.length);
  fft2(aRe, aIm, width, height, -1);
  fft2(bRe, bIm, width, height, -1);
  // The cross-power spectrum, conj(A)·B: its inverse, the cross-correlation, peaks at the move.
  const re = new Float64Array(aRe.length);
  const im = new Float64Array(aRe.length);
  for (let i = 0; i < re.length; i++) {
    re[i] = aRe[i]! * bRe[i]! + aIm[i]! * bIm[i]!;
    im[i] = aRe[i]! * bIm[i]! - aIm[i]! * bRe[i]!;
  }
  const peakRe = Float64Array.from(re);
  const peakIm = Float64Array.from(im);
  fft2(peakRe, peakIm, width, height, 1);
  let best = 0;
  for (let i = 1; i < peakRe.length; i++) if (peakRe[i]! > peakRe[best]!) best = i;
  let x = frequency(best % width, width);
  let y = frequency(Math.floor(best / width), height);
  let step = 1;
  for (const perPixel of REFINEMENTS) {
    const points = Math.ceil(1.5 * step * perPixel);
    const grid = (centre: number) =>
      Array.from({ length: points + 1 }, (_, i) => centre + (i - points / 2) / perPixel);
    const xs = grid(x);
    const ys = grid(y);
    const values = evaluate(re, im, width, height, xs, ys);
    let top = 0;
    for (let i = 1; i < values.length; i++) if (values[i]! > values[top]!) top = i;
    x = xs[top % xs.length]!;
    y = ys[Math.floor(top / xs.length)]!;
    step = 1 / perPixel;
  }
  return { x, y };
}
