import { describe, expect, it } from 'vitest';
import { allowedDiffPixels, resolveCompareOptions, wholePixels } from '../src/defaults.js';
import { InvalidOptionError } from '../src/errors.js';

describe('options', () => {
  it('fill in defaults', () => {
    expect(resolveCompareOptions()).toEqual({
      maxDeltaE: 1,
      ignoreAntialiasing: true,
      ignoreShifts: true,
    });
    expect(allowedDiffPixels({}, 1_000)).toBe(0);
  });

  it('take the stricter of two pixel limits', () => {
    expect(allowedDiffPixels({ maxDiffPixels: 50, maxDiffPixelRatio: 0.01 }, 1_000)).toBe(10);
    expect(allowedDiffPixels({ maxDiffPixels: 5, maxDiffPixelRatio: 0.01 }, 1_000)).toBe(5);
  });

  it('count shares of an image in whole pixels, despite floating point', () => {
    // 0.29 × 100 is 28.999999999999996 and (1 - 0.9) × 10 is 0.9999999999999998.
    expect(allowedDiffPixels({ maxDiffPixelRatio: 0.29 }, 100)).toBe(29);
    expect(wholePixels((1 - 0.9) * 10)).toBe(1);
    expect(wholePixels(2.5)).toBe(2);
  });

  it.each([
    () => resolveCompareOptions({ maxDeltaE: -0.5 }),
    () => resolveCompareOptions({ maxDeltaE: Number.NaN }),
    () => allowedDiffPixels({ maxDiffPixels: -1 }, 10),
    () => allowedDiffPixels({ maxDiffPixelRatio: 2 }, 10),
  ])('reject values out of range (%#)', (resolve) => {
    expect(resolve).toThrow(InvalidOptionError);
  });
});
