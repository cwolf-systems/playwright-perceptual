import { InvalidOptionError } from './errors.js';
import type { CompareOptions } from './compare/types.js';
import type { Tolerance } from './snapshot/types.js';

export const DEFAULT_MAX_DELTA_E = 1;
export const DEFAULT_IGNORE_ANTIALIASING = true;
export const DEFAULT_IGNORE_SHIFTS = true;
export const DEFAULT_MAX_DIFF_PIXELS = 0;
export const DEFAULT_WITHIN = 1;

/** `toHaveScreenshot`'s capture defaults. */
export const CAPTURE_DEFAULTS = { animations: 'disabled', caret: 'hide', scale: 'css' } as const;

export interface ResolvedCompareOptions {
  readonly maxDeltaE: number;
  readonly ignoreAntialiasing: boolean;
  readonly ignoreShifts: boolean;
}

export function resolveCompareOptions(options: CompareOptions = {}): ResolvedCompareOptions {
  const maxDeltaE = options.maxDeltaE ?? DEFAULT_MAX_DELTA_E;
  if (!(maxDeltaE >= 0)) throw new InvalidOptionError('maxDeltaE', maxDeltaE, 'a number ≥ 0');
  return {
    maxDeltaE,
    ignoreAntialiasing: options.ignoreAntialiasing ?? DEFAULT_IGNORE_ANTIALIASING,
    ignoreShifts: options.ignoreShifts ?? DEFAULT_IGNORE_SHIFTS,
  };
}

// A share of an image can land just off a whole number of pixels in floating point:
// (1 - 0.9) × 10 is 0.9999999999999998. Counts are rounded to this precision before flooring.
const COUNT_PRECISION = 1e6;

/** The whole pixels in a fractional count, robust to floating-point error. */
export const wholePixels = (count: number): number =>
  Math.floor(Math.round(count * COUNT_PRECISION) / COUNT_PRECISION);

/** Changed pixels allowed in an image of `pixels` pixels: the stricter of the two limits. */
export function allowedDiffPixels(tolerance: Tolerance, pixels: number): number {
  const { maxDiffPixels, maxDiffPixelRatio } = tolerance;
  if (maxDiffPixels !== undefined && !(maxDiffPixels >= 0)) {
    throw new InvalidOptionError('maxDiffPixels', maxDiffPixels, 'a number ≥ 0');
  }
  if (maxDiffPixelRatio !== undefined && !(maxDiffPixelRatio >= 0 && maxDiffPixelRatio <= 1)) {
    throw new InvalidOptionError('maxDiffPixelRatio', maxDiffPixelRatio, 'between 0 and 1');
  }
  const limits = [
    maxDiffPixels,
    maxDiffPixelRatio === undefined ? undefined : wholePixels(maxDiffPixelRatio * pixels),
  ].filter((limit) => limit !== undefined);
  return limits.length === 0 ? DEFAULT_MAX_DIFF_PIXELS : Math.min(...limits);
}
